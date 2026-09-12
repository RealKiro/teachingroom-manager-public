# Development Notes

[中文](./DEVELOPMENT.md)

This document describes the architecture, data model, storage and deployment adaptation, frontend behavior, development constraints, and maintenance workflow for the Campus Equipment Asset Management System.

## Goal

The project provides a small internal web system for classroom equipment data.

It replaces direct spreadsheet editing with reviewable changes, Excel import/export, audit logs, rollback, and database backup controls.

The same business code runs in three environments: local/server (Node.js or Docker), Cloudflare Workers (Durable Objects built-in SQLite), and Vercel (Turso remote SQLite).

## Stack

- Node.js 20+
- Express 5
- SQLite: `better-sqlite3` locally; the compatible driver in `src/db-driver.js` on serverless
- ExcelJS for workbook import/export (loaded on demand)
- Express session with a SQLite-backed session store
- Standard MCP server (Streamable HTTP, endpoint `/mcp`)
- Plain HTML, CSS, and JavaScript

## Directory Layout

```text
teachingroom/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── server.js                  # Express app and all routes
│   ├── database.js                # connection singleton, schema, seeds
│   ├── db-driver.js               # storage driver layer (file / libsql / do-sqlite)
│   ├── libsql-bridge-worker.js    # libSQL sync bridge worker (Vercel/local tests only)
│   ├── mcp.js                     # MCP server (Streamable HTTP, read-only tools)
│   ├── excel.js
│   ├── timeline-rollback.js
│   ├── seed.js
│   ├── worker.js                  # Cloudflare Workers entry
│   └── do.js                      # Durable Object: binds storage, loads the app
├── api/
│   └── index.js                   # Vercel entry (exports the Express app)
├── tests/
│   ├── integration.test.js
│   ├── bootstrap.test.js
│   ├── mcp.test.js
│   └── libsql-driver.test.js
├── docs/
│   ├── README.md / README.en.md
│   ├── CHANGELOG.md / CHANGELOG.en.md
│   ├── DEPLOYMENT.md / DEPLOYMENT.en.md
│   ├── WORK_LOG_2026-05-18.md / .en.md
│   └── banner.svg                 # README hero banner
├── deploy/
│   ├── teachingroom.service       # systemd template
│   └── cloudflare/                # paid Cloudflare Containers example
├── docker/
│   ├── Dockerfile                 # multi-stage build on node:24-alpine
│   ├── docker-compose.yml         # image name overridable via TEACHINGROOM_IMAGE
│   ├── .env.example                    # config template, copy to .env
│   └── README.md
├── README.md / README.en.md
├── DEPLOYMENT.md / DEPLOYMENT.en.md
├── DEVELOPMENT.md / DEVELOPMENT.en.md
├── TIMESTAMP_LOG.md / TIMESTAMP_LOG.en.md
├── vercel.json                    # Vercel config (rewrites + daily cron)
├── wrangler.jsonc                 # Workers config (DO + Assets + Cron)
└── package.json
```

Runtime directories are excluded from Git:

```text
data/
backups/
uploads/
exports/
output/
node_modules/
```

## Backend

`src/server.js` handles:

- Static files from `public/`.
- Authentication and session endpoints.
- Classroom list and filters.
- Change request submission.
- Administrator review workflow.
- Super administrator user management.
- Audit log search and filtering.
- Single-change rollback and point-in-time rollback.
- Excel export and upload-to-review workflow.
- Read-only open API (`/api/open/*`).
- MCP server mount (`/mcp`, shares the open-API token).
- Database backups: file copy locally, SQL dump on serverless (see "Backups").
- `POST /api/cron/backup`: scheduled-backup trigger endpoint (`CRON_SECRET` Bearer check).

`src/database.js` handles:

- Opening the database through `db-driver.js` (singleton `db`).
- Schema initialization and migrations.
- Default field definitions and default users.
- Audit logging.
- Classroom value writes.

`src/db-driver.js` is the storage driver layer exposing a better-sqlite3-compatible interface (`prepare/get/all/run/exec/transaction/pragma/close`):

