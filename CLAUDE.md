# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

`andrielson/shlink-mcp`, derived from the [bun-devops-template](https://github.com/andrielson/bun-devops-template) (created with `bun init`; `packageManager` pins Bun 1.4+). The name states the intended project — an MCP server for [Shlink](https://shlink.io), the self-hosted URL shortener — but nothing of it exists yet: there is no entry point (`index.ts` was intentionally removed). What is prewired is the quality tooling: Biome and Prettier with strict ownership, ShellCheck, `tsc`, Husky hooks (activated by `bun install`), and the agent tooling below. The `.husky/*.ts` hooks count as TypeScript inputs, so `bun run typecheck` passes even before any source file exists. When work on the server starts, research Shlink's REST API through DeepWiki against `shlinkio/shlink` (see "Agent tooling").

## Commands

- `bun install` — install dependencies (also activates the git hooks, via the `prepare` script)
- `bun run <file>` — run a script directly
- `bun test` — run all tests (Bun's built-in runner; until test files exist it exits 1 with `error: 0 test files matching ...` — expected, not something to fix); `bun test path/to/file.test.ts` for one file, `bun test -t "<name>"` for one test
- `bun run lint` / `bun run lint:fix` — Biome check (TS family), with and without auto-fix
- `bun run lint:sh` — ShellCheck over the tracked shell scripts (a no-op until `.sh`/`.bash` files are added)
- `bun run format` / `bun run format:check` — Prettier write/check (markdown, YAML, shell, Dockerfile)
- `bun run typecheck` — `tsc --noEmit`
- `bun build <entry.ts|entry.html|entry.css>` — bundle

## TypeScript strictness (tsconfig.json)

- `strict` and `noUncheckedIndexedAccess` are on — indexing an array/map yields `T | undefined`.
- `verbatimModuleSyntax` is on — type-only imports must use `import type { ... }`.
- `allowImportingTsExtensions` is on — relative imports may include the `.ts` extension.

## Bun over Node.js

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads `.env`, so don't use dotenv.

### APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes — don't use `express`.
- `bun:sqlite` for SQLite — don't use `better-sqlite3`.
- `Bun.redis` for Redis — don't use `ioredis`.
- `Bun.sql` for Postgres — don't use `pg` or `postgres.js`.
- `WebSocket` is built-in — don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile.
- `Bun.$` (Bun Shell) instead of execa — also the rule inside the git hooks, in preference to `Bun.spawn`.

For Bun API details, read the docs shipped in `node_modules/bun-types/docs/**.mdx`.

## Agent tooling

- **Issue tracker** — GitHub Issues, via the `gh` CLI (patterns for `gh` live in the `gh` skill, `.claude/skills/gh/`). See `docs/agents/issue-tracker.md`.
- **Triage labels** — vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs** — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily when terms or decisions actually get resolved. See `docs/agents/domain.md`.
- **mattpocock-skills plugin** — enabled in `.claude/settings.json`; it provides the engineering skills the workflow docs refer to.
- **Third-party research** — whenever information about a third-party project is needed (APIs, CLI, runtime behavior, releases, internals), research it through the `deepwiki` MCP against that project's GitHub repository (e.g. Bun via `oven-sh/bun`, Shlink via `shlinkio/shlink`). The `deepwiki` skill in `.claude/skills/deepwiki/` describes the workflow; the MCP server is declared in `.mcp.json` and pre-approved in `.claude/settings.json` (`enabledMcpjsonServers` plus the `mcp__deepwiki__*` allow rule), so it connects without a first-use prompt.

## Conventions

### Language

Write everything the agent produces in English, regardless of the language the user speaks in the conversation (e.g. Portuguese). This covers code, code comments, documentation and any other files added to the repo, commit messages, GitHub content created via `gh` (issues, issue comments, pull request descriptions, review comments), written plans and design/spec documents produced before or during implementation, and any other generated artifact or written output. Only direct conversational replies in chat may mirror the user's language.

### Command style

- Always use the long format for command arguments (e.g. `docker compose --file ... --project-name ...`, not `-f`/`-p`) — it is easier to read for someone unfamiliar with the options. This covers shell commands in general, including `RUN` statements in Dockerfiles and the shell scripts of projects derived from this template. Where a tool has no long options (e.g. BusyBox utilities in Alpine-based images), short flags are fine — leave a comment saying so.
- In Docker Compose files, prefer the long syntax too: volumes as `type:`/`source:`/`target:` entries and ports as `target:`/`published:`, not the `- source:target` or `- host:container` shorthand.
- In shell scripts, prefer single quotes for literal strings without expansions; switch to double quotes as soon as the string contains a variable or command substitution (ShellCheck's SC2016 flags the mistake). prettier-plugin-sh preserves quote style, so this is an authoring convention enforced by review, not by tooling.

### Lint, formatting and type checking

Two formatters with strict ownership plus `tsc`; the two formatters must never own the same file.

- **Biome** owns the TS family (`ts`, `tsx`, `js`, `jsx`, `json`, `jsonc`) via `bun run lint` / `bun run lint:fix` (see `biome.json`).
- **Prettier** owns markdown, YAML, shell and Dockerfile via `bun run format` / `bun run format:check`, using `prettier-plugin-sh` (which embeds the shfmt engine — no host `shfmt` binary needed). Shell policy (indent, `switchCaseIndent`, `spaceRedirects`, `binaryNextLine`) lives in `.prettierrc`. `.prettierignore` excludes the Biome-owned extensions so a repo-wide Prettier run never crosses the boundary.
- **ShellCheck** lints shell scripts via `bun run lint:sh`, using the host `shellcheck` binary (see the README prerequisites). `.shellcheckrc` holds the policy (bash dialect, optional rules on, known-noise codes off; deliberate patterns are silenced inline with documented `# shellcheck disable=` comments).
- `bun run typecheck` runs `tsc --noEmit`.

### Git hooks (Husky)

Hooks run through Husky and activate themselves: the `prepare` lifecycle script runs on every `bun install` and points `core.hooksPath` at `.husky/_`, so a fresh clone needs zero manual setup. Escape hatches: `git commit --no-verify` skips a hook once, `HUSKY=0` disables Husky entirely.

Hook logic is always written in TypeScript executed by Bun. Because Husky runs hook files through `sh` (a Bun shebang would not be honored), every extensionless hook under `.husky/` is a minimal shell shim delegating to its sibling `.ts` implementation — `exec bun "$(dirname -- "$0")/<hook>.ts" "$@"` — which is the only place Biome and `tsc` see the hooks (`tsconfig.json` includes `.husky/` explicitly because TypeScript's `**` skips dot-directories; `biome.json` mirrors the include). New hooks must follow this shape, and must use the Bun Shell (`import { $ } from "bun";`) for subprocesses whenever possible, in preference to `Bun.spawn`.

Three hooks exist:

- `pre-commit` — lint-staged first (the fixers in `.lintstagedrc.json`: Biome and Prettier on staged files, re-staging whatever changed; blocking verifiers deliberately stay out of lint-staged because it runs glob groups concurrently and a checker racing a writer is not deterministic), then the gates: ShellCheck on staged shell files and the full type check.
- `post-checkout` / `post-merge` — rerun `bun install` unconditionally (a no-op install is sub-second, and file checkouts can also restore dependency manifests from another commit).

### Repository files

- Prefer nested `.gitignore` files (e.g. `tests/.gitignore`) instead of including everything in the root `.gitignore`.
- Keep `README.md` current. Whenever the project is modified, check whether the README still reflects reality — objective, architecture, setup commands, tests — and update it in the same change whenever it does not.
