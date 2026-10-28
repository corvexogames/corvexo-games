# Деплой corvexo-games.com

При каждом push в `main` GitHub Actions (`.github/workflows/deploy.yml`) копирует сайт
по SSH (rsync) в папку сайта на сервере `207.180.234.251`. Сервером управляет **FASTPANEL**:
nginx, SSL и сайт настраиваются в панели, вручную на сервере ничего ставить не нужно.

## 1. HTTPS в FASTPANEL (один раз)

FASTPANEL → Сайты → corvexo-games.com → **SSL-сертификаты** → Let's Encrypt → выпустить.
Затем в настройках сайта включить **перенаправление HTTP → HTTPS**.

Если нужен `www.corvexo-games.com`, сначала добавьте A-запись `www → 207.180.234.251`
в DNS (internet.am) и укажите `www` как алиас сайта в FASTPANEL.

## 2. Пользователь и папка сайта

В FASTPANEL у сайта есть владелец (пользователь). Посмотрите:
- **имя пользователя** — это `SSH_USER`;
- **корневую папку сайта**, обычно `/var/www/<пользователь>/data/www/corvexo-games.com`, — это `DEPLOY_PATH`.

У этого пользователя должен быть включён доступ по SSH/SFTP (FASTPANEL → Пользователи → пользователь → доступ к shell).

## 3. Ключ для GitHub Actions

На своём Mac:

```bash
ssh-keygen -t ed25519 -N "" -C github-actions -f ~/.ssh/corvexo_deploy
```

Публичный ключ добавить пользователю сайта (подставьте имя пользователя):

```bash
ssh-copy-id -i ~/.ssh/corvexo_deploy.pub SSH_USER@207.180.234.251
```

Проверка:

```bash
ssh -i ~/.ssh/corvexo_deploy SSH_USER@207.180.234.251 ls
```

## 4. Секреты в GitHub

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Секрет | Значение |
|---|---|
| `SSH_HOST` | `207.180.234.251` |
| `SSH_USER` | пользователь сайта из FASTPANEL |
| `DEPLOY_PATH` | корневая папка сайта, без `/` в конце |
| `SSH_PRIVATE_KEY` | содержимое `~/.ssh/corvexo_deploy` (приватный ключ) |
| `SSH_KNOWN_HOSTS` | вывод `ssh-keyscan 207.180.234.251` |
| `SSH_PORT` | только если SSH не на 22 |

## 5. GitHub Pages

Settings → Pages → отключить, чтобы не было второй копии сайта.

## Проверка

Push в `main` или Actions → "Deploy to server" → Run workflow. Последний шаг проверяет `https://corvexo-games.com/`
(упадёт, пока не выпущен SSL из шага 1).
