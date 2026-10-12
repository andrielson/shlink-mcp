// Entry point: Bun's HTTP server as a one-line wrapper around the testable
// edge function. Everything interesting lives in server.ts.

import { handleRequest } from './server.ts'

const PORT = Number(process.env.PORT ?? 3000)

Bun.serve({
  port: PORT,
  fetch: (request) => handleRequest(request),
})

console.error(`[shlink-mcp] listening on http://localhost:${PORT}/mcp`)
