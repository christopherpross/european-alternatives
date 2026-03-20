<?php
declare(strict_types=1);

const APP_DB_CONFIG_ENV = 'EUROALT_DB_CONFIG';
const DEFAULT_DB_CONFIG_PATH = '/home/u688914453/.secrets/euroalt-db.php';
const APP_ENV_LOADER_PATH_ENV = 'EUROALT_ENV_LOADER';
const DEFAULT_ENV_LOADER_PATH = '/home/u688914453/.secrets/euroalt-db-env.php';

/**
 * Send a JSON response and terminate.
 */
function sendJsonResponse(int $statusCode, array $payload): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');

    echo json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Restrict an endpoint to a single HTTP method.
 */
function requireHttpMethod(string $method): void
{
    $expectedMethod = strtoupper($method);
    $requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? '');

    if ($requestMethod === $expectedMethod) {
        return;
    }

    header('Allow: ' . $expectedMethod);
    sendJsonResponse(405, [
        'ok' => false,
        'error' => 'method_not_allowed',
    ]);
}

/**
 * Send a JSON error response and terminate.
 *
 * Convenience wrapper around sendJsonResponse for error payloads.
 */
function jsonError(int $code, string $message): never
{
    sendJsonResponse($code, [
        'ok' => false,
        'error' => $message,
    ]);
}

/**
 * Convenience alias for requireHttpMethod().
 *
 * Sends 405 Method Not Allowed if the current request method does not match.
 */
function requireMethod(string $method): void
{
    requireHttpMethod($method);
}

/**
 * Read and validate the ?locale= query parameter.
 *
 * @return string 'en' or 'de' (defaults to 'en' for missing/invalid values)
 */
function getLocale(): string
{
    $locale = $_GET['locale'] ?? 'en';

    if (!is_string($locale) || !in_array($locale, ['en', 'de'], true)) {
        return 'en';
    }

    return $locale;
}

/**
 * Alias for loadDbConfig() — provides a shorter name for import scripts and API endpoints.
 *
 * @return array{
 *   driver: string,
 *   host: string,
 *   port: int,
 *   database: string,
 *   username: string,
 *   password: string,
 *   charset: string,
 *   ssl_ca: ?string,
 *   ssl_capath: ?string,
 *   ssl_cert: ?string,
 *   ssl_key: ?string,
 *   ssl_cipher: ?string,
 *   ssl_verify_server_cert: ?bool,
 *   require_tls: bool
 * }
 */
function getDbConfig(): array
{
    return loadDbConfig();
}

/**
 * Load database config from a file kept outside the web root.
 * Environment variables take precedence; file config is fallback.
 */
function loadDbConfig(): array
{
    loadEnvironmentOverrides();

    $envConfig = loadDbConfigFromEnvironment();
    if ($envConfig !== null) {
        return $envConfig;
    }

    $configPath = getenv(APP_DB_CONFIG_ENV) ?: DEFAULT_DB_CONFIG_PATH;

    if (!is_string($configPath) || $configPath === '' || !is_readable($configPath)) {
        throw new RuntimeException('Database config file is missing or unreadable.');
    }

    $config = require $configPath;
    if (!is_array($config)) {
        throw new RuntimeException('Database config must return an array.');
    }

    return normalizeDbConfig($config);
}

/**
 * Load optional env loader file that sets process environment variables via putenv().
 */
function loadEnvironmentOverrides(): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $loaded = true;

    $envLoaderPath = getenv(APP_ENV_LOADER_PATH_ENV) ?: DEFAULT_ENV_LOADER_PATH;
    if (is_string($envLoaderPath) && $envLoaderPath !== '' && is_readable($envLoaderPath)) {
        require_once $envLoaderPath;
    }
}

/**
 * Build DB config from environment variables if present.
 */
function loadDbConfigFromEnvironment(): ?array
{
    $host = getenv('EUROALT_DB_HOST');
    $database = getenv('EUROALT_DB_NAME');
    $username = getenv('EUROALT_DB_USER');
    $password = getenv('EUROALT_DB_PASS');

    $allMissing = $host === false && $database === false && $username === false && $password === false;
    if ($allMissing) {
        return null;
    }

    foreach ([
        'EUROALT_DB_HOST' => $host,
        'EUROALT_DB_NAME' => $database,
        'EUROALT_DB_USER' => $username,
        'EUROALT_DB_PASS' => $password,
    ] as $key => $value) {
        if (!is_string($value) || $value === '') {
            throw new RuntimeException(sprintf('Environment variable "%s" is missing or empty.', $key));
        }
    }

    $portValue = getenv('EUROALT_DB_PORT');
    $port = filter_var(
        $portValue === false || $portValue === '' ? 3306 : $portValue,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 65535]]
    );
    if ($port === false) {
        throw new RuntimeException('Environment variable "EUROALT_DB_PORT" is invalid.');
    }

    $charset = getenv('EUROALT_DB_CHARSET');
    if (!is_string($charset) || $charset === '') {
        $charset = 'utf8mb4';
    }

    return normalizeDbConfig([
        'host' => $host,
        'port' => $port,
        'database' => $database,
        'username' => $username,
        'password' => $password,
        'charset' => $charset,
        'ssl_ca' => getenv('EUROALT_DB_SSL_CA'),
        'ssl_capath' => getenv('EUROALT_DB_SSL_CAPATH'),
        'ssl_cert' => getenv('EUROALT_DB_SSL_CERT'),
        'ssl_key' => getenv('EUROALT_DB_SSL_KEY'),
        'ssl_cipher' => getenv('EUROALT_DB_SSL_CIPHER'),
        'ssl_verify_server_cert' => getenv('EUROALT_DB_SSL_VERIFY_SERVER_CERT'),
        'require_tls' => getenv('EUROALT_DB_REQUIRE_TLS'),
    ]);
}

