<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const MYSQL_CLIENT_SSL_CAPABILITY = 2048;

/**
 * Build a PDO connection using secure defaults.
 */
function getDatabaseConnection(): PDO
{
    $config = loadDbConfig();

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $config['host'],
        $config['port'],
        $config['database'],
        $config['charset']
    );

    if (shouldPreflightDatabaseTransportSecurity($config)) {
        assertDatabaseServerAdvertisesTlsSupport($config['host'], $config['port']);
    }

    $pdo = new PDO(
        $dsn,
        $config['username'],
        $config['password'],
        buildDatabaseConnectionOptions($config)
    );

    if (shouldAssertDatabaseTransportSecurity($config)) {
        assertDatabaseConnectionUsesTls($pdo);
    }

    return $pdo;
}

/**
 * @param array{
 *   host: string,
 *   ssl_ca: ?string,
 *   ssl_capath: ?string,
 *   ssl_cert: ?string,
 *   ssl_key: ?string,
 *   ssl_cipher: ?string,
 *   ssl_verify_server_cert: ?bool,
 *   require_tls: bool
 * } $config
 * @return array<int, mixed>
 */
function buildDatabaseConnectionOptions(array $config): array
{
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    addPdoMysqlOptionIfConfigured($options, 'PDO::MYSQL_ATTR_SSL_CA', $config['ssl_ca']);
    addPdoMysqlOptionIfConfigured($options, 'PDO::MYSQL_ATTR_SSL_CAPATH', $config['ssl_capath']);
    addPdoMysqlOptionIfConfigured($options, 'PDO::MYSQL_ATTR_SSL_CERT', $config['ssl_cert']);
    addPdoMysqlOptionIfConfigured($options, 'PDO::MYSQL_ATTR_SSL_KEY', $config['ssl_key']);
    addPdoMysqlOptionIfConfigured($options, 'PDO::MYSQL_ATTR_SSL_CIPHER', $config['ssl_cipher']);

    if ($config['ssl_verify_server_cert'] === true) {
        addPdoMysqlOptionIfConfigured(
            $options,
            'PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT',
            $config['ssl_verify_server_cert']
        );
    }

    return $options;
}

/**
 * @param array<int, mixed> $options
 * @param scalar|null $value
 */
function addPdoMysqlOptionIfConfigured(array &$options, string $constantName, $value): void
{
    if ($value === null) {
        return;
    }

    $constantValue = getDefinedPdoMysqlConstant($constantName);

    if ($constantValue === null) {
        throw new RuntimeException(sprintf('The configured database TLS option "%s" is not supported by this PDO build.', $constantName));
    }

    $options[$constantValue] = $value;
}

function getDefinedPdoMysqlConstant(string $constantName): ?int
{
    if (!defined($constantName)) {
        return null;
    }

    $constantValue = constant($constantName);

    return is_int($constantValue) ? $constantValue : null;
}

/**
 * @param array{
 *   ssl_ca: ?string,
 *   ssl_capath: ?string,
 *   ssl_cert: ?string,
 *   ssl_key: ?string,
 *   ssl_cipher: ?string,
 *   ssl_verify_server_cert: ?bool,
 *   require_tls: bool
 * } $config
 */
function shouldAssertDatabaseTransportSecurity(array $config): bool
{
    return $config['require_tls']
        || $config['ssl_ca'] !== null
        || $config['ssl_capath'] !== null
        || $config['ssl_cert'] !== null
        || $config['ssl_key'] !== null
        || $config['ssl_cipher'] !== null
        || $config['ssl_verify_server_cert'] === true;
}

/**
 * @param array{
 *   host: string,
 *   ssl_ca: ?string,
 *   ssl_capath: ?string,
 *   ssl_cert: ?string,
 *   ssl_key: ?string,
 *   ssl_cipher: ?string,
 *   ssl_verify_server_cert: ?bool,
 *   require_tls: bool
 * } $config
 */
function shouldPreflightDatabaseTransportSecurity(array $config): bool
{
    return shouldAssertDatabaseTransportSecurity($config) && !isLoopbackDatabaseHost($config['host']);
}

