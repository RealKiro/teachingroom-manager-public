# TeachingRoom Manager

[中文](./README.md)

TeachingRoom Manager is a lightweight browser-based classroom equipment data system.

The repository includes `初始化数据表格（虚拟）.xlsx` for first-run demonstrations. It contains synthetic data only; the application supports classroom inventory, inspection updates, review workflows, Excel import/export, audit logs, rollback, backups, and read-only base-data integration.

The app is designed for small internal teams. The expected user count is about ten people, so the runtime stays simple: Node.js, Express, SQLite, and plain frontend assets.

## Documentation

- [Concise deployment guide](./DEPLOYMENT.en.md)
- [Complete deployment and operations manual](./docs/DEPLOYMENT.en.md)
- [Development notes](./DEVELOPMENT.en.md)
- [Changelog](./docs/CHANGELOG.en.md)
- [Project work log](./docs/WORK_LOG_2026-05-18.en.md)
- [Version and upload log](./TIMESTAMP_LOG.en.md)
- [All documentation](./docs/README.en.md)

## Features

- Import demonstration records from the synthetic Excel template on first startup.
- Responsive desktop table view and mobile/tablet card view.
- Quick filtering by building, department, update plan, pending review state, and keyword.
- Role model for super administrator, administrator, and inspector.
- Inspectors and administrators submit data changes as review requests.
- Classroom creation, field changes, photo uploads, and photo deletions require cross-review for all users except the super administrator.
- Administrators review old/new field differences before official data is updated.
- Each classroom has a dedicated configuration history showing old/new values, submitter, reviewer, source, notes, photos, and rollback events in Beijing time.
- Super administrator-only user management and operation log.
- Single approved-change rollback and cross-type point-in-time rollback for fields, classrooms, and photos.
- Excel export based on current filters.
- Excel upload generates pending review requests instead of overwriting data directly.
- SQLite-backed login sessions.
- Persistent browser outbox with idempotent automatic retry for weak-network submissions.
- Automatic, manual, downloadable, uploadable, and restorable database backups.
- Read-only base-data API for other departments or internal systems.
- Built-in standard MCP server (`/mcp`, Streamable HTTP) for bot frameworks such as AstrBot.

## Quick Start

```bash
npm install
npm test
npm start
```

Open:

```text
http://localhost:3000/
```

First administrator account:

```text
Super administrator username: admin
Password: INITIAL_ADMIN_PASSWORD when set; otherwise data/initial-admin-password.txt
```

The app has no fixed password and does not create an inspector automatically. Change the administrator password immediately after first login; the generated temporary-password file is then deleted. Create inspectors and normal administrators from User Management.

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

The first run creates `data/teachingroom.sqlite`. If the database is empty, the app imports classroom records from:

```text
初始化数据表格（虚拟）.xlsx
```

All buildings, room signs, classes, departments, devices, and notes in this file are fictional. Replace or remove these records before production use.

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

The application creates daily automatic backups under:

```text
backups/
```

Super administrators can also create, download, upload, and enable backups from the web UI.

Backups are not pruned by age. Automatic backups retain the newest 200 files by default; manual and pre-restore backups remain until an administrator removes them outside the app. Set `BACKUP_MIRROR_DIR` to copy backups to a second mounted disk or network directory.

## Base Data API

The app creates a token file for read-only API access:

```text
data/base-data-api-token.txt
```

Example:

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

Tokens are accepted only through `X-API-Token` or `Authorization: Bearer`; query-string tokens are rejected. Only fields explicitly marked for the public API are returned, and CORS is disabled unless an allowlist is configured.

Endpoints:

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

## Deployment

Three deployment options are supported: Docker Compose (recommended), Cloudflare Containers (experimental), and plain Node.js. Docker-related files live in the `docker/` directory; see [docker/README.md](./docker/README.md).

### Option 1: Docker Compose (recommended, ideal for servers and Synology NAS)

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

If `SESSION_SECRET` is not set, the system generates and persists one into `data/session-secret.txt`. A fully local build also works: `docker compose up -d --build`.

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

### Option 2: Cloudflare Containers (experimental)

The prebuilt image can run directly on Cloudflare Containers (requires a paid Workers plan; Containers is currently in Beta). A minimal example lives in `deploy/cloudflare/`:

```bash
npm install -g wrangler
wrangler login
cd deploy/cloudflare
wrangler deploy
```

Notes:

- **Container disk is not persistent**: SQLite data and uploaded photos are lost on restart or migration. Use it for demos and trials only; run production data on a NAS/server with the daily backup mechanism.
- The image must be publicly pullable (public GHCR package or public Docker Hub repository).
- Configuration fields follow the [Cloudflare Containers documentation](https://developers.cloudflare.com/containers/).

### Option 3: plain Node.js

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

## Development

See [DEVELOPMENT.en.md](./DEVELOPMENT.en.md) for architecture, workflow, and repository hygiene.

## Version And Upload Log

See [TIMESTAMP_LOG.en.md](./TIMESTAMP_LOG.en.md). It records GitHub upload events, repository location, commit IDs, and handoff notes.
