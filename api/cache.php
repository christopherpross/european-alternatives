<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

// ===========================================================================
// Server-side file cache for API responses.
//
// Eliminates DB connections for cache hits. Catalog data rarely changes,
// so a 5-minute TTL keeps the site fast while limiting stale data.
//
// Cache files are trusted application state, so the default location must live
// in private account-owned storage rather than shared /tmp.
// ===========================================================================

defined('EUROALT_CACHE_DIR') || define('EUROALT_CACHE_DIR', '/home/u688914453/.local/state/euroalt-api-cache');
defined('EUROALT_CACHE_TTL') || define('EUROALT_CACHE_TTL', 300);
const EUROALT_CACHE_DIR_MODE = 0700;

function getCacheDirectoryPath(): string
{
    $cacheDir = rtrim(EUROALT_CACHE_DIR, "/\\");
    if ($cacheDir === '') {
        throw new \RuntimeException('Cache directory is empty.');
    }

    return $cacheDir;
}

function logCacheWarning(string $message): void
{
    error_log('euroalt-cache: ' . $message);
}

function isCachePathOwnerValid(int|false $owner): bool
{
    $expectedOwner = function_exists('posix_geteuid') ? @posix_geteuid() : null;

    return !is_int($owner) || !is_int($expectedOwner) || $expectedOwner < 0 || $owner === $expectedOwner;
}

function validateCacheDirectory(string $cacheDir): bool
{
    clearstatcache(true, $cacheDir);

    if (is_link($cacheDir)) {
        logCacheWarning('Rejecting symlinked cache directory: ' . $cacheDir);
        return false;
    }

    if (!is_dir($cacheDir)) {
        logCacheWarning('Cache directory path is not a directory: ' . $cacheDir);
        return false;
    }

    $permissions = fileperms($cacheDir);
    if ($permissions === false || ($permissions & 0077) !== 0) {
        logCacheWarning('Rejecting cache directory with overly broad permissions: ' . $cacheDir);
        return false;
    }

    if (!isCachePathOwnerValid(fileowner($cacheDir))) {
        logCacheWarning('Rejecting cache directory owned by another user: ' . $cacheDir);
        return false;
    }

    return true;
}

function ensureCacheDirectoryUsable(bool $createIfMissing): bool
{
    $cacheDir = getCacheDirectoryPath();

    clearstatcache(true, $cacheDir);
    if (is_link($cacheDir)) {
        logCacheWarning('Rejecting symlinked cache directory: ' . $cacheDir);
        return false;
    }

    if (!is_dir($cacheDir)) {
        if (!$createIfMissing) {
            return false;
        }

        if (!(@mkdir($cacheDir, EUROALT_CACHE_DIR_MODE, true) || is_dir($cacheDir))) {
            logCacheWarning('Unable to create cache directory: ' . $cacheDir);
            return false;
        }
    }

    @chmod($cacheDir, EUROALT_CACHE_DIR_MODE);

    return validateCacheDirectory($cacheDir);
}

function validateCacheFile(string $cacheFile): bool
{
    clearstatcache(true, $cacheFile);

    if (is_link($cacheFile)) {
        logCacheWarning('Rejecting symlinked cache file: ' . $cacheFile);
        return false;
    }

    if (!is_file($cacheFile)) {
        return false;
    }

    $permissions = fileperms($cacheFile);
    if ($permissions === false || ($permissions & 0022) !== 0) {
        logCacheWarning('Rejecting cache file with write permissions for group/world: ' . $cacheFile);
        return false;
    }

    if (!isCachePathOwnerValid(fileowner($cacheFile))) {
        logCacheWarning('Rejecting cache file owned by another user: ' . $cacheFile);
        return false;
    }

    return true;
}

