<?php
declare(strict_types=1);

putenv('EUROALT_DB_HOST=127.0.0.1');
putenv('EUROALT_DB_PORT=3306');
putenv('EUROALT_DB_NAME=u688914453_euroalt');
putenv('EUROALT_DB_USER=u688914453_app');
putenv('EUROALT_DB_PASS=replace-with-a-long-random-password');
putenv('EUROALT_DB_CHARSET=utf8mb4');
// Loopback development can leave TLS unset.
// Remote MySQL hosts must set a CA path (or CA directory), enable
// server-certificate verification, and set require_tls=1.
putenv('EUROALT_DB_SSL_CA=');
putenv('EUROALT_DB_SSL_CAPATH=');
putenv('EUROALT_DB_SSL_CERT=');
putenv('EUROALT_DB_SSL_KEY=');
putenv('EUROALT_DB_SSL_CIPHER=');
putenv('EUROALT_DB_SSL_VERIFY_SERVER_CERT=0');
putenv('EUROALT_DB_REQUIRE_TLS=0');