function assertDatabaseServerAdvertisesTlsSupport(string $host, int $port): void
{
    $transportAddress = buildDatabaseTcpTransportAddress($host, $port);
    $socket = @stream_socket_client($transportAddress, $errorCode, $errorMessage, 5, STREAM_CLIENT_CONNECT);

    if (!is_resource($socket)) {
        throw new RuntimeException(sprintf(
            'Could not preflight database TLS support for "%s:%d": %s',
            $host,
            $port,
            $errorMessage ?: 'connection failed'
        ));
    }

    try {
        stream_set_timeout($socket, 5);
        $capabilityFlags = getMysqlServerCapabilityFlagsFromSocket($socket);

        if (($capabilityFlags & MYSQL_CLIENT_SSL_CAPABILITY) !== MYSQL_CLIENT_SSL_CAPABILITY) {
            throw new RuntimeException('Database server does not advertise TLS support.');
        }
    } finally {
        fclose($socket);
    }
}

function buildDatabaseTcpTransportAddress(string $host, int $port): string
{
    if (str_contains($host, ':') && !str_starts_with($host, '[')) {
        return sprintf('tcp://[%s]:%d', $host, $port);
    }

    return sprintf('tcp://%s:%d', $host, $port);
}

/**
 * @param resource $socket
 */
function getMysqlServerCapabilityFlagsFromSocket($socket): int
{
    $header = readMysqlPacketBytes($socket, 4);
    $payloadLength = unpackMysqlPacketLength($header);
    $payload = readMysqlPacketBytes($socket, $payloadLength);

    return parseMysqlServerCapabilityFlags($payload);
}

function unpackMysqlPacketLength(string $header): int
{
    if (strlen($header) !== 4) {
        throw new RuntimeException('Could not read the MySQL handshake header.');
    }

    return ord($header[0]) | (ord($header[1]) << 8) | (ord($header[2]) << 16);
}

/**
 * @param resource $socket
 */
function readMysqlPacketBytes($socket, int $length): string
{
    $buffer = '';

    while (strlen($buffer) < $length) {
        $chunk = fread($socket, $length - strlen($buffer));

        if (!is_string($chunk) || $chunk === '') {
            throw new RuntimeException('Could not read the MySQL handshake packet.');
        }

        $buffer .= $chunk;
    }

    return $buffer;
}

function parseMysqlServerCapabilityFlags(string $payload): int
{
    if ($payload === '') {
        throw new RuntimeException('The MySQL handshake payload was empty.');
    }

    if (ord($payload[0]) === 0xff) {
        throw new RuntimeException('MySQL server returned an error during the TLS preflight handshake.');
    }

    $serverVersionEnd = strpos($payload, "\0", 1);
    if ($serverVersionEnd === false) {
        throw new RuntimeException('Could not parse the MySQL server version from the handshake packet.');
    }

    $capabilityOffset = $serverVersionEnd + 1 + 4 + 8 + 1;

    if (strlen($payload) < $capabilityOffset + 2) {
        throw new RuntimeException('The MySQL handshake packet was truncated before the capability flags.');
    }

    $lowerFlags = ord($payload[$capabilityOffset]) | (ord($payload[$capabilityOffset + 1]) << 8);
    $nextSectionOffset = $capabilityOffset + 2;

    if (strlen($payload) < $nextSectionOffset + 5) {
        return $lowerFlags;
    }

    $upperFlagsOffset = $nextSectionOffset + 1 + 2;
    $upperFlags = ord($payload[$upperFlagsOffset]) | (ord($payload[$upperFlagsOffset + 1]) << 8);

    return $lowerFlags | ($upperFlags << 16);
}

/**
 * @return array{tls_enabled: bool, ssl_cipher: ?string}
 */
function getDatabaseTransportSecurityStatus(PDO $pdo): array
{
    $statement = $pdo->query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    $row = $statement->fetch();

    $sslCipher = null;

    if (is_array($row)) {
        $rawCipher = $row['Value'] ?? $row[1] ?? null;

        if (is_string($rawCipher) && $rawCipher !== '') {
            $sslCipher = $rawCipher;
        }
    }

    return [
        'tls_enabled' => $sslCipher !== null,
        'ssl_cipher' => $sslCipher,
    ];
}

function assertDatabaseConnectionUsesTls(PDO $pdo): void
{
    $transportStatus = getDatabaseTransportSecurityStatus($pdo);

    if ($transportStatus['tls_enabled']) {
        return;
    }

    throw new RuntimeException('Database connection did not negotiate TLS.');
}