- `file` (default): wraps `better-sqlite3` directly; local and Docker behavior is unchanged.
- `libsql` (enabled by `LIBSQL_URL`): worker_threads + Atomics synchronous bridge over `@libsql/client`, used for Vercel/Turso; nested transactions fall back to SAVEPOINTs, named parameters are compiled to positional ones.
- `do-sqlite` (Workers): synchronous wrapper over the Durable Object's `ctx.storage.sql`; transactions use `storage.transactionSync`.

`src/mcp.js` implements the MCP server: JSON-RPC methods (`initialize`, `tools/list`, `tools/call`, …) exposing read-only tools (classroom inventory, classroom details, field definitions, statistics), authenticated with the open-API token.

`src/worker.js` + `src/do.js` are the Cloudflare Workers entry: requests are forwarded to a singleton Durable Object, which binds storage and lazily loads the existing Express app through the official `node:http` server compatibility layer.

`api/index.js` is the Vercel entry: it exports the Express app directly.

`src/excel.js` handles:

- First-run source workbook import (skipped in serverless mode).
- Uploaded workbook parsing (file path or Buffer entry points).
- Export workbook generation.

## Storage And Deployment Adaptation

| Environment | Driver | Entry | Backup format |
| --- | --- | --- | --- |
| Local / systemd / Docker | `file` (better-sqlite3) | `npm start` / image CMD | SQLite files (`backups/`) |
| Vercel | `libsql` (Turso, sync bridge) | `api/index.js` | SQL dumps (`app_backups` table) |
| Cloudflare Workers | `do-sqlite` (DO built-in SQLite) | `src/worker.js` → DO | SQL dumps (`app_backups` table) |

Serverless mode is decided by `isServerlessDatabase()` and affects: skipping the demo Excel import and in-process timers, memory-storage multer, tokens/secrets read from environment variables (or derived), dump-table backups, and `/api/cron/backup` replacing in-process scheduled backups.

## Data Model

Core tables:

```text
users
field_definitions
classrooms
classroom_values
change_requests
change_request_items
classroom_create_requests
classroom_photos
classroom_photo_requests
audit_logs
classroom_history
user_sessions
app_backups (serverless-mode backup dump table only)
inventory_items (spare parts inventory)
equipment_registry (equipment registry with unique asset_code)
equipment_transfers (equipment transfer history)
```

Classroom fields are stored as key/value rows so new fields can be added without changing the main `classrooms` table.

`classroom_history` is the immutable, classroom-scoped ledger of effective changes. Each event stores the classroom, timestamp, source, submitter, reviewer, reason, review note, and field-level old/new values. Upgrades backfill approved change and photo requests and create one enablement snapshot for every existing classroom. Future creation, approval, photo, and rollback transactions write history atomically with official data.

## Roles

- Super administrator: fixed username `admin`; can manage users, audit logs, rollback, and database backups.
- Administrator: can review classroom data changes.
- Inspector: can view data and submit change requests.

The app treats `role=admin` as data-review permission. Super administrator permission is determined by username `admin`.

## Change Workflow

1. A user submits field-level changes for a classroom.
2. The app stores a `change_requests` row plus `change_request_items` old/new values.
3. An administrator reviews the request.
4. Approved changes are written to `classroom_values`.
5. Rejected changes remain in history.
6. Audit logs preserve the workflow.
7. Approval also writes the classroom-scoped configuration history.

All non-super-admin mutations use cross-review. A submitter cannot approve their own classroom creation, field change, photo upload, or photo deletion. Pending requests are idempotent through `clientRequestId`, and approval verifies that the official old value has not changed.

## Rollback

Rollback is available only to the super administrator.

- Single rollback reverses one approved change request.
- Point-in-time rollback reverses the selected mutation and later supported field, classroom-creation, and photo mutations in reverse audit order.

Rollback only affects classroom base data. It does not roll back users, sessions, field definitions, or backups. If an old audit event lacks sufficient inverse data, the system blocks partial rollback and instructs the super administrator to use a database backup.

## Backups

Backups have two modes chosen by the storage driver:

