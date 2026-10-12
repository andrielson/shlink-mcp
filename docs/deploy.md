# Deploying shlink-mcp with Docker

The personal-deploy runbook: one container, one port, no configuration
state. The server is a stateless translator — it keeps no accounts and no
Shlink settings of its own; every MCP request names its target instance in
two headers (see [ADR 0001](adr/0001-stateless-per-request-credentials.md)
and [Connecting an MCP client](../README.md#connecting-an-mcp-client)). The
only thing it needs from the environment is a port to listen on.

## Build the image

From the repository root:

```bash
docker build --file Dockerfile --tag shlink-mcp:0.1.0 .
```

Tag with the version in [`package.json`](../package.json) (bump them
together). The build is multi-stage: a bundler stage installs the frozen
dependency lockfile and bundles `src/index.ts` into one self-contained file
(`bun build --target=bun`), and the runtime stage ships only that bundle on
`oven/bun:1.4.3-slim` — no `node_modules` in the final image (~256 MB, almost
all of it the Bun runtime). Both base tags are pinned to the Bun version in
`package.json` (`packageManager`); bump them deliberately, together.

The image declares a `HEALTHCHECK` polling the unauthenticated
`GET /health` route, so orchestrators (and `docker ps`) see liveness without
any probe config of their own.

## Run it

```bash
docker run --detach --name shlink-mcp --publish 3000:3000 --restart unless-stopped shlink-mcp:0.1.0
```

Or, as the long-lived compose service this actually is (long syntax per repo
convention):

```yaml
services:
  shlink-mcp:
    image: shlink-mcp:0.1.0
    ports:
      - target: 3000
        published: "3000"
    restart: unless-stopped
```

The container listens on port 3000 by default (`PORT` env var, same as
running from source). The publish mapping is your choice; the MCP endpoint
is `http://<host>:<port>/mcp`.

One routing gotcha: the container must be able to reach every
`X-Shlink-Server-Url` the clients will send. A URL that means "this same
machine" (e.g. `http://localhost:8080`) does **not** work from inside a
container — use an address routed from container land. When Shlink runs on
the same Docker host, publish its port and point at the host gateway:

```bash
docker run --detach --name shlink-mcp --publish 3000:3000 --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  shlink-mcp:0.1.0
# X-Shlink-Server-Url: http://host.docker.internal:8080
```

## Point a client at it

See [Connecting an MCP client](../README.md#connecting-an-mcp-client) — the
`claude mcp add` command and the `.mcp.json` block, with the two credential
headers set to the real instance's values. The connection fails fast at
`initialize` if the key or the instance URL don't validate.

## Operating notes

- **Logs** — `docker logs shlink-mcp` (or `docker compose logs --follow`):
  startup line and stderr only; the server is stateless and chatty-free.
- **Liveness** — `curl http://<host>:<port>/health` answers
  `{"ok":true}`; the built-in healthcheck reports through
  `docker inspect --format '{{json .State.Health}}' shlink-mcp`.
- **Upgrading** — `git pull`, rebuild with the new tag, then recreate:
  `docker stop shlink-mcp && docker rm shlink-mcp` and `docker run …` again
  (or `docker compose up --detach` after editing the tag). There is no state
  to migrate — the server holds nothing.
- **Do not expose publicly.** Any client of this server can point it at any
  `X-Shlink-Server-Url` it chooses, so an internet-exposed deploy would be an
  open proxy (see the SSRF note in [ADR 0001](adr/0001-stateless-per-request-credentials.md)).
  Personal network or VPN only; a public deploy needs an auth layer this MVP
  deliberately omits.
