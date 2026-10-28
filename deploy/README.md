# Деплой corvexo-games.com

При каждом push в `main` GitHub Actions (`.github/workflows/deploy.yml`) копирует сайт
по SSH (rsync) на сервер `207.180.234.251` в `/var/www/corvexo/`. nginx отдаёт его по HTTPS.

## 1. Ключ для GitHub Actions (на своём Mac)

```bash
ssh-keygen -t ed25519 -N "" -C github-actions -f ~/.ssh/corvexo_deploy
```

## 2. Настройка сервера (один раз)

Скопировать скрипт и запустить от root:

```bash
scp deploy/setup-server.sh root@207.180.234.251:/root/
```

```bash
ssh root@207.180.234.251 "bash /root/setup-server.sh corvexo-games.com YOUR_EMAIL '$(cat ~/.ssh/corvexo_deploy.pub)'"
```

Скрипт ставит nginx, rsync, certbot, создаёт пользователя `deploy`, открывает порты 80/443
и получает SSL-сертификат Let's Encrypt (автопродление включено).

`www.corvexo-games.com` попадёт в сертификат, только если в DNS есть запись
`www → 207.180.234.251` (сейчас её нет). Добавьте её в панели internet.am и перезапустите скрипт.

## 3. Секреты в GitHub

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Секрет | Значение |
|---|---|
| `SSH_HOST` | `207.180.234.251` |
| `SSH_PRIVATE_KEY` | содержимое `~/.ssh/corvexo_deploy` (приватный ключ) |
| `SSH_KNOWN_HOSTS` | вывод `ssh-keyscan 207.180.234.251` |
| `SSH_PORT` | только если SSH не на 22 |

## 4. GitHub Pages

Settings → Pages → отключить (Source: None), чтобы не было второй копии сайта.

## Проверка

Push в `main` или Actions → "Deploy to server" → Run workflow. Последний шаг проверяет `https://corvexo-games.com/`.
