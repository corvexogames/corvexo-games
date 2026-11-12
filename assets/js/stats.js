/* Cookie-free site stats: page views and clicks go to our own server (api/track.php). The admin page sets cx-no-track so the owner's visits don't count. */
(() => {
  try {
    if (localStorage.getItem('cx-no-track')) return;
  } catch {}

  const send = (data) => {
    const body = JSON.stringify({ page: location.pathname, ...data });
    if (!navigator.sendBeacon?.('/api/track.php', new Blob([body], { type: 'text/plain' }))) {
      fetch('/api/track.php', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  };

  send({ type: 'view', ref: document.referrer });

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('a, button');
    if (!el) return;
    const target = el.getAttribute('href') || '';
    const label = (el.getAttribute('aria-label') || el.textContent).replace(/\s+/g, ' ').trim();
    const store = /play\.google\.com|apps\.apple\.com/.test(target);
    const game = el.closest('[data-panel]')?.querySelector('h3')?.textContent.trim()
      || (store && new URL(target).searchParams.get('id'));
    send({ type: store ? 'download' : 'click', label, target, game: game || '' });
  }, true);
})();
