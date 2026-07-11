# Local Observability (OpenObserve)

This project supports a local-first observability workflow for reliability and chaos testing.

## Prerequisites

- Docker + Docker Compose plugin (`docker compose`)

## Quick Start

1. Create local environment file:

```bash
cp devtools/observability/.env.example devtools/observability/.env
```

2. Edit credentials in `devtools/observability/.env`.

3. Start OpenObserve:

```bash
docker compose --env-file devtools/observability/.env -f devtools/observability/docker-compose.openobserve.yml up -d
```

4. Open the UI:

- URL: `http://localhost:5080`
- Login with the credentials from `.env`

## Stop / Restart

Stop services:

```bash
docker compose --env-file devtools/observability/.env -f devtools/observability/docker-compose.openobserve.yml down
```

Restart services:

```bash
docker compose --env-file devtools/observability/.env -f devtools/observability/docker-compose.openobserve.yml up -d
```

## Reset Local Data

This removes all locally stored observability data:

```bash
docker compose --env-file devtools/observability/.env -f devtools/observability/docker-compose.openobserve.yml down -v
```

## Retention / Disk Guidance

- Use this local stack for short-lived investigation runs.
- Run `down -v` periodically if disk usage grows.
- Keep credentials local and do not commit `.env`.
