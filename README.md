# SSL Sticker Store

Collect, open packs, exchange duplicates in the factory, and trade sticker cards with other Simulation Soccer League members. Users log in with their SSL forum (MyBB) account.

One Next.js application (Pages Router) serves both the React interface and the API:

```text
Browser ──> Next.js pages (src/pages, src/views, src/components)
        └─> /api/v1/* routes (src/pages/api) ──> MySQL (stickers database)
                                              ├─> MySQL (MyBB forum database, read-only)
                                              └─> Cloudinary (card images)
```

## Requirements

- Node.js 22 (`.nvmrc`) and npm
- MySQL 8.0 with:
  - the stickers database;
  - read access to the MyBB forum database (`mybb_users`).
- A Cloudinary account for card images

## Getting started

```sh
npm install
cp .env.example .env.local      # then fill in real values
npm run db:migrate              # bring an existing stickers database up to date
npm run dev                     # http://localhost:3000
```

To start a fresh database instead, create it, then run:

```sh
npm run db:schema:load
npm run db:seed
```

`db:seed` loads approved original cards for development only.

## Configuration

Every variable is documented in [`.env.example`](.env.example). The essentials:

| Variable | Purpose |
|---|---|
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Stickers database |
| `MYBB_DATABASE` (+ optional `MYBB_MYSQL_HOST` / `_USERNAME` / `_PASSWORD`) | Forum database used for login. Use a SELECT-only account. |
| `SESSION_SECRET` | Signs login cookies; at least 32 random characters |
| `PACK_GRANT_API_TOKEN` | Bearer token for `POST /api/v1/external/pack_grants` |
| `CLOUDINARY_URL` | Cloudinary credentials (server only) |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Cloud name used to build image URLs in the browser |
| `APP_ORIGIN`, `TRUST_PROXY` | Production behind a reverse proxy; see `.env.example` |

Server-only values must never use the `NEXT_PUBLIC_` prefix.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run types:check` | TypeScript |
| `npm test` | Unit tests (`tests/unit`) |
| `npm run test:integration` | Builds, then runs `tests/integration` against the disposable `myapp_test` database and a local fake Cloudinary |
| `npm run db:migrate` | Applies `db/migrations` (`--status`, `--dry-run`, `--database=NAME`) |
| `npm run db:schema:dump` / `db:schema:load` | Writes / loads `db/schema.sql` (non-destructive) |
| `npm run db:seed` | Loads `db/seeds/*.sql` into a development database |
| `npm run db:delete-unlinked-users` | Lists, or with `--confirm` deletes, users that have no forum account |
| `npm run cloudinary:export -- --out=<folder>` | Downloads every image in the Cloudinary account (paths = public IDs) plus `manifest.json`; read-only, resumable, `--dry-run` to list |
| `npm run cards:build-upload-zips -- [--export=<dir>] [--out=<dir>] [--name=<id>:<name>]` | Turns an export into Card Upload ZIPs (one per rarity), naming each image from its card's data, to recreate the cards from scratch through the site |

**Card upload file names:** `Player_Name-rarity-season-Team_Name.png`, for example `John_Doe-gold-S23-Tokyo_S.C..png`.
- Underscores become spaces.
- The season is the first two digits of its segment.
- The team is optional, and anything after it is ignored (e.g. `-2` to upload two images of the same card).
- Names and teams can't contain `-` or `_`.
- For accented team names, create the ZIP with a tool that stores UTF-8 file names (e.g. 7-Zip).

## Project layout

```text
src/
  pages/            Next.js pages (one thin file per URL) and API routes (pages/api/v1)
  views/            Screen components (Home, PackPage, MyFolder, Trading, FactoryPage, CardUpload)
  components/       Shared UI
  api/              Browser API clients (built on src/lib/request.ts)
  lib/              Browser-side helpers and config
  server/           Server-only code: db.ts, auth/, services/, cloudinary.ts. Never import from the browser.
  utils/            Context provider, route guard, window events
db/
  migrations/       Schema migrations (versions recorded in schema_migrations)
  schema.sql        Current schema (generated)
  seeds/            Development seed data
scripts/            Database command-line tools
tests/              Unit and integration tests, fixtures, fake Cloudinary
docs/               API reference, deployment guide
```

## How it works

- **Login:**
  1. The app checks the user's forum username and password against `mybb_users`, supporting MyBB's salted MD5 and bcrypt hashes. Banned (group 7) and awaiting-activation (group 5) accounts are refused.
  2. The stickers user is linked by `users.forum_uid`, and created on first login.
  3. The session is a signed, HTTP-only cookie lasting 30 days and renewed with activity.
- **Roles** (`users.status`): `0` normal, `1` moderator, `3` admin. `2` was the retired card_approver role.
  - **Moderators** can only upload cards (Card Upload); their uploads wait in the review queue.
  - **Admins** can do everything: their uploads publish immediately, and they review the queue, approve or remove cards, and manage roles.
  - Admins see **Admin** in the account menu: an admin area (`/admin`) with **Card Upload** (`/CardUpload`), **Card Approval** (`/admin/approvals`, the review queue) and **User Roles** (`/admin/users`, change other users' roles).
  - Admins cannot change their own role, so at least one admin always remains.
  - The first admin must be set in the database: `UPDATE users SET status = 3 WHERE username = '<name>';`.
- **Authorization:** enforced in the API routes, not only in the UI. Role changes apply on the user's next request. Data-changing requests must come from the site itself (`Origin` check).
- **Card IDs:** `user_cards.uuid` is `VARBINARY(16)`. The API exposes standard UUID strings (`src/server/uuid.ts`).
- **Packs, factory and trades:** these run in MySQL transactions with row locks, so concurrent requests cannot spend the same pack or card twice.

[`docs/api.md`](docs/api.md) describes every endpoint. [`docs/deployment.md`](docs/deployment.md) covers production setup.

## History

Until October 2026 the app was a Ruby on Rails API with a Vite frontend. That code remains in `EnHoraBuena-Boca/StickerStore2` (branch `Login-Pack-Logic`).