- Local (`file` driver): `wal_checkpoint`, then copy the SQLite file into `backups/`; `BACKUP_MIRROR_DIR` mirrors to a second directory. Restore = validate → `before_restore` backup → swap database file → process restart.
- Serverless (`libsql` / `do-sqlite`): a SQL dump (schema + per-row INSERTs with hex-encoded BLOBs) is stored in the `app_backups` table and rotated by `AUTO_BACKUP_KEEP`; restore runs drop + recreate + insert inside a transaction, takes effect immediately, and clears all sessions. Upload restore accepts both this system's `.sql` dumps and SQLite binary files.

Backup types:

```text
auto
manual
before_restore
```

Before restore, the app validates (SQLite binary input):

- SQLite integrity.
- Required system tables.
- Presence of the `admin` user.

## Frontend

`public/app.js` uses browser APIs only.

It renders:

- Desktop table view.
- Mobile card view.
- Change request editor.
- Review panel.
- User management dialog.
- Audit log dialog.
- Database backup dialog.

Timestamps are stored as UTC-like SQLite timestamps and displayed in `Asia/Shanghai` in the browser.

Weak-network classroom changes, classroom creation, photo upload, and photo deletion use an IndexedDB outbox. Review, rollback, user management, and database restore are intentionally never queued because delayed execution would be unsafe.

## Development Workflow

```bash
npm install
npm test
npm start
```

`npm test` runs `node --check` syntax checks over all of `src/` and `public/`, then executes the four test groups in `tests/`:

- `integration.test.js`: review, session, rollback, open API, and Excel end-to-end flows.
- `bootstrap.test.js`: first startup generates one-time admin credentials (relies on POSIX file permissions; fails on Windows locally, passes in CI).
- `mcp.test.js`: MCP handshake, auth, tool calls, and error codes.
- `libsql-driver.test.js`: boots the whole app on the libSQL sync bridge via `LIBSQL_URL=file:`, covering login/session, backup dumps and restore, and transaction/savepoint semantics.

Open:

```text
http://localhost:3000/
```

## Development Constraints

New features must preserve the following invariants or one of the runtimes breaks:

1. **Database access only through the `db` singleton** exported by `src/database.js`. Business code must not `import better-sqlite3`; native modules load lazily through `db-driver.js`.
2. **No top-level `createRequire(import.meta.url)` or `fileURLToPath(import.meta.url)`** in modules loaded on Workers — workerd leaves `import.meta.url` undefined at module scope and the Worker would crash on startup. Wrap them in lazy functions and only execute inside the `file`/`libsql` driver branches.
3. **Large dependencies load on demand**: `exceljs` is imported dynamically via `loadExcelModule()` to keep the Workers free-plan bundle within 3MB.
4. **Filesystem operations need a serverless guard**: branch on `isServerlessDatabase()`; serverless runtimes have no writable filesystem (only `/tmp` on Vercel, none on Workers), so persistent data goes to the database or environment variables.
5. **Both backup modes must be maintained together**: when touching backup/restore logic, cover the file mode and the `app_backups` dump mode with tests.
6. **SQL stays SQLite dialect and compatible with all three drivers**: `RETURNING` and `datetime('now')` are fine; do not issue explicit `BEGIN`/`SAVEPOINT` statements (DO SQL rejects them) — use `db.transaction()`.
7. **Docker files live in `docker/`**; `.dockerignore` must stay at the repository root because of build-context constraints.
8. **Documentation is bilingual**: when changing README/DEPLOYMENT/DEVELOPMENT, update the `.en.md` counterpart and check the cross-links.

## Suggested Checks Before Commit

```bash
npm audit
npm test
git status --short
```

Manual browser checks:

- Login as `admin`.
- Open operation log.
- Open database backup dialog.
- Create a backup.
- Export Excel.
- Check mobile width around `375px`.

For deployment-related changes, CI runs the `workers-smoke` job automatically (`wrangler dev` verifying health, login, classroom creation, and backups) — no local repetition needed.

## Repository Hygiene

- Keep real deployment IPs, usernames, passwords, secrets, tokens, and local paths out of committed files.
- Keep runtime data out of Git.
- Commit source code, static assets, documentation, deployment templates, and the seed workbook only.
- Record GitHub upload and handoff details in `TIMESTAMP_LOG.en.md`.
