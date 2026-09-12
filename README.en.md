# TeachingRoom Manager

[中文](./README.md)

TeachingRoom Manager is a lightweight browser-based classroom equipment data system.

The repository includes `初始化数据表格（虚拟）.xlsx` for first-run demonstrations. It contains synthetic data only; the application supports classroom inventory, inspection updates, review workflows, Excel import/export, audit logs, rollback, backups, and read-only base-data integration.

The app is designed for small internal teams, so the runtime stays simple: Node.js, Express, SQLite, and plain frontend assets.

## Documentation

- [Concise deployment guide](./DEPLOYMENT.en.md)
- [Complete deployment and operations manual](./docs/DEPLOYMENT.en.md)
- [Docker files guide](./docker/README.md)
- [Development notes](./DEVELOPMENT.en.md)
- [Changelog](./docs/CHANGELOG.en.md)
- [All documentation](./docs/README.en.md)

## Features

- Import demonstration records from the synthetic Excel template on first startup.
- Responsive desktop table view and mobile/tablet card view.
- Quick filtering by building, department, update plan, pending review state, and keyword.
- Super administrator, administrator, and inspector roles; inspection submissions go through cross-review before official data is updated.
- Per-classroom configuration history: old/new field values, submitter, reviewer, photos, and rollback events, displayed in Beijing time.
- Single approved-change rollback and cross-type point-in-time rollback for fields, classrooms, and photos.
- Excel uploads generate pending review requests instead of overwriting data; export Excel by current filters.
- Automatic, manual, downloadable, uploadable, and restorable database backups.
- SQLite-backed login sessions; persistent browser outbox with idempotent retry for weak-network submissions.
- Read-only base-data API and a built-in standard MCP server for other departments and bots (such as AstrBot).

## Deployment

All application data (SQLite database, photos, backups) requires **persistent storage**, which defines the limits of each platform:

| Platform | Free tier | Free lunch? | Notes |
| --- | --- | --- | --- |
| Docker Compose (own server / Synology NAS) | Already owned | ✅ **Recommended** | Prebuilt GHCR image, data stays local |
| Cloudflare Workers | 100k requests/day + DO SQLite storage | ⚠️ Experimental | Adapted; data lives in Durable Objects built-in SQLite |
| Vercel | Function execution + daily Cron | ⚠️ Experimental | Adapted; requires external Turso free remote SQLite |
| Oracle Cloud Always Free | Permanently free ARM VM (4 OCPU / 24 GB) | ✅ | Best free VM for public access |
| Google Cloud Always Free | Permanently free e2-micro VM | ✅ | Card verification required; 1 GB RAM is enough here |
| Render / Koyeb / HF Spaces | Yes | ⚠️ Demo only | Ephemeral disk loses data on restart |
| Railway / Fly.io | One-time $5 trial credit | ❌ | Charges apply once credit is used up |
| Cloudflare Containers | ❌ | ❌ | Requires the Workers Paid plan ($5/month minimum) |
| Plain Node.js (local development) | Existing computer | ✅ | Local development and lightweight deployments |

Recommended order: use Docker Compose when you have a server or NAS; pick the Workers or Vercel serverless paths for a free public deployment (the free tiers are enough for small teams); prefer own hardware when durability matters most. Platform policies change; always verify against official docs before deploying.

### Docker Compose (recommended)

GitHub Actions automatically tests, builds `linux/amd64` + `linux/arm64` images and publishes them to GHCR on every push to main and every `v*` tag:

```text
ghcr.io/realkiro/teachingroom-manager-public:latest
```

**Step 1: prepare the image.** Before the first pull, make the GHCR package public (repository Packages → teachingroom-manager-public → Package settings → Change visibility → Public), or run `docker login ghcr.io` first; a fully local build also works and skips this step.

**Step 2: prepare the directory and secret.**