/**
 * Serve a cached response if a fresh cache file exists.
 *
 * On hit: outputs JSON with X-Cache: HIT header and exits.
 * On miss: returns false so the endpoint continues to the DB.
 *
 * @param string $key    Endpoint name (e.g. 'entries', 'categories')
 * @param array  $params Vary parameters (e.g. ['status' => 'alternative', 'locale' => 'en'])
 * @return bool  Always false on miss; on hit the function exits and never returns.
 */
function serveCachedResponse(string $key, array $params = []): bool
{
    $cacheFile = buildCachePath($key, $params);

    if (!ensureCacheDirectoryUsable(false) || !validateCacheFile($cacheFile)) {
        return false;
    }

    $mtime = filemtime($cacheFile);
    if ($mtime === false || (time() - $mtime) > EUROALT_CACHE_TTL) {
        return false;
    }

    $content = file_get_contents($cacheFile);
    if ($content === false) {
        return false;
    }

    $decoded = json_decode($content, true);
    if (!is_array($decoded)) {
        logCacheWarning('Rejecting invalid JSON cache payload: ' . $cacheFile);
        @unlink($cacheFile);
        return false;
    }

    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=' . EUROALT_CACHE_TTL . ', stale-while-revalidate=60');
    sendStrictTransportSecurityHeader();
    sendContentSecurityPolicyHeader();
    sendReferrerPolicyHeader();
    sendPermissionsPolicyHeader();
    sendXContentTypeOptionsHeader();
    sendXFrameOptionsHeader();
    header('X-Cache: HIT');

    echo $content;
    exit;
}

/**
 * Encode payload as JSON, write to cache atomically, send response, and exit.
 *
 * Uses temp-file + rename() for atomic writes to prevent serving partial files.
 *
 * @param string $key     Endpoint name
 * @param array  $params  Vary parameters
 * @param array  $payload Response data to encode and cache
 */
function sendCacheableJsonResponse(string $key, array $params, array $payload): never
{
    $json = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

    // Write cache file atomically (temp file + rename)
    $cacheFile = buildCachePath($key, $params);

    if (ensureCacheDirectoryUsable(true)) {
        $pid = getmypid();
        $tmpFile = $cacheFile . '.' . ($pid !== false ? $pid : bin2hex(random_bytes(4))) . '.tmp';
        if (file_put_contents($tmpFile, $json, LOCK_EX) !== false) {
            @chmod($tmpFile, 0600);
            if (!@rename($tmpFile, $cacheFile)) {
                @unlink($tmpFile);
            }
        } else {
            @unlink($tmpFile);
        }
    }

    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=' . EUROALT_CACHE_TTL . ', stale-while-revalidate=60');
    sendStrictTransportSecurityHeader();
    sendContentSecurityPolicyHeader();
    sendReferrerPolicyHeader();
    sendPermissionsPolicyHeader();
    sendXContentTypeOptionsHeader();
    sendXFrameOptionsHeader();
    header('X-Cache: MISS');

    echo $json;
    exit;
}

/**
 * Delete all cached response files (and any orphaned temp files).
 */
function invalidateCache(): void
{
    if (!ensureCacheDirectoryUsable(false)) {
        return;
    }

    $dir = getCacheDirectoryPath() . DIRECTORY_SEPARATOR;

    $files = array_merge(
        glob($dir . '*.json') ?: [],
        glob($dir . '*.tmp') ?: []
    );

    foreach ($files as $file) {
        if (!is_link($file) && is_file($file)) {
            @unlink($file);
        }
    }
}

/**
 * Build the filesystem path for a cache entry.
 *
 * Cache key format: {endpoint}_{md5(sorted params)}.json
 * Sorting params ensures consistent keys regardless of query parameter order.
 */
function buildCachePath(string $key, array $params): string
{
    if (!preg_match('/^[a-z0-9-]+$/', $key)) {
        throw new \InvalidArgumentException('Invalid cache key: ' . $key);
    }

    ksort($params);
    $suffix = count($params) > 0 ? '_' . md5(json_encode($params)) : '';

    return getCacheDirectoryPath() . DIRECTORY_SEPARATOR . $key . $suffix . '.json';
}
