// The HTTP edge and MCP wiring. handleRequest is the seam the protocol-tier
// tests drive: everything mutable arrives through deps (the client factory,
// the reported server identity), so tests inject fakes without sockets.

import { createMcpHandler, type McpHttpHandler, McpServer } from '@modelcontextprotocol/server'
import type { ShlinkApiClient } from '@shlinkio/shlink-js-sdk/api-contract'

import pkg from '../package.json' with { type: 'json' }
import { credentialsFrom } from './credentials.ts'
import { isProblemDetails, problemResponse } from './errors.ts'
import { type ClientFactory, defaultClientFactory } from './shlink-client.ts'
import { TOOLS } from './tools.ts'

export const MCP_PATH = '/mcp'

export type ServerDeps = {
  clientFactory: ClientFactory
  serverName: string
  serverVersion: string
}

export const defaultDeps: ServerDeps = {
  clientFactory: defaultClientFactory,
  serverName: 'shlink-mcp',
  serverVersion: pkg.version,
}

// The catalog is static, but each HTTP request carries its own credentials,
// so the handler factory builds a fresh McpServer (and a fresh Shlink client)
// per request. The outer handler itself is stateless and memoized per deps.
const mcpHandlers = new WeakMap<ServerDeps, McpHttpHandler>()

function mcpHandlerFor(deps: ServerDeps): McpHttpHandler {
  let handler = mcpHandlers.get(deps)
  if (handler === undefined) {
    handler = createMcpHandler((reqCtx) => {
      const credentials = reqCtx.requestInfo ? credentialsFrom(reqCtx.requestInfo) : null
      const client = credentials ? deps.clientFactory(credentials) : null
      const server = new McpServer({ name: deps.serverName, version: deps.serverVersion })
      registerTools(server, client)
      return server
    })
    mcpHandlers.set(deps, handler)
  }
  return handler
}

function registerTools(server: McpServer, client: ShlinkApiClient | null): void {
  for (const [name, tool] of Object.entries(TOOLS)) {
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: tool.inputSchema,
      },
      // registerTool has already validated args against this entry's schema,
      // so the run function's exact argument type holds at this point.
      (args: unknown) => tool.run(args as never, client),
    )
  }
}

// One lightweight authenticated call: a bad key or unreachable server fails
// the MCP connection itself (initialize), not the first tool call later.
// Only auth rejections (401/403) mean bad credentials — any other problem
// from the instance is an upstream failure, not the client's fault.
async function credentialProbe(client: ShlinkApiClient): Promise<Response | null> {
  try {
    await client.listShortUrls({ page: '1', itemsPerPage: 1 })
    return null
  } catch (error) {
    if (isProblemDetails(error)) {
      if (error.status === 401 || error.status === 403) {
        return problemResponse(
          401,
          'invalid-credentials',
          'Shlink rejected the credentials',
          `X-Api-Key / X-Shlink-Server-Url were rejected by the target Shlink instance: ${error.detail}`,
        )
      }
      return problemResponse(
        502,
        'shlink-error',
        'The Shlink instance returned an error',
        `The credential probe failed with an unexpected error: ${error.detail} (HTTP ${error.status})`,
      )
    }
    return problemResponse(
      502,
      'shlink-unreachable',
      'Could not reach the Shlink instance',
      `The X-Shlink-Server-Url target could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function isInitializeRequest(request: Request): Promise<boolean> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return false
  try {
    const body: unknown = await request.clone().json()
    if (Array.isArray(body) || typeof body !== 'object' || body === null) return false
    return (body as { method?: unknown }).method === 'initialize'
  } catch {
    return false
  }
}

export async function handleRequest(request: Request, deps: ServerDeps = defaultDeps): Promise<Response> {
  const pathname = new URL(request.url).pathname

  if (pathname === '/health') return Response.json({ ok: true })
  if (pathname !== MCP_PATH) {
    return problemResponse(404, 'not-found', 'Not found', `Unknown path: ${pathname}. The MCP endpoint is ${MCP_PATH}.`)
  }

  const credentials = credentialsFrom(request)
  if (!credentials) {
    return problemResponse(
      401,
      'missing-credentials',
      'Missing Shlink credentials',
      'Every request must carry an X-Api-Key header (the target Shlink instance API key) and an X-Shlink-Server-Url header (the target Shlink base URL).',
    )
  }

  if (request.method === 'POST' && (await isInitializeRequest(request))) {
    const rejection = await credentialProbe(deps.clientFactory(credentials))
    if (rejection) return rejection
  }

  return mcpHandlerFor(deps).fetch(request)
}