/**
 * @param array<string, mixed> $config
 * @return array{
 *   driver: string,
 *   host: string,
 *   port: int,
 *   database: string,
 *   username: string,
 *   password: string,
 *   charset: string,
 *   ssl_ca: ?string,
 *   ssl_capath: ?string,
 *   ssl_cert: ?string,
 *   ssl_key: ?string,
 *   ssl_cipher: ?string,
 *   ssl_verify_server_cert: ?bool,
 *   require_tls: bool
 * }
 */
function normalizeDbConfig(array $config): array
{
    foreach (['host', 'database', 'username', 'password'] as $requiredKey) {
        if (!isset($config[$requiredKey]) || !is_string($config[$requiredKey]) || trim($config[$requiredKey]) === '') {
            throw new RuntimeException(sprintf('Database config key "%s" is missing for mysql.', $requiredKey));
        }
    }

    $port = filter_var(
        $config['port'] ?? 3306,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 65535]]
    );

    if ($port === false) {
        throw new RuntimeException('Database config port is invalid.');
    }

    $charset = $config['charset'] ?? 'utf8mb4';
    if (!is_string($charset) || trim($charset) === '') {
        throw new RuntimeException('Database config charset is invalid.');
    }

    $normalizedConfig = [
        'driver' => 'mysql',
        'host' => trim($config['host']),
        'port' => $port,
        'database' => trim($config['database']),
        'username' => trim($config['username']),
        'password' => $config['password'],
        'charset' => trim($charset),
        'ssl_ca' => normalizeOptionalPathSetting($config['ssl_ca'] ?? null, 'ssl_ca'),
        'ssl_capath' => normalizeOptionalPathSetting($config['ssl_capath'] ?? null, 'ssl_capath', true),
        'ssl_cert' => normalizeOptionalPathSetting($config['ssl_cert'] ?? null, 'ssl_cert'),
        'ssl_key' => normalizeOptionalPathSetting($config['ssl_key'] ?? null, 'ssl_key'),
        'ssl_cipher' => normalizeOptionalStringSetting($config['ssl_cipher'] ?? null, 'ssl_cipher'),
        'ssl_verify_server_cert' => normalizeOptionalEnabledBooleanSetting(
            $config['ssl_verify_server_cert'] ?? null,
            'ssl_verify_server_cert'
        ),
        'require_tls' => normalizeOptionalBooleanSetting($config['require_tls'] ?? null, 'require_tls') ?? false,
    ];

    assertDatabaseTransportSecurityConfig($normalizedConfig);

    return $normalizedConfig;
}

/**
 * @param array{
 *   host: string,
 *   ssl_ca: ?string,
 *   ssl_capath: ?string,
 *   ssl_verify_server_cert: ?bool,
 *   require_tls: bool
 * } $config
 */
function assertDatabaseTransportSecurityConfig(array $config): void
{
    if (isLoopbackDatabaseHost($config['host'])) {
        return;
    }

    if ($config['require_tls'] !== true) {
        throw new RuntimeException('Remote database hosts must set "require_tls" to true.');
    }

    if ($config['ssl_verify_server_cert'] !== true) {
        throw new RuntimeException('Remote database hosts must enable "ssl_verify_server_cert".');
    }

    if ($config['ssl_ca'] === null && $config['ssl_capath'] === null) {
        throw new RuntimeException(
            'Remote database hosts must configure "ssl_ca" or "ssl_capath" so the server certificate can be verified.'
        );
    }
}

function isLoopbackDatabaseHost(string $host): bool
{
    $normalizedHost = strtolower(trim($host));

    return in_array($normalizedHost, ['localhost', '127.0.0.1', '::1', '[::1]'], true);
}

/**
 * @param mixed $value
 */
function normalizeOptionalStringSetting(mixed $value, string $key): ?string
{
    if ($value === null || $value === false) {
        return null;
    }

    if (!is_string($value)) {
        throw new RuntimeException(sprintf('Database config key "%s" must be a string.', $key));
    }

    $trimmedValue = trim($value);

    return $trimmedValue === '' ? null : $trimmedValue;
}

/**
 * @param mixed $value
 */
function normalizeOptionalPathSetting(mixed $value, string $key, bool $expectDirectory = false): ?string
{
    $path = normalizeOptionalStringSetting($value, $key);

    if ($path === null) {
        return null;
    }

    if (!is_readable($path)) {
        throw new RuntimeException(sprintf('Database config key "%s" must point to a readable path.', $key));
    }

    if ($expectDirectory && !is_dir($path)) {
        throw new RuntimeException(sprintf('Database config key "%s" must point to a readable directory.', $key));
    }

    if (!$expectDirectory && !is_file($path)) {
        throw new RuntimeException(sprintf('Database config key "%s" must point to a readable file.', $key));
    }

    return $path;
}

/**
 * @param mixed $value
 */
function normalizeOptionalBooleanSetting(mixed $value, string $key): ?bool
{
    if ($value === null) {
        return null;
    }

    if (is_string($value) && trim($value) === '') {
        return null;
    }

    if (is_bool($value)) {
        return $value;
    }

    if (!is_scalar($value)) {
        throw new RuntimeException(sprintf('Database config key "%s" must be a boolean.', $key));
    }

    $parsedValue = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

    if ($parsedValue === null) {
        throw new RuntimeException(sprintf('Database config key "%s" must be a boolean.', $key));
    }

    return $parsedValue;
}

/**
 * Normalize a boolean flag where only explicit true enables behavior.
 *
 * @param mixed $value
 */
function normalizeOptionalEnabledBooleanSetting(mixed $value, string $key): ?bool
{
    return normalizeOptionalBooleanSetting($value, $key) === true ? true : null;
}