```bash
git clone https://github.com/RealKiro/teachingroom-manager-public.git
cd teachingroom-manager-public/docker
echo "SESSION_SECRET=$(openssl rand -hex 48)" > .env
```

If `SESSION_SECRET` is not set, the system generates and persists one into `data/session-secret.txt`.

**Step 3: start and verify.**

```bash
docker compose pull            # prebuilt image; for a local build use docker compose up -d --build
docker compose up -d
curl http://127.0.0.1:3000/api/health   # {"ok":true,...} means success
```

The image is a multi-stage build on `node:24-alpine`, runs as non-root, and ships with a healthcheck.

### Synology NAS (Container Manager)

Requires DSM 7.2+ (ships with Container Manager):

1. Install Container Manager from Package Center; upload the repository to `/docker/teachingroom` via File Station (or `git clone` over SSH).
2. Make the image available: set the GHCR package to public, then run `sudo docker compose -f /volume1/docker/teachingroom/docker/docker-compose.yml pull` once over SSH; or skip the pull and let Container Manager build locally in the next step.
3. Container Manager → Project → Create: set the path to `/docker/teachingroom/docker`, choose "Use an existing docker-compose.yml", and start the project.
4. Runtime data lives in `data/`, `backups/`, `uploads/`, and `exports/` under the repository folder and can be included in Hyper Backup plans.

SSH-only alternative:

```bash
ssh <USER>@<NAS_IP>
cd /volume1/docker/teachingroom/docker
echo "SESSION_SECRET=$(openssl rand -hex 48)" | sudo tee .env >/dev/null
sudo docker compose pull
sudo docker compose up -d
sudo docker compose logs -f
```

### Cloudflare Workers (free-tier friendly, experimental)

The app is adapted for Workers: the whole Express app runs inside a single Durable Object with data stored in the DO's built-in SQLite (business code identical to local/Docker runs).

**Step 1: install the tooling and log in.**

```bash
npm install
npx wrangler login
```

**Step 2: prepare environment variables.** Configure them in the Cloudflare dashboard (Workers → Settings → Variables) or in the `vars` block of `wrangler.jsonc`; required variables are listed in the serverless env table below (`SESSION_SECRET` is required; `INITIAL_ADMIN_PASSWORD` and `CRON_SECRET` are recommended).

**Step 3: deploy and verify.**

```bash
npx wrangler deploy
curl https://<your-subdomain>.workers.dev/api/health
```

You can also connect the GitHub repository in the Cloudflare dashboard for automatic deploys. After the first deployment, if `INITIAL_ADMIN_PASSWORD` was not set, the admin password is printed to the deployment logs.

Notes:

- Free plan limits: 100k requests/day; DO SQLite storage allowance is small, so keep photo sizes small (8MB per photo max).
- Backups on Workers are SQL dumps (`.sql`), no longer SQLite binaries; scheduled backups require `CRON_SECRET` plus a Cron Trigger added in the dashboard (`POST /api/cron/backup`).
- Restoring a 200MB uploaded database file is limited by Worker memory; prefer the "enable server backup" flow with a `.sql` dump exported by this system.
- Compatibility relies on `nodejs_compat` + `enable_nodejs_http_server_modules` (official Node HTTP server / Express support since 2025-09). The capability is new — verify fully on your own account before production use.

### Vercel (free-tier friendly, experimental)

On Vercel the database is Turso (free remote libSQL; SQLite dialect unchanged).

**Step 1: create the Turso database.**

```bash
npm install -g @turso/cli
turso auth login
turso db create teachingroom
turso db show teachingroom --url          # → LIBSQL_URL
turso db tokens create teachingroom       # → LIBSQL_AUTH_TOKEN
```

**Step 2: deploy to Vercel and configure environment variables.**

```bash
npm install -g vercel
vercel link
vercel env add LIBSQL_URL production
vercel env add LIBSQL_AUTH_TOKEN production
vercel env add SESSION_SECRET production   # required: openssl rand -hex 48
vercel env add INITIAL_ADMIN_PASSWORD production
vercel env add CRON_SECRET production      # optional token for scheduled backups
vercel --prod
```

