# Deploying SSL Sticker Store

The app is one Node.js server (Next.js) running on the same machine as the MySQL server that hosts both the stickers database and the MyBB forum database. A static host cannot run it: the API routes need Node, MySQL and Cloudinary access.

## 1. Prerequisites

- Node.js 22 and npm on the server.
- A reverse proxy for TLS (nginx in the examples).
- MySQL accounts:
  - **App account**, on the stickers database. Day-to-day it needs `SELECT, INSERT, UPDATE, DELETE`; loading the schema and running migrations also need `CREATE, ALTER, INDEX`. Use a separate migration account if you prefer.
  - **Forum account**, read-only, on the users table only:

    ```sql
    CREATE USER 'stickers_forum'@'localhost' IDENTIFIED BY '<strong password>';
    GRANT SELECT ON mybbdb.mybb_users TO 'stickers_forum'@'localhost';
    ```

    Adjust the database and table names to the forum's real ones (see step 3).

## 2. Configure

Create the environment file (for example `/etc/ssl-stickers.env`, readable only by the service user) from [`.env.example`](../.env.example):

```sh
NODE_ENV=production
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USERNAME=stickers_app
MYSQL_PASSWORD=...
MYSQL_DATABASE=<stickers database>
MYBB_DATABASE=<forum database>
MYBB_USERS_TABLE=<prefix>users
MYBB_MYSQL_USERNAME=stickers_forum
MYBB_MYSQL_PASSWORD=...
SESSION_SECRET=<48+ random characters>
PACK_GRANT_API_TOKEN=<random token shared with the pack-grant caller>
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=<cloud>
APP_ORIGIN=https://<public host>
TRUST_PROXY=true
```

Generate a secret with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Notes:
- **Build-time variable:** `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` is compiled into the browser bundle at build time, so it must be set when you run `npm run build`.
- **Server-only variables:** everything else is read when the server runs.

## 3. Pre-launch checks (production data)

Run these against the production forum database before the first launch.

**Forum users table name.** MyBB prefixes its tables (`mybb_` by default):

```sql
SHOW TABLES LIKE '%users';
```

Set `MYBB_USERS_TABLE` accordingly.

**Password formats.** The app verifies MyBB salted MD5 (`password_algorithm` empty or `mybb`) and bcrypt (`bcrypt`, or `$2a$`/`$2b$`/`$2y$` hashes). Everything else is refused at login and logged as "unsupported".

```sql
SELECT password_algorithm, password_encryption, LEFT(password, 4) AS prefix, COUNT(*) AS users
  FROM <prefix>users
 GROUP BY 1, 2, 3
 ORDER BY users DESC;
```

If any rows are not covered (for example `argon2`, `$2x$`, or `password_encryption <> 0`), extend `src/server/auth/mybbPassword.ts` before launch.

**Blocked user groups.** The app refuses usergroup 5 (awaiting activation) and 7 (banned), the MyBB defaults. Confirm them, and edit `BLOCKED_USERGROUPS` in `src/server/auth/forumUsers.ts` if the SSL forum differs:

```sql
SELECT gid, title FROM <prefix>usergroups ORDER BY gid;
```

## 4. Create the database

Create an empty stickers database, then load the schema. `db/schema.sql` also records every migration as applied, so no migrations are needed afterwards.

```sql
CREATE DATABASE <stickers db> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```sh
npm run db:schema:load
```

Don't run `db:seed` in production; it loads development cards. Cards are added through the site instead (step 6).

**Later updates:** after pulling a new version, back up the database and run `npm run db:migrate` (try `-- --dry-run` first) before restarting the app.

## 5. Build and run

```sh
npm ci
npm run build
npm start -- -p 3000 -H 127.0.0.1
```

Example systemd unit (`/etc/systemd/system/ssl-stickers.service`):

```ini
[Unit]
Description=SSL Sticker Store
After=network.target mysql.service

[Service]
User=ssl-stickers
WorkingDirectory=/srv/ssl-stickers
EnvironmentFile=/etc/ssl-stickers.env
ExecStart=/usr/bin/npm start -- -p 3000 -H 127.0.0.1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Run a **single instance**: the login rate limiter is in memory. Several instances would need a shared store.

Example nginx site:

```nginx
server {
    listen 443 ssl;
    server_name <public host>;
    # ssl_certificate / ssl_certificate_key ...

    # Card uploads accept ZIPs up to 50 MB.
    client_max_body_size 52m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, do not append
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 6. After launch

- **First admin:** log in once, which creates your stickers account, then make yourself an admin. Later role changes are made in the app under Admin → User Roles.

  ```sql
  UPDATE users SET status = 3 WHERE username = '<your forum username>';
  ```

- **Cards:** the database starts with no cards. Upload them as an admin through Card Upload (see the file name format in the README). Packs and factory exchanges return `503` until every rarity has at least one approved card.
- **Health:** `GET /api/health` returns `200 {"status":"ok","database":"ok","forum":"ok"}`, or `503` if either database is unreachable.
- **Pack grants:** give the external system that grants packs the URL `https://<public host>/api/v1/external/pack_grants` and the `PACK_GRANT_API_TOKEN` (sent as `Authorization: Bearer <token>`). See `docs/api.md`.
- **Smoke test in a browser:**
  - log in with a wrong password (the error is shown), then correctly;
  - as a moderator, upload a small ZIP; as an admin, approve or delete it under Card Approval;
  - grant a pack, then open it;
  - browse My Collection;
  - make and accept a trade between two accounts;
  - do a factory exchange.
- **Backups:** schedule regular dumps of the stickers database, for example:

  ```sh
  mysqldump --single-transaction --no-tablespaces <stickers db> > stickers-$(date +%F).sql
  ```

- **Logs:** the app writes to stdout and stderr (`journalctl -u ssl-stickers`). Search for:
  - "unsupported" — password formats that need support;
  - "Cloudinary cleanup failed" — images to fix by hand.
- **Rotating `SESSION_SECRET`** logs everyone out.
