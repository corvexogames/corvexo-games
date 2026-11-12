<?php
require __DIR__ . '/../api/lib.php';

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Strict', 'secure' => !empty($_SERVER['HTTPS']), 'path' => '/admin/']);
session_start();

$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$hash = admin_hash();
$error = '';

if (isset($_GET['logout'])) {
  session_destroy();
  header('Location: ./');
  exit;
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  if ($hash && password_verify($_POST['password'] ?? '', $hash)) {
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    header('Location: ./');
    exit;
  }
  sleep(1);
  $error = $hash ? 'Неверный пароль' : 'Пароль не задан: добавьте секрет ADMIN_PASSWORD в GitHub и сделайте деплой';
}
$authed = !empty($_SESSION['admin']);

$ranges = [1 => 'Сегодня', 7 => '7 дней', 30 => '30 дней', 90 => '90 дней', 0 => 'Всё время'];
$days = (int)($_GET['days'] ?? 30);
if (!isset($ranges[$days])) $days = 30;

if ($authed) {
  try {
    $db = stats_db();
    $from = $days ? date('Y-m-d', strtotime('-' . ($days - 1) . ' days')) : '0000-00-00';
    $q = function (string $sql) use ($db, $from) {
      $st = $db->prepare($sql);
      $st->execute([$from]);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    };
    $totals = $q("SELECT
      SUM(type = 'view') AS views,
      COUNT(DISTINCT CASE WHEN type = 'view' THEN day || visitor END) AS visitors,
      SUM(type = 'download') AS downloads,
      SUM(type = 'click') AS clicks
      FROM events WHERE day >= ?")[0];
    $daily = $q("SELECT day, SUM(type = 'view') AS views, COUNT(DISTINCT CASE WHEN type = 'view' THEN visitor END) AS visitors
      FROM events WHERE day >= ? GROUP BY day ORDER BY day");
    $games = $q("SELECT game, COUNT(*) AS n, COUNT(DISTINCT day || visitor) AS people FROM events
      WHERE day >= ? AND type = 'download' GROUP BY game ORDER BY n DESC");
    $buttons = $q("SELECT type, label, target, COUNT(*) AS n FROM events
      WHERE day >= ? AND type IN ('click', 'download') GROUP BY type, label, target ORDER BY n DESC LIMIT 25");
    $pages = $q("SELECT page, COUNT(*) AS n FROM events WHERE day >= ? AND type = 'view' GROUP BY page ORDER BY n DESC LIMIT 15");
    $refs = $q("SELECT ref, COUNT(*) AS n FROM events WHERE day >= ? AND type = 'view' AND ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 15");
    $devices = $q("SELECT device, COUNT(DISTINCT day || visitor) AS n FROM events WHERE day >= ? AND type = 'view' GROUP BY device ORDER BY n DESC");

    /* one bar per day, empty days included, so gaps are visible */
    $byDay = array_column($daily, null, 'day');
    $first = $days ? $from : ($daily[0]['day'] ?? date('Y-m-d'));
    $series = [];
    for ($t = strtotime($first); $t <= strtotime(date('Y-m-d')); $t += 86400) {
      $d = date('Y-m-d', $t);
      $series[] = ['day' => $d, 'visitors' => (int)($byDay[$d]['visitors'] ?? 0), 'views' => (int)($byDay[$d]['views'] ?? 0)];
    }
    $series = array_slice($series, -120);
    $peak = max(1, ...array_column($series, 'visitors'));
  } catch (Throwable $e) {
    $error = 'Ошибка базы статистики: ' . $e->getMessage();
  }
}

$months = ['', 'янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
$fmtDay = fn($d) => (int)substr($d, 8) . ' ' . $months[(int)substr($d, 5, 2)];

function bars(array $rows, string $key, string $valueKey, callable $h): string {
  if (!$rows) return '<p class="empty">Пока нет данных</p>';
  $max = max(1, ...array_column($rows, $valueKey));
  $out = '<ul class="hbars">';
  foreach ($rows as $r) {
    $out .= '<li><span class="name">' . $h($r[$key] ?: '—') . '</span><span class="track"><i style="width:' . round($r[$valueKey] / $max * 100, 1) . '%"></i></span><b>' . (int)$r[$valueKey] . '</b></li>';
  }
  return $out . '</ul>';
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Corvexo Stats</title>
<link rel="icon" type="image/svg+xml" href="../images/corvexo-logo.svg">
<style>
@font-face{font-family:"Unbounded";src:url(../assets/fonts/unbounded-latin-wght-normal.woff2) format("woff2");font-weight:200 900;font-display:swap}
@font-face{font-family:"Onest";src:url(../assets/fonts/onest-latin-wght-normal.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--bg:#05040f;--card:#0f0c22;--text:#f3f1ff;--muted:#a9a3cf;--line:rgba(255,255,255,.1);--grid:rgba(255,255,255,.07);--accent:#fb923c;--bar:#a35ef0;--bar-hover:#c08bff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 "Onest","Segoe UI",Roboto,-apple-system,sans-serif}
main{max-width:72rem;margin:0 auto;padding:1.5rem 16px 4rem}
h1,h2{font-family:"Unbounded",system-ui,sans-serif;font-weight:600;margin:0}
h1{font-size:1.25rem}
h2{font-size:.85rem;color:var(--muted);letter-spacing:.02em;margin-bottom:1rem}
a{color:var(--accent)}
.top{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
.top .brand{display:flex;align-items:center;gap:10px}
.ranges{display:flex;flex-wrap:wrap;gap:6px}
.ranges a{padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted);text-decoration:none;font-size:.85rem}
.ranges a.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:12px}
.tile,.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
.tile span{display:block;color:var(--muted);font-size:.85rem}
.tile b{display:block;font:600 2rem/1.2 "Unbounded",system-ui,sans-serif;margin-top:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:12px;margin-top:12px}
.chart{position:relative;display:flex;align-items:flex-end;gap:2px;height:200px;border-bottom:1px solid var(--line);background:repeating-linear-gradient(to top,var(--grid) 0 1px,transparent 1px 50px)}
.chart .col{flex:1;height:100%;display:flex;align-items:flex-end;position:relative;min-width:0}
.chart .col i{display:block;width:100%;max-width:28px;margin:0 auto;background:var(--bar);border-radius:4px 4px 0 0;min-height:2px}
.chart .col.zero i{background:var(--line)}
.chart .col:hover i{background:var(--bar-hover)}
.chart .tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:6px 10px;border-radius:8px;font-size:.8rem;white-space:nowrap;z-index:2;pointer-events:none}
.chart .col:hover .tip{display:block}
.chart .col:first-child .tip{left:0;transform:none}
.chart .col:last-child .tip{left:auto;right:0;transform:none}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:.75rem;margin-top:6px}
.peak{color:var(--muted);font-size:.75rem;margin:-.5rem 0 .5rem}
.hbars{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.hbars li{display:grid;grid-template-columns:minmax(0,10rem) 1fr auto;gap:12px;align-items:center}
.hbars .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hbars .track{height:10px;background:var(--grid);border-radius:4px;overflow:hidden}
.hbars .track i{display:block;height:100%;background:var(--bar);border-radius:0 4px 4px 0;min-width:2px}
.hbars b{font-variant-numeric:tabular-nums;min-width:2.5rem;text-align:right}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
td small{display:block;color:var(--muted);word-break:break-all}
.pill{display:inline-block;font-size:.72rem;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill.dl{border-color:var(--accent);color:var(--accent)}
.empty{color:var(--muted);margin:0}
.note{color:var(--muted);font-size:.8rem;margin-top:2rem}
.error{background:#3a1020;border:1px solid #f87171;color:#fecaca;padding:12px 16px;border-radius:12px;margin-bottom:1rem}
.login{max-width:22rem;margin:18vh auto 0;padding:0 16px}
.login form{display:grid;gap:12px;margin-top:1.5rem}
.login input,.login button{font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text)}
.login button{background:var(--accent);border-color:var(--accent);color:#1a0e2e;font-weight:600;cursor:pointer}
details summary{cursor:pointer;color:var(--muted);font-size:.85rem;margin-top:1rem}
</style>
</head>
<body>
<script>try { localStorage.setItem('cx-no-track', '1'); } catch {}</script>
<?php if (!$authed): ?>
<div class="login">
  <h1>Corvexo Stats</h1>
  <form method="post">
    <?php if ($error): ?><div class="error"><?= $h($error) ?></div><?php endif ?>
    <input type="password" name="password" placeholder="Пароль" autocomplete="current-password" required autofocus>
    <button>Войти</button>
  </form>
</div>
<?php else: ?>
<main>
  <div class="top">
    <div class="brand"><img src="../images/corvexo-logo.svg" alt="" width="30" height="30"><h1>Статистика сайта</h1></div>
    <nav class="ranges">
      <?php foreach ($ranges as $d => $name): ?><a href="?days=<?= $d ?>" class="<?= $d === $days ? 'on' : '' ?>"><?= $name ?></a><?php endforeach ?>
      <a href="?logout=1">Выйти</a>
    </nav>
  </div>

  <?php if ($error): ?><div class="error"><?= $h($error) ?></div><?php else: ?>

  <div class="tiles">
    <div class="tile"><span>Посетители</span><b><?= (int)$totals['visitors'] ?></b></div>
    <div class="tile"><span>Просмотры страниц</span><b><?= (int)$totals['views'] ?></b></div>
    <div class="tile"><span>Переходы в Google Play</span><b><?= (int)$totals['downloads'] ?></b></div>
    <div class="tile"><span>Другие нажатия</span><b><?= (int)$totals['clicks'] ?></b></div>
  </div>

  <section class="card">
    <h2>Посетители по дням</h2>
    <p class="peak">Максимум: <?= $peak ?> в день</p>
    <div class="chart" role="img" aria-label="Посетители по дням">
      <?php foreach ($series as $p): ?>
        <div class="col<?= $p['visitors'] ? '' : ' zero' ?>"><i style="height:<?= round($p['visitors'] / $peak * 100, 1) ?>%"></i><span class="tip"><?= $fmtDay($p['day']) ?> · <?= $p['visitors'] ?> посет. · <?= $p['views'] ?> просм.</span></div>
      <?php endforeach ?>
    </div>
    <div class="axis"><span><?= $fmtDay($series[0]['day']) ?></span><span><?= $fmtDay(end($series)['day']) ?></span></div>
    <details>
      <summary>Таблица</summary>
      <table><tr><th>День</th><th class="n">Посетители</th><th class="n">Просмотры</th></tr>
        <?php foreach (array_reverse($series) as $p): ?><tr><td><?= $fmtDay($p['day']) ?></td><td class="n"><?= $p['visitors'] ?></td><td class="n"><?= $p['views'] ?></td></tr><?php endforeach ?>
      </table>
    </details>
  </section>

  <div class="grid">
    <section class="card">
      <h2>Какие игры хотят скачать</h2>
      <?= bars($games, 'game', 'n', $h) ?>
      <?php if ($games): ?><p class="note" style="margin-top:1rem">Нажатий на «Get it on Google Play»; разных людей: <?= implode(', ', array_map(fn($g) => $h($g['game']) . ' — ' . (int)$g['people'], $games)) ?></p><?php endif ?>
    </section>
    <section class="card">
      <h2>Устройства</h2>
      <?= bars($devices, 'device', 'n', $h) ?>
    </section>
  </div>

  <section class="card" style="margin-top:12px">
    <h2>Какие кнопки и ссылки нажимали</h2>
    <?php if (!$buttons): ?><p class="empty">Пока нет данных</p><?php else: ?>
    <table>
      <tr><th>Кнопка</th><th>Тип</th><th class="n">Нажатий</th></tr>
      <?php foreach ($buttons as $b): ?>
        <tr><td><?= $h($b['label'] ?: '—') ?><small><?= $h($b['target']) ?></small></td>
          <td><span class="pill<?= $b['type'] === 'download' ? ' dl' : '' ?>"><?= $b['type'] === 'download' ? 'Скачать' : 'Клик' ?></span></td>
          <td class="n"><?= (int)$b['n'] ?></td></tr>
      <?php endforeach ?>
    </table>
    <?php endif ?>
  </section>

  <div class="grid">
    <section class="card">
      <h2>Страницы</h2>
      <?= bars($pages, 'page', 'n', $h) ?>
    </section>
    <section class="card">
      <h2>Откуда пришли</h2>
      <?= $refs ? bars($refs, 'ref', 'n', $h) : '<p class="empty">Только прямые заходы</p>' ?>
    </section>
  </div>

  <p class="note">Посетитель считается один раз в день (без cookies, IP не хранится). Ваши собственные заходы с этого браузера не учитываются.</p>
  <?php endif ?>
</main>
<?php endif ?>
</body>
</html>
