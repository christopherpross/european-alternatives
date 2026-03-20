<?php
declare(strict_types=1);

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../cache.php';
require_once __DIR__ . '/auth.php';

requireHttpMethod('POST');
requireAdminAuth();

// This endpoint is CLI-only (called by research-alternative.sh via curl).
// Reject any request with an Origin header to block browser-originated requests entirely.
if (isset($_SERVER['HTTP_ORIGIN'])) {
    jsonError(403, 'browser_requests_not_allowed');
}

// --- Read & decode request body ---

$rawBody = file_get_contents('php://input', false, null, 0, 65536); // 64KB limit
if ($rawBody === false || $rawBody === '') {
    jsonError(400, 'empty_request_body');
}

$body = json_decode($rawBody, true);
if (!is_array($body)) {
    jsonError(400, 'invalid_json');
}

// --- Validate required fields ---

$requiredStrings = ['slug', 'name', 'deny_reason'];
foreach ($requiredStrings as $field) {
    if (!isset($body[$field]) || !is_string($body[$field]) || trim($body[$field]) === '') {
        jsonError(400, "missing_or_empty_field:$field");
    }
}

$slug = trim($body['slug']);
$name = trim($body['name']);
$denyReason = trim($body['deny_reason']);

// Validate slug format (lowercase alphanumeric, hyphens, dots)
if (!preg_match('/^[a-z0-9][a-z0-9._-]{0,98}[a-z0-9]$/', $slug) && !preg_match('/^[a-z0-9]$/', $slug)) {
    jsonError(400, 'invalid_slug_format');
}

// --- Validate optional fields ---

$categories = $body['categories'] ?? [];
if (!is_array($categories)) {
    jsonError(400, 'invalid_categories');
}

$failedGateways = $body['failed_gateways'] ?? null;
if ($failedGateways !== null && !is_array($failedGateways)) {
    jsonError(400, 'invalid_failed_gateways');
}

$sources = $body['sources'] ?? null;
if ($sources !== null && !is_array($sources)) {
    jsonError(400, 'invalid_sources');
}

$proposedIn = null;
if (isset($body['proposed_in']) && is_string($body['proposed_in']) && trim($body['proposed_in']) !== '') {
    $proposedIn = trim($body['proposed_in']);
}

$countryCode = null;
if (isset($body['country_code']) && is_string($body['country_code']) && trim($body['country_code']) !== '') {
    $countryCode = strtolower(trim($body['country_code']));
}

$websiteUrl = null;
if (isset($body['website_url']) && is_string($body['website_url']) && trim($body['website_url']) !== '') {
    $websiteUrl = trim($body['website_url']);
}

// --- Database operations in a transaction ---

try {
    $pdo = getDatabaseConnection();
} catch (Throwable $e) {
    error_log('euroalt-admin: DB connection failed: ' . $e->getMessage());
    jsonError(500, 'database_unavailable');
}

