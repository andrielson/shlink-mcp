# shlink-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[Shlink](https://shlink.io), the self-hosted URL shortener: it exposes
Shlink's REST API as tools for MCP clients. The server itself is not
implemented yet — the repository currently holds the prewired quality
tooling, git hooks and agent tooling, ready for the first source files.

Derived from
[bun-devops-template](https://github.com/andrielson/bun-devops-template), a
GitHub template for Bun-based DevOps projects.

## Prerequisites

- **Bun** (1.4+) — runs the scripts, the test suite and the git hooks.
- **ShellCheck** (0.10+) — shell linting (`lint:sh` and the pre-commit
  gate). Shell _formatting_ needs no host binary: it goes through Prettier
  and `prettier-plugin-sh`.
- **Docker** — optional; only if this project ends up validating Compose
  files or building images.

## Getting started

Clone the repository, then:

```bash
bun install
```

`bun install` also activates the git hooks: the `prepare` lifecycle script
points `core.hooksPath` at `.husky/_`, so a fresh clone needs zero manual
setup.

## Commands

| Command                | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `bun install`          | Install dependencies (and activate the git hooks)                                      |
| `bun run lint`         | Biome check (TS family)                                                                |
| `bun run lint:fix`     | Biome check with auto-fix                                                              |
| `bun run lint:sh`      | ShellCheck over the tracked shell scripts                                              |
| `bun run format`       | Prettier write (markdown/YAML/shell/Dockerfile)                                        |
| `bun run format:check` | Prettier check, no changes applied                                                     |
| `bun run typecheck`    | `tsc --noEmit`                                                                         |
| `bun test`             | Run the test suite ([Bun's test runner](https://bun.com/docs/test-writer) is built in) |
| `bun build <entry>`    | Bundle an entrypoint (`.ts`, `.html`, `.css`)                                          |

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

## Conventions

- All repository content is written in English.
- Commands use long options wherever the tool provides them.
- Compose files use the long syntax for volumes and ports.
- Formatting is split with strict ownership (see
  [Lint, formatting and type checking](#lint-formatting-and-type-checking)).

The full list, including Bun-over-Node preferences and shell quoting rules,
lives in `CLAUDE.md`.
