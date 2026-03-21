<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

sendJsonResponse(404, [
    'ok'    => false,
    'error' => 'not_found',
    'detail' => 'The requested API endpoint does not exist.',
]);