try {
    $pdo->beginTransaction();

    // 1. Verify country_code exists (if provided)
    if ($countryCode !== null) {
        $stmt = $pdo->prepare('SELECT code FROM countries WHERE code = :code');
        $stmt->execute(['code' => $countryCode]);
        if ($stmt->fetch() === false) {
            // Unknown country code — set to null rather than failing the denial
            error_log("euroalt-admin: deny-alternative ignoring unknown country_code '$countryCode'");
            $countryCode = null;
        }
    }

    // 2. Check for duplicate slug
    $stmt = $pdo->prepare('SELECT id, status FROM catalog_entries WHERE slug = :slug');
    $stmt->execute(['slug' => $slug]);
    $existing = $stmt->fetch();
    if ($existing !== false) {
        $pdo->rollBack();
        jsonError(409, 'duplicate_slug:' . $slug . ':status:' . $existing['status']);
    }

    // 3. Verify category IDs exist (if provided)
    $categoryIds = [];
    $seenCategoryIds = [];
    $primaryCategoryId = null;
    foreach ($categories as $i => $cat) {
        if (!is_array($cat) || !isset($cat['category_id']) || !is_string($cat['category_id'])) {
            continue; // Skip invalid category entries silently for denials
        }
        $catId = trim($cat['category_id']);
        if (isset($seenCategoryIds[$catId])) {
            continue; // Skip duplicates silently
        }
        $seenCategoryIds[$catId] = true;
        $isPrimary = isset($cat['is_primary']) && ($cat['is_primary'] === true || $cat['is_primary'] === 1);
        $categoryIds[] = [
            'category_id' => $catId,
            'is_primary' => $isPrimary,
            'sort_order' => $i,
        ];
        if ($isPrimary) {
            $primaryCategoryId = $catId;
        }
    }

    // Verify categories exist in bulk (only keep valid ones)
    if (count($categoryIds) > 0) {
        $catPlaceholders = [];
        $catParams = [];
        foreach ($categoryIds as $i => $c) {
            $key = ":cat$i";
            $catPlaceholders[] = $key;
            $catParams[$key] = $c['category_id'];
        }
        $stmt = $pdo->prepare(
            'SELECT id FROM categories WHERE id IN (' . implode(',', $catPlaceholders) . ')'
        );
        $stmt->execute($catParams);
        $foundCats = $stmt->fetchAll(PDO::FETCH_COLUMN);
        $categoryIds = array_filter($categoryIds, fn($c) => in_array($c['category_id'], $foundCats, true));
        $categoryIds = array_values($categoryIds); // Re-index
    }

    // 4. Extract raw_category_label from the primary category (for denied_decisions)
    $rawCategoryLabel = null;
    if ($primaryCategoryId !== null) {
        $rawCategoryLabel = $primaryCategoryId;
    } elseif (count($categoryIds) > 0) {
        $rawCategoryLabel = $categoryIds[0]['category_id'];
    }

    // 5. INSERT into catalog_entries with status='denied'
    $stmt = $pdo->prepare('
        INSERT INTO catalog_entries (
            slug, status, source_file, is_active,
            name, description_en, description_de,
            country_code, website_url
        ) VALUES (
            :slug, :status, :source_file, :is_active,
            :name, :description_en, :description_de,
            :country_code, :website_url
        )
    ');

    $stmt->execute([
        'slug' => $slug,
        'status' => 'denied',
        'source_file' => 'research',
        'is_active' => 0,
        'name' => $name,
        'description_en' => isset($body['description_en']) && is_string($body['description_en'])
            ? trim($body['description_en']) : null,
        'description_de' => isset($body['description_de']) && is_string($body['description_de'])
            ? trim($body['description_de']) : null,
        'country_code' => $countryCode,
        'website_url' => $websiteUrl,
    ]);

    $entryId = (int) $pdo->lastInsertId();

    // 6. INSERT into entry_categories (if any valid categories)
    if (count($categoryIds) > 0) {
        $catStmt = $pdo->prepare('
            INSERT INTO entry_categories (entry_id, category_id, is_primary, sort_order)
            VALUES (:entry_id, :category_id, :is_primary, :sort_order)
        ');
        foreach ($categoryIds as $c) {
            $catStmt->execute([
                'entry_id' => $entryId,
                'category_id' => $c['category_id'],
                'is_primary' => $c['is_primary'] ? 1 : 0,
                'sort_order' => $c['sort_order'],
            ]);
        }
    }

    // 7. INSERT into denied_decisions
    $ddStmt = $pdo->prepare('
        INSERT INTO denied_decisions (
            entry_id, proposed_in, claimed_origin, actual_origin,
            raw_category_label, failed_gateways_json, text_en, sources_json
        ) VALUES (
            :entry_id, :proposed_in, :claimed_origin, :actual_origin,
            :raw_category_label, :failed_gateways_json, :text_en, :sources_json
        )
    ');

    $claimedOrigin = null;
    $actualOrigin = null;
    if (isset($body['claimed_origin']) && is_string($body['claimed_origin'])) {
        $claimedOrigin = trim($body['claimed_origin']);
    }
    if (isset($body['actual_origin']) && is_string($body['actual_origin'])) {
        $actualOrigin = trim($body['actual_origin']);
    }

    $ddStmt->execute([
        'entry_id' => $entryId,
        'proposed_in' => $proposedIn,
        'claimed_origin' => $claimedOrigin,
        'actual_origin' => $actualOrigin,
        'raw_category_label' => $rawCategoryLabel,
        'failed_gateways_json' => $failedGateways !== null ? json_encode($failedGateways) : null,
        'text_en' => $denyReason,
        'sources_json' => $sources !== null ? json_encode($sources) : null,
    ]);

    $pdo->commit();
    logAdminMutationAuditSuccess('deny-alternative', $entryId, $slug, 'denied', strlen($denyReason));
    invalidateCache();

    sendJsonResponse(201, [
        'ok' => true,
        'entry_id' => $entryId,
        'slug' => $slug,
        'status' => 'denied',
    ]);
} catch (\PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    // MySQL error 1062 = duplicate key — return 409 instead of generic 500
    if ($e->errorInfo[1] === 1062) {
        error_log('euroalt-admin: duplicate key: ' . $e->getMessage());
        jsonError(409, 'duplicate_entry');
    }
    error_log('euroalt-admin: deny-alternative failed: ' . $e->getMessage());
    jsonError(500, 'internal_error');
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('euroalt-admin: deny-alternative failed: ' . $e->getMessage());
    jsonError(500, 'internal_error');
}
