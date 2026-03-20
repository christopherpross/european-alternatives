<?php
declare(strict_types=1);

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../admin/auth.php';

requireHttpMethod('GET');
requireAdminAuth();

try {
    $pdo = getDatabaseConnection();
    $statement = $pdo->query('SELECT 1 AS db_ok');
    $row = $statement->fetch();
    $transport = [
        'probe' => 'unavailable',
        'tls' => null,
        'sslCipher' => null,
    ];

    try {
        $transportStatus = getDatabaseTransportSecurityStatus($pdo);
        $transport = [
            'probe' => 'ok',
            'tls' => $transportStatus['tls_enabled'],
            'sslCipher' => $transportStatus['ssl_cipher'],
        ];
    } catch (Throwable $transportException) {
        error_log(sprintf('[api][db-health][transport] %s', $transportException->getMessage()));
    }

    sendJsonResponse(200, [
        'ok' => true,
        'db' => 'up',
        'check' => (int)($row['db_ok'] ?? 0),
        'transport' => $transport,
    ]);
} catch (Throwable $exception) {
    error_log(sprintf('[api][db-health] %s', $exception->getMessage()));
    sendJsonResponse(500, [
        'ok' => false,
        'db' => 'down',
        'error' => 'database_unreachable',
    ]);
}
