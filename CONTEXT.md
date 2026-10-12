# shlink-mcp

An MCP server exposing one Shlink instance's REST API as tools, per request: a
stateless translator between an MCP client and whichever Shlink instance the
client names through its credential headers.

## Language

### Shlink side

**Shlink instance**:
One deployment of the Shlink URL shortener, with its own base URL and API key.
_Avoid_: server (alone), backend, Shlink server — reserve “server” for the MCP server.

**Short URL**:
One shortened-link record: short code, long URL, tags, title, validity rules and visit stats.
_Avoid_: link, redirect (a redirect is what a visitor's browser does).

**Long URL**:
The destination a short URL redirects to.
_Avoid_: target URL, original URL.

**Short code**:
The path segment identifying a short URL, generated or custom.
_Avoid_: slug on its own, code, ID.

**Custom slug**:
A caller-chosen short code, set at creation time instead of a generated one.
_Avoid_: vanity URL, custom code.

**Domain authority**:
The domain a short URL lives under on a multi-domain instance; the keyword
`DEFAULT` addresses the default domain in filters.
_Avoid_: domain (alone) when the authority, not DNS, is meant.

**Tag**:
A label grouping short URLs. Renaming or deleting a tag applies to every short
URL carrying it.
_Avoid_: label, category.

**Pagination envelope**:
The `{currentPage, pagesCount, totalItems}` object returned alongside every
list result, letting the caller decide to page.

**Visit**:
One redirect event on a short URL or tag, optionally flagged as potential bot.
_Avoid_: hit, click.

**Visit surfaces**:
The three distinct visit reads: per-short-URL visits (one short code), tag
visits (every short URL carrying a tag), and tags stats (visit totals per tag
without the visits themselves).

**Problem details**:
Shlink's RFC 7807 error body (`type`, `title`, `detail`, `status`); the
`type` URI's last segment is the error code (e.g. `invalid-api-key`).
_Avoid_: error JSON, API error body.

### MCP side

**MCP server**:
This project's translator: stateless, no accounts of its own, deployed once
and aimed at any Shlink instance per request.
_Avoid_: the server, backend.

**Credential headers**:
The two headers every MCP request carries: `X-Api-Key` (the target Shlink
instance's own key) and `X-Shlink-Server-Url` (its base URL, without
`/rest/v3`).
_Avoid_: auth headers, API headers.

**Credential probe**:
The one lightweight authenticated call made at the MCP connection handshake —
`initialize` or `server/discover`, whichever the client opens with — so bad
credentials or an unreachable instance fail the connection, not the first tool
call.

**Tool**:
One operation in the frozen twelve-tool catalog; fine-grained, one Shlink
operation each.

**Null-clears**:
The update convention: an explicit `null` in a tool argument clears the field
in Shlink, an omitted argument leaves it unchanged. On the wire, tags are the
exception — Shlink ignores `tags: null` on PATCH, so the server sends the
empty array to clear them.

### Testing

**Unit tier**:
Tests of pure seams behind fake clients — argument→SDK-call mapping, error
mapping, schema contracts. No MCP protocol, no HTTP, no Shlink.

**Protocol tier**:
Tests driving JSON-RPC in-process against the HTTP-edge function with a fake
client factory — catalog shape, schema rejection, header plumbing, probe
behavior.

**Integration tier**:
Tests against a real ephemeral Shlink end-to-end, through a real socket.

**Ephemeral Shlink**:
The throwaway containerized Shlink instance tests run against; never the
owner's real instance.

**Per-worktree compose identity**:
The generated compose project name and published port (recorded in a
gitignored `tests/.env`) that let parallel worktrees each own their ephemeral
Shlink.

**Visit seeding**:
Populating short-URL visits in tests by following the short URL with plain
HTTP requests, which Shlink tracks as visits.
