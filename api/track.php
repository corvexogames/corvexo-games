<?php
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  exit;
}
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
if ($ua === '' || preg_match('/bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|httpclient/i', $ua)) {
  http_response_code(204);
  exit;
}

$in = json_decode(file_get_contents('php://input', false, null, 0, 4096) ?: '', true);
$type = is_array($in) ? ($in['type'] ?? '') : '';
if (!in_array($type, ['view', 'click', 'download'], true)) {
  http_response_code(400);
  exit;
}

$text = fn($key, $max) => is_string($in[$key] ?? null) && trim($in[$key]) !== '' ? mb_substr(trim($in[$key]), 0, $max) : null;

$ref = $text('ref', 300);
$refHost = $ref ? parse_url($ref, PHP_URL_HOST) : null;
if ($refHost && $refHost === ($_SERVER['HTTP_HOST'] ?? '')) $refHost = null;

$device = preg_match('/iPad|Tablet/i', $ua) ? 'Планшет' : (preg_match('/Mobi|Android|iPhone/i', $ua) ? 'Телефон' : 'Компьютер');

$db = stats_db();
$day = date('Y-m-d');
$db->prepare('INSERT INTO events (ts, day, type, page, label, target, game, ref, device, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  ->execute([time(), $day, $type, $text('page', 200), $text('label', 120), $text('target', 300), $text('game', 60), $refHost, $device, visitor_id($db, $day)]);

http_response_code(204);
