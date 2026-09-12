# TeachingRoom Manager

[中文](./README.md)

TeachingRoom Manager is a lightweight browser-based classroom equipment data system.

The repository includes `初始化数据表格（虚拟）.xlsx` for first-run demonstrations. It contains synthetic data only; the application supports classroom inventory, inspection updates, review workflows, Excel import/export, audit logs, rollback, backups, and read-only base-data integration.

The app is designed for small internal teams. The expected user count is about ten people, so the runtime stays simple: Node.js, Express, SQLite, and plain frontend assets.

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

## Quick Start

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000/`. First administrator account:

```text
Username: admin
Password: INITIAL_ADMIN_PASSWORD when set; otherwise data/initial-admin-password.txt
```

The app has no fixed password and does not create an inspector automatically. Change the administrator password immediately after first login; the generated temporary-password file is then deleted. Create inspectors and normal administrators from User Management.

## Which deployment option should you choose?

All application data (SQLite database, photos, backups) must be **persistently stored on disk**, which defines the limits of free options:

| Platform | Free tier | Free lunch? | Notes |
| --- | --- | --- | --- |
| Own hardware (Synology NAS etc.) | Already owned | ✅ **Recommended** | Local data, zero cost, see below |
| Oracle Cloud Always Free | Permanently free ARM VM (4 OCPU / 24 GB) | ✅ | Best free option for public access |
| Google Cloud Always Free | Permanently free e2-micro VM | ✅ | Card verification required; 1 GB RAM is enough here |
| Render free instances | Yes | ⚠️ Demo only | Sleeps after 15 idle minutes; ephemeral disk loses data |
| Koyeb / Hugging Face Spaces | Yes | ⚠️ Demo only | Ephemeral disk as well |
| Railway / Fly.io | One-time $5 trial credit | ❌ | Charges apply once credit is used up |
| Cloudflare Workers free plan | Yes | ❌ | Cannot run the native SQLite module and local file storage |
| Cloudflare Containers | ❌ | ❌ | Requires the Workers Paid plan ($5/month minimum) |

Bottom line: **pure free serverless cannot keep data persistent**. For a true free lunch, run Docker Compose on a free VM (Oracle Cloud / GCP) or use an existing NAS; Cloudflare's free tier would require rewriting the app to a D1 + R2 architecture (a large migration, not recommended). Platform policies change; always verify against official docs before deploying.

### Option 1: Docker Compose (recommended)

GitHub Actions automatically tests, builds `linux/amd64` + `linux/arm64` images and publishes them to GHCR on every push to main and every `v*` tag:

```text
ghcr.io/realkiro/teachingroom-manager-public:latest
```

Before the first pull, make the GHCR package public (repository Packages → teachingroom-manager-public → Package settings → Change visibility → Public), or run `docker login ghcr.io` first.

```bash
git clone https://github.com/RealKiro/teachingroom-manager-public.git
cd teachingroom-manager-public/docker
echo "SESSION_SECRET=$(openssl rand -hex 48)" > .env
docker compose pull
docker compose up -d
curl http://127.0.0.1:3000/api/health
```

If `SESSION_SECRET` is not set, the system generates and persists one into `data/session-secret.txt`; a fully local build also works (`docker compose up -d --build`). The image is a multi-stage build on `node:24-alpine`, runs as non-root, and ships with a healthcheck.

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

### Free VMs (Oracle Cloud / Google Cloud)

After installing Docker on a permanently free VM, the deployment steps are identical to Option 1. Additional notes:

- On Oracle Cloud, open port 3000 both in the console Security List and the instance firewall (iptables).
- The GCP e2-micro has 1 GB of RAM, which is enough for this app (Node + SQLite uses about 100 MB), but avoid co-locating other services.
- Before exposing the app publicly, set up a reverse proxy with HTTPS and a strong random `SESSION_SECRET`.

### Cloudflare Containers (experimental, from $5/month)

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

### Plain Node.js

See [DEPLOYMENT.en.md](./DEPLOYMENT.en.md), including the systemd unit template `deploy/teachingroom.service`.

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

The first run creates `data/teachingroom.sqlite`. If the database is empty, the app imports classroom records from `初始化数据表格（虚拟）.xlsx` (synthetic demo data only — replace or remove before production use).

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

- Pushes to main and `v*` tags trigger GitHub Actions to run tests (Node 20/22/24 matrix), build multi-arch images, smoke-test a container, and publish to GHCR (plus Docker Hub when its secrets are configured).
- Pull requests build and test without publishing.
- Dependabot checks npm dependencies, the base image, and Actions versions weekly.

## Development

See [DEVELOPMENT.en.md](./DEVELOPMENT.en.md) for architecture, workflow, and repository hygiene.

## Version And Upload Log

See [TIMESTAMP_LOG.en.md](./TIMESTAMP_LOG.en.md). It records GitHub upload events, repository location, commit IDs, and handoff notes.