Alternatively import the GitHub repository in the Vercel dashboard and configure Environment Variables there. The Vercel Cron defined in `vercel.json` calls `POST /api/cron/backup` daily (backups are `.sql` dumps stored inside the database).

Notes:

- Platform limits: 4.5MB request body on the free plan — photos (8MB max) and large Excel uploads will fail; compress files first; 1-3s cold starts.
- Turso's free allowance (5GB storage, ~500M row reads/month) is far more than a small team needs; check official docs for current limits.

### Serverless environment variables (Workers / Vercel)

| Variable | Required | Description |
| --- | --- | --- |
| `SESSION_SECRET` | ✅ | Session secret; instances do not share memory, so it must be explicit |
| `LIBSQL_URL` | Vercel ✅ | Turso/libSQL URL (e.g. `libsql://xxx.turso.io`); not needed on Workers |
| `LIBSQL_AUTH_TOKEN` | Vercel ✅ | Turso database token; not needed on Workers |
| `INITIAL_ADMIN_PASSWORD` | Recommended | First-boot admin password (≥12 chars); otherwise printed to the platform logs |
| `CRON_SECRET` | Recommended | Scheduled-backup token; when set, `POST /api/cron/backup` requires `Authorization: Bearer <CRON_SECRET>` |
| `BASE_DATA_API_TOKEN` | Optional | Open API/MCP token; derived deterministically from `SESSION_SECRET` when unset |
| `SKIP_SOURCE_IMPORT` | Optional | Serverless mode skips the demo Excel import by default (empty databases can import via the UI) |

### Free VMs (Oracle Cloud / Google Cloud)

After installing Docker on a permanently free VM, the deployment steps are identical to Docker Compose. Additional notes:

- On Oracle Cloud, open port 3000 both in the console Security List and the instance firewall (iptables).
- The GCP e2-micro has 1 GB of RAM, which is enough for this app (Node + SQLite uses about 100 MB), but avoid co-locating other services.
- Before exposing the app publicly, set up a reverse proxy with HTTPS and a strong random `SESSION_SECRET`.

### Cloudflare Containers (from $5/month, zero adaptation)

The prebuilt image can run directly on Cloudflare Containers, but the feature **requires the Workers Paid plan** — there is no free tier. A minimal example lives in `deploy/cloudflare/`:

```bash
npm install -g wrangler
wrangler login
cd deploy/cloudflare
wrangler deploy
```

Notes:

