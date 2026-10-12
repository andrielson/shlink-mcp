# shlink-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[Shlink](https://shlink.io), the self-hosted URL shortener: it exposes
Shlink's REST API as twelve fine-grained tools for MCP clients, speaking
Streamable HTTP. The server is a stateless translator: it keeps no accounts
and no Shlink configuration of its own — every request names the target
instance through two headers (`X-Api-Key`, `X-Shlink-Server-Url`), and Shlink
itself is the authenticator. See [ADR 0001](docs/adr/0001-stateless-per-request-credentials.md)
for why, and [`CONTEXT.md`](CONTEXT.md) for the project's vocabulary.

Derived from
[bun-devops-template](https://github.com/andrielson/bun-devops-template), a
GitHub template for Bun-based DevOps projects.

## Resources

- [Shlink](https://shlink.io) — the URL shortener this server targets.
- [Shlink documentation](https://shlink.io/documentation) — the REST API
  reference.
- [Shlink JS SDK](https://js-sdk.shlink.io)
  ([source](https://github.com/shlinkio/shlink-js-sdk)) — the official
  TypeScript SDK this server's client layer builds on.
- [Shlink source](https://github.com/shlinkio/shlink) — the server-side
  implementation of the REST API.
- [Model Context Protocol](https://modelcontextprotocol.io) — the protocol
  this server speaks.

## Prerequisites

- **Bun** (1.4+) — runs the scripts, the test suite and the git hooks.
- **ShellCheck** (0.10+) — shell linting (`lint:sh` and the pre-commit
  gate). Shell _formatting_ needs no host binary: it goes through Prettier
  and `prettier-plugin-sh`.
- **Docker** (with Compose) — runs the ephemeral test Shlink (see
  [Ephemeral test Shlink](#ephemeral-test-shlink)) and builds the deployable
  server image (see [Deploying with Docker](docs/deploy.md)).

## Getting started

Clone the repository, then:

```bash
bun install
```

`bun install` also activates the git hooks: the `prepare` lifecycle script
points `core.hooksPath` at `.husky/_`, so a fresh clone needs zero manual
setup.

## Running the server

Locally, straight from source (Bun runs TypeScript natively):

```bash
bun src/index.ts
```

The server listens on `http://localhost:3000/mcp` (override with `PORT`) and
offers `GET /health` for liveness. For the personal deploy, see
[Deploying with Docker](docs/deploy.md).

## Connecting an MCP client

The server is unconfigured and stateless, speaking MCP over Streamable HTTP:
every request names its target Shlink instance through two headers, and
Shlink itself is the authenticator.

| Header                | Value                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `X-Api-Key`           | an API key of the target Shlink instance (the same key its REST API takes)                                  |
| `X-Shlink-Server-Url` | the instance's plain base URL, e.g. `https://s.example.com` — **no** `/rest/v3` suffix (the SDK appends it) |

With Claude Code:

```bash
claude mcp add --transport http shlink http://localhost:3000/mcp \
  --header "X-Api-Key: <shlink-api-key>" \
  --header "X-Shlink-Server-Url: https://s.example.com"
```

Or the equivalent block in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "shlink": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "X-Api-Key": "<shlink-api-key>",
        "X-Shlink-Server-Url": "https://s.example.com"
      }
    }
  }
}
```

Two behaviors worth knowing before the first connect:

- **One session, one instance.** The headers pin the session to a single
  Shlink instance; to manage another instance, register the server again
  with different headers. One deploy can serve any number of instances —
  just never inside the same session.
- **Fail fast at connect.** On `initialize` the server validates the
  credentials with one lightweight authenticated call (list short URLs,
  page 1, one item): a rejected key or an unreachable instance URL fails
  the connection itself, not the first tool call later.

For local development, the [ephemeral test Shlink](#ephemeral-test-shlink)
plays the target instance.

## Commands

| Command                | What it does                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun install`          | Install dependencies (and activate the git hooks)                                                                                                                        |
| `bun run lint`         | Biome check (TS family)                                                                                                                                                  |
| `bun run lint:fix`     | Biome check with auto-fix                                                                                                                                                |
| `bun run lint:sh`      | ShellCheck over the tracked shell scripts                                                                                                                                |
| `bun run format`       | Prettier write (markdown/YAML/shell/Dockerfile)                                                                                                                          |
| `bun run format:check` | Prettier check, no changes applied                                                                                                                                       |
| `bun run typecheck`    | `tsc --noEmit`                                                                                                                                                           |
| `bun test`             | Run the test suite ([Bun's test runner](https://bun.com/docs/test-writer) is built in; the integration tier starts and stops the ephemeral Shlink, so Docker must be up) |
| `bun src/index.ts`     | Run the MCP server (see [Running the server](#running-the-server))                                                                                                       |
| `bun build <entry>`    | Bundle an entrypoint (`.ts`, `.html`, `.css`)                                                                                                                            |

## Ephemeral test Shlink

Integration tests and local development run against a disposable Shlink
instance defined in [`tests/compose.yaml`](tests/compose.yaml): a pinned
latest-stable Shlink on its default SQLite database, with no mounted volumes —
every start is a fresh instance (the initial API key is applied on first boot,
~6s to healthy), and every stop discards all data. `bun test` starts and stops
it by itself; to drive one manually (for local development against a
longer-lived instance):

```bash
docker compose --file tests/compose.yaml up --detach --wait # start, wait healthy
docker compose --file tests/compose.yaml down               # stop, discard all data
```

The suite uses a **per-worktree compose identity**: the project name and
published port are generated once by [`tests/compose-project.ts`](tests/compose-project.ts)
and recorded in a gitignored `tests/.env`, which compose auto-loads — so
parallel worktrees each own their instance, and manual invocations above aim
at the same project and port as the suite (recorded in `SHLINK_TEST_PORT`,
falling back to 18080 before the first suite run).

| Variable               | Meaning                                                                                                               | Default               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `SHLINK_TEST_HOST`     | Host the published port is reachable on                                                                               | `127.0.0.1`           |
| `SHLINK_TEST_PORT`     | Published port (the per-worktree identity's record)                                                                   | `18080`               |
| `SHLINK_TEST_API_KEY`  | API key the suite sends                                                                                               | `shlink-mcp-test-key` |
| `SHLINK_TEST_BASE_URL` | Total override: an already-running external instance; the suite then starts and stops no compose lifecycle of its own | —                     |

`SHLINK_TEST_HOST` exists for remote Docker daemons, whose published ports
are not reachable on `127.0.0.1` — this workspace sets it to the docker-host
gateway (`172.18.0.1`) in a gitignored root `.env`, which Bun auto-loads.

| Setting              | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Default short domain | `s.test`                                                        |
| Health endpoint      | `GET /rest/health` (no auth) — the compose healthcheck polls it |

The REST API lives under `/rest/v3` and authenticates every call with the
`X-Api-Key` header; the [API documentation](https://shlink.io/documentation/api-docs/)
is the canonical reference.

## Lint, formatting and type checking

Formatting is split between two tools with strict ownership — they never
touch the same file:

- **Biome** owns the TS family (`ts`, `tsx`, `js`, `jsx`, `json`, `jsonc`):
  lint, formatting and import organization, configured in `biome.json`.
- **Prettier** owns markdown, YAML, shell and Dockerfile, configured in
  `.prettierrc` with `prettier-plugin-sh` (which embeds shfmt's engine for
  shell). `.prettierignore` excludes the Biome-owned extensions so a
  repo-wide Prettier run never crosses the boundary.

`.shellcheckrc` holds the ShellCheck policy (bash dialect, optional rules
enabled, known-noise codes disabled). `lint:sh` targets every tracked
shell script (`git ls-files`), so it respects `.gitignore` and stays a
no-op until shell scripts are added.

## Git hooks (Husky)

Hooks run through [Husky](https://typicode.github.io/husky/) and activate
themselves (see [Getting started](#getting-started)). Hook logic is
TypeScript executed by Bun; each extensionless hook under `.husky/` is a
minimal shell shim delegating to its sibling `.ts` implementation — the
same files `lint` and `typecheck` cover.

- `pre-commit` — lint-staged runs the fixers on staged files and re-stages
  what changed (Biome on the TS family, Prettier on its own types,
  configured in `.lintstagedrc.json`); then the blocking gates: ShellCheck
  on staged shell files, and the full type check.
- `post-checkout` / `post-merge` — rerun `bun install` so `node_modules`
  never goes stale after a checkout, merge or pull.

Escape hatches for emergencies: `git commit --no-verify` skips the hook
once, and `HUSKY=0` disables Husky entirely (e.g. `HUSKY=0 bun install`
skips hook activation).

VS Code is preconfigured (`.vscode/`, `.editorconfig`) to format on save
with the same tools as the hooks: Biome for the TS family, the Prettier
extension for markdown, YAML, shell and Dockerfile.

## Continuous integration

[`.github/workflows/ci.yaml`](.github/workflows/ci.yaml) runs on every push to
`main` and every pull request: the gates (Biome, Prettier check, type check,
ShellCheck) and the full `bun test` — integration tier included. The suite
starts and stops its own ephemeral Shlink on the runner's preinstalled Docker,
so the workflow needs no services and no secrets; the Bun version comes from
`package.json`'s `packageManager` field.

## Agent tooling

The repository ships coding-agent tooling alongside the code:

- **DeepWiki MCP** — `.mcp.json` declares the `deepwiki` MCP server
  (`https://mcp.deepwiki.com/mcp`), a free, no-authentication service that
  answers questions about public GitHub repositories from AI-generated
  documentation. The `deepwiki` skill in `.claude/skills/` describes when
  and how to use it.
- **Agent workflows** — `docs/agents/` holds the workflows for coding
  agents (issue tracker via `gh`, triage labels, domain docs); start at
  `CLAUDE.md`.
- **mattpocock-skills plugin** — `.claude/settings.json` enables the
  `mattpocock-skills` Claude Code plugin, which provides the engineering
  skills those workflow docs refer to.
- **mcp-server-dev plugin** — `.claude/settings.json` also enables the
  `mcp-server-dev` Claude Code plugin, the reference tooling for building
  the MCP server itself (deployment model, tool-design patterns,
  packaging) when implementation starts.

## Conventions

- All repository content is written in English.
- Commands use long options wherever the tool provides them.
- Compose files use the long syntax for volumes and ports.
- Formatting is split with strict ownership (see
  [Lint, formatting and type checking](#lint-formatting-and-type-checking)).

The full list, including Bun-over-Node preferences and shell quoting rules,
lives in `CLAUDE.md`.
