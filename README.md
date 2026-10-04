# Inventory tracker

A personal electronics and hardware inventory for one app instance on the LAN. It uses Bun, SvelteKit,
TypeScript, and SQLite (`bun:sqlite`). The design is in `IMPLEMENTATION.md`.

Catalog and stock workflows do not need an API key.

## Configuration

Set these in the environment or in a `.env` file. The `dev`, `build`, `preview`, and `start` scripts read `.env`.

| Variable        | When it is read | Purpose                                                                                                                                                                        |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_PATH` | Run time        | SQLite database file. Default: `./data/inventory.sqlite`. Use a local disk outside `build/`. The directory is created if necessary.                                            |
| `ORIGIN`        | Build time      | The URL that browsers use to open the app, for example `http://localhost:3000`. Set it when you serve the app over plain HTTP; otherwise form submissions fail the CSRF check. |
| `HOST`, `PORT`  | Run time        | Listen address and port of the built server. Defaults: `0.0.0.0` and `3000`.                                                                                                   |

Database files (`/data`, `*.sqlite*`) are excluded from source control.

## Develop

```sh
bun install
bun run dev
```

## Build and run under Bun

```sh
ORIGIN=http://localhost:3000 bun run build
DATABASE_PATH=./data/inventory.sqlite PORT=3000 bun run start
```

`bun run start` runs `bun ./build/index.js`. The app applies pending migrations from
`src/lib/server/db/migrations/` when it opens the database, so a restart after an update is enough.

## Checks

```sh
bun run check                             # types
bun run lint
bun --bun vitest --run --project server   # SQLite-backed unit tests
bun run build
```