- **Container disk is not persistent**: SQLite data and uploaded photos are lost on restart or migration. Use it for demos and trials only.
- The image must be publicly pullable (public GHCR package or public Docker Hub repository).
- Configuration fields follow the [Cloudflare Containers documentation](https://developers.cloudflare.com/containers/).

### Plain Node.js (local development and lightweight deployments)

```bash
git clone https://github.com/RealKiro/teachingroom-manager-public.git
cd teachingroom-manager-public
npm install
npm test          # optional: run the full test suite
npm start
curl http://localhost:3000/api/health
```

For long-running local deployments, add systemd (unit template `deploy/teachingroom.service`; full steps in [DEPLOYMENT.en.md](./DEPLOYMENT.en.md)).

### First startup

First administrator account:

```text
Username: admin
Password: INITIAL_ADMIN_PASSWORD when set; otherwise written to data/initial-admin-password.txt locally, or printed to the deployment logs on serverless platforms
```

Change the administrator password immediately after first login; the generated temporary-password file is then deleted. Create inspectors and normal administrators from User Management. The app has no fixed password and does not create an inspector automatically.

If the database is empty, the app imports classroom records from `初始化数据表格（虚拟）.xlsx` (synthetic demo data only — replace or remove before production use); serverless mode skips this import by default, and empty databases can be initialized by uploading an Excel file in the UI.

## MCP Integration (AstrBot and other bot frameworks)

The server ships with a standard MCP (Model Context Protocol) endpoint at `/mcp` using the Streamable HTTP transport. It follows the MCP specification, so any MCP-capable client can connect; AstrBot's remote MCP mode is the primary integration target.

- **Auth**: shares the read-only base-data API token from `data/base-data-api-token.txt`, passed via the `X-API-Token` or `Authorization: Bearer` header.
- **Scope**: read-only tools; data changes should keep going through the web review workflow.

| Tool | Description |
| --- | --- |
| `list_classrooms` | Query the classroom inventory filtered by building, department, update plan, or keyword, with limit/offset paging |
| `get_classroom` | Fetch a single classroom by ID or room code |
| `get_fields` | List public field definitions (types and options) for building filters |
| `get_summary` | Inventory statistics (totals, building/department distribution, update plan stats) |

### AstrBot configuration example

In the AstrBot WebUI (Tools → MCP), add an MCP server using the remote Streamable HTTP mode:

```json
{
  "url": "http://<SERVER_IP>:3000/mcp",
  "transport": "streamable_http",
  "timeout": 30,
  "headers": {
    "X-API-Token": "<TOKEN>"
  }
}
```

`<TOKEN>` is the contents of `data/base-data-api-token.txt` on the server. Once saved, AstrBot completes the MCP handshake and lists the tools, so the bot can query classroom equipment directly in chat.

### Other MCP clients

Any standard MCP client can connect over Streamable HTTP to `http://<SERVER_IP>:3000/mcp` with the same auth header. When exposed to the public internet, terminate HTTPS at a reverse proxy and restrict origins as needed.

## Base Data API

The app creates a token file for read-only API access at `data/base-data-api-token.txt`:

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

Tokens are accepted only through `X-API-Token` or `Authorization: Bearer`; query-string tokens are rejected. Only fields explicitly marked for the public API are returned, and CORS is disabled unless an allowlist is configured.

```text
GET /api/open/meta
GET /api/open/fields
GET /api/open/summary
GET /api/open/classrooms
GET /api/open/classrooms/:id
```

Common filters:

```text
building=X栋
department=小学
orientation=南
side=南侧
planned=yes
planned=screen
planned=board
planned=audio
search=X101
```

## Runtime Defaults

```text
PORT=3000
DATA_DIR=./data
DB_PATH=./data/teachingroom.sqlite
SESSION_SECRET=<optional; generated into data/session-secret.txt when omitted>
INITIAL_ADMIN_PASSWORD=<optional first-run password; at least 12 characters>
BASE_DATA_CORS_ORIGIN=<empty by default; comma-separated allowlist>
AUTO_BACKUP_KEEP=200
BACKUP_MIRROR_DIR=<optional second backup directory>
```

## Data And Backups

Runtime data is intentionally excluded from Git:

```text
data/*.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

Daily automatic backups are written to `backups/`; super administrators can also create, download, upload, and enable backups from the web UI. Automatic backups retain the newest 200 files by default (`AUTO_BACKUP_KEEP`); manual and pre-restore backups remain until removed outside the app. Set `BACKUP_MIRROR_DIR` to copy backups to a second mounted disk or network directory.

## CI/CD

- Pushes to main and `v*` tags trigger GitHub Actions to run tests (Node 20/22/24 matrix), smoke-test the Workers adaptation with `wrangler dev`, build multi-arch images, and publish to GHCR after a container smoke test (plus Docker Hub when its secrets are configured).
- Pull requests build and test without publishing.
- Dependabot checks npm dependencies, the base image, and Actions versions weekly.

## Development

See [DEVELOPMENT.en.md](./DEVELOPMENT.en.md) for architecture, workflow, and repository hygiene.

## Version And Upload Log

See [TIMESTAMP_LOG.en.md](./TIMESTAMP_LOG.en.md). It records GitHub upload events, repository location, commit IDs, and handoff notes.
