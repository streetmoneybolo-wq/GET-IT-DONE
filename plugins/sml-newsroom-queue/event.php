<?php
namespace StockMarketLoop\NewsroomQueue;

/** Pure validation: no WordPress, network, model calls or publication. */
function normalize_event(array $input, int $now): array {
    $required = array('authority', 'event_id', 'event_type', 'title', 'source_url', 'observed_at', 'expires_at');
    foreach ($required as $field) {
        if (!isset($input[$field]) || !is_string($input[$field]) || trim($input[$field]) === '') {
            throw new \InvalidArgumentException('Missing or invalid ' . $field);
        }
    }
    $authority = strtolower(trim($input['authority']));
    $type = strtolower(trim($input['event_type']));
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{0,99}$/D', $authority) ||
        !preg_match('/^[a-z][a-z0-9_-]{0,49}$/D', $type)) {
        throw new \InvalidArgumentException('Invalid authority or event type');
    }
    $id = trim($input['event_id']);
    $title = trim(strip_tags($input['title']));
    if (strlen($id) > 250 || preg_match('/[\x00-\x1f\x7f]/', $id) || $title === '' || strlen($title) > 500) {
        throw new \InvalidArgumentException('Invalid event ID or title');
    }
    $url = trim($input['source_url']);
    $parts = parse_url($url);
    if (strlen($url) > 2048 || !filter_var($url, FILTER_VALIDATE_URL) ||
        ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
        throw new \InvalidArgumentException('A public HTTPS evidence URL is required');
    }
    $times = array();
    foreach (array('observed_at', 'expires_at') as $field) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/D', $input[$field])) {
            throw new \InvalidArgumentException('Timestamp requires explicit timezone');
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:sP', str_replace('Z', '+00:00', $input[$field]));
        $errors = \DateTimeImmutable::getLastErrors();
        if (!$date || ($errors && ($errors['warning_count'] || $errors['error_count']))) {
            throw new \InvalidArgumentException('Invalid calendar timestamp');
        }
        $times[$field] = $date->getTimestamp();
    }
    if ($times['observed_at'] > $now + 60 || $times['expires_at'] <= $now || $times['expires_at'] <= $times['observed_at']) {
        throw new \InvalidArgumentException('Expired evidence or future observation');
    }
    $symbols = $input['symbols'] ?? null;
    if (!is_array($symbols) || !array_is_list($symbols) || count($symbols) < 1 || count($symbols) > 10) {
        throw new \InvalidArgumentException('Provide 1–10 symbols');
    }
    foreach ($symbols as &$symbol) {
        if (!is_string($symbol)) throw new \InvalidArgumentException('Invalid symbol');
        $symbol = strtoupper(trim($symbol));
        if (!preg_match('/^[A-Z][A-Z0-9.-]{0,11}$/D', $symbol)) throw new \InvalidArgumentException('Invalid symbol');
    }
    unset($symbol);
    $symbols = array_values(array_unique($symbols));
    sort($symbols, SORT_STRING);
    $evidence = $input['evidence'] ?? null;
    if (!is_array($evidence) || !$evidence || array_is_list($evidence)) {
        throw new \InvalidArgumentException('Provide an evidence object, not unsourced prose');
    }
    $evidence_json = json_encode($evidence, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
    if (strlen($evidence_json) > 32000) throw new \InvalidArgumentException('Evidence exceeds 32 KB');
    // Source values are retained, including null. They are not independently verified here.
    return array(
        'event_key' => hash('sha256', json_encode(array($authority, $id), JSON_THROW_ON_ERROR)),
        'authority' => $authority, 'event_id' => $id, 'event_type' => $type,
        'title' => $title, 'source_url' => $url, 'symbols' => $symbols,
        'observed_at' => gmdate('Y-m-d\TH:i:s\Z', $times['observed_at']),
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $times['expires_at']),
        'evidence' => $evidence,
        'review_state' => 'needs_editorial_review',
    );
}

function canonical_json(array $value): string {
    $sort = static function ($item) use (&$sort) {
        if (!is_array($item)) return $item;
        if (!array_is_list($item)) ksort($item, SORT_STRING);
        foreach ($item as $key => $child) $item[$key] = $sort($child);
        return $item;
    };
    return json_encode($sort($value), JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
}
