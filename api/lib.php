<?php
/* Shared by the tracker and the admin page. Stats live outside the site folder so a deploy (rsync --delete) never wipes them. */
date_default_timezone_set('Asia/Yerevan');

function stats_dir(): string {
  return getenv('CORVEXO_STATS_DIR') ?: dirname(__DIR__, 2) . '/corvexo-stats';
}

function stats_db(): PDO {
  static $db = null;
  if ($db) return $db;
  $dir = stats_dir();
  if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
    throw new RuntimeException("Cannot create stats folder $dir");
  }
  $db = new PDO('sqlite:' . $dir . '/stats.sqlite');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  $db->exec('CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    type TEXT NOT NULL,
    page TEXT,
    label TEXT,
    target TEXT,
    game TEXT,
    ref TEXT,
    device TEXT,
    visitor TEXT NOT NULL
  )');
  $db->exec('CREATE INDEX IF NOT EXISTS events_day ON events(day, type)');
  $db->exec('CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)');
  return $db;
}

/* Visitors are counted per day with a salt that is dropped the next day, so nobody can be followed across days and no cookie is needed. */
function visitor_id(PDO $db, string $day): string {
  $salt = $db->query('SELECT salt FROM salts WHERE day = ' . $db->quote($day))->fetchColumn();
  if (!$salt) {
    $salt = bin2hex(random_bytes(16));
    $db->prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)')->execute([$day, $salt]);
    $db->prepare('DELETE FROM salts WHERE day < ?')->execute([$day]);
    $salt = $db->query('SELECT salt FROM salts WHERE day = ' . $db->quote($day))->fetchColumn();
  }
  $ip = $_SERVER['HTTP_X_REAL_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
  $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
  return substr(hash('sha256', $salt . $ip . $ua), 0, 16);
}

function admin_hash(): string {
  $file = __DIR__ . '/config.php';
  $config = is_file($file) ? include $file : [];
  return $config['admin_hash'] ?? '';
}
