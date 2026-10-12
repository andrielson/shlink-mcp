# No MCP-server-side auth: credentials pass through per request

The MCP server is a stateless translator with no auth subsystem of its own and
no Shlink configuration in its environment: every request carries the target
instance's own `X-Api-Key` and `X-Shlink-Server-Url`, one fresh SDK client is
built per request, and Shlink itself is the only authenticator (validated
fail-fast at initialize by the credential probe). We chose this over giving the
server its own accounts or OAuth because the destination is a personal
Docker deploy where the client's headers already pin the instance, and one
deploy can then serve any number of instances.

## Consequences

- Exposing this server publicly without adding an auth layer would turn it
  into an open proxy to any URL a caller names (SSRF); a community deploy must
  solve both before widening the destination.
- The client-configuration contract (the two headers) is frozen in the README
  and hard to change once users configure it.
