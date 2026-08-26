# Manus MemoryX

[![CI](https://github.com/TentacioPro/manus-MemoryX/actions/workflows/ci.yml/badge.svg)](https://github.com/TentacioPro/manus-MemoryX/actions/workflows/ci.yml)

Manus MemoryX is a **local-first personal knowledge archive** for WhatsApp exports now, with support for official Instagram exports, YouTube/Google Takeout, manual URL capture, and CSV input. It uses React, Node.js, MongoDB, MinIO, Redis, and a BullMQ worker through Docker Compose. The system does not scrape platforms, automate logins, use private endpoints, or depend on paid APIs.

> Imported messages and media remain on the machine that runs the Compose stack. MongoDB stores metadata and provenance; MinIO stores attachment bytes; Redis coordinates local background processing.

## Run without Windows

The same `docker-compose.yml` is intended to run with **standard Docker Compose v2** on Linux, macOS, and Windows Subsystem for Linux (WSL). It uses container networking and Docker named volumes rather than host-specific service paths. Docker Desktop remains suitable on macOS and WSL, while Linux can use Docker Engine plus the Compose plugin.

| Host             | Recommended setup                                                                                       | Important note                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Linux            | Docker Engine and the Docker Compose v2 plugin                                                          | Run from a normal writable project directory.                                                                                         |
| macOS            | Docker Desktop                                                                                          | Allow Docker Desktop access to the project directory if it prompts.                                                                   |
| Windows with WSL | Docker Desktop with WSL integration, then run from a Linux home directory such as `~/src/manus-MemoryX` | Avoid `/mnt/c/...` for the live bind-mounted intake folder when possible; it is typically slower and can have permission differences. |

### Standard Docker Compose startup

Clone the repository, create a private local environment file, replace the placeholder passwords, and start the stack:

```bash
git clone https://github.com/TentacioPro/manus-MemoryX.git
cd manus-MemoryX

cp ops/local-config.template .env
mkdir -p local-imports/incoming backups
# Edit .env and replace both placeholder password values before continuing.

docker compose config
docker compose up --build -d
docker compose ps
curl --fail http://localhost:8787/health
```

The browser app is served at `http://localhost:5173`, the local API health endpoint is `http://localhost:8787/health`, the MinIO console is `http://localhost:9001`, and MinIO’s object endpoint is `http://localhost:9000` unless you change the corresponding `.env` ports.

On WSL, use the same commands **inside the Linux distribution** after enabling Docker Desktop’s WSL integration. If Docker reports that it cannot connect to the daemon, start Docker Desktop and confirm the distribution is enabled under **Settings → Resources → WSL Integration**.

### Daily operations

Use standard Compose commands from the repository root:

```bash
# Follow the local services.
docker compose logs -f api worker

# Stop services while retaining MongoDB, Redis, and MinIO named volumes.
docker compose down

# Stop services and delete all local archive data. This is destructive.
docker compose down --volumes

# Update source after a Git pull and rebuild local images.
docker compose up --build -d
```

Place local export files in `local-imports/incoming/` and use the app or the documented queue helpers to create an import record. The relative `IMPORT_DIR=./local-imports` default in `.env` works on Linux, macOS, and WSL when commands are run from the repository root. Do not commit `.env`, local imports, backups, or exported personal data.

### Verification and test boundaries

The repository’s CI workflow runs root UI/script tests, API tests, worker parser and lifecycle tests, and TypeScript checks on every push and pull request. It is a **code-level quality gate**, not a replacement for the local Docker runtime. The following checks still need a machine with Docker Compose available:

```bash
# Non-destructive baseline verification on a Compose-capable host.
# On Linux/macOS/WSL, run the equivalent documented Compose health/export/backup checks.
docker compose ps
curl --fail http://localhost:8787/health
```

The PowerShell helper remains available for native Windows workflows, but it is not required to use the standard Docker Compose commands above.

## Automated quality gate

The workflow at [`.github/workflows/ci.yml`](.github/workflows/ci.yml) validates the root application, API, and worker packages on each push and pull request. Run the same checks locally before changing behavior:

```bash
pnpm test
pnpm check

(cd apps/api && npm test -- --reporter=verbose)
(cd apps/worker && npm test -- --reporter=verbose)
```

## Further documentation

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the local-only data model and privacy boundaries, [`docs/IMPORT_FORMATS.md`](docs/IMPORT_FORMATS.md) for supported export formats, and [`docs/WINDOWS_SETUP.md`](docs/WINDOWS_SETUP.md) for native Windows PowerShell operations, backup, restore, and scheduled tasks.
