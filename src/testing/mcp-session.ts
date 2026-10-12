// A JSON-RPC-over-HTTP MCP session for the protocol and integration tiers
// (wayfinder #8): the prototype smoke client's pattern, graduated into a
// proper helper. It drives any Request→Response edge — handleRequest
// in-process for the protocol tier, a real socket's fetch for the
// integration tier — through one session: initialize (capturing
// MCP-Protocol-Version for every later request), notifications/initialized,
// then tools/list and tools/call.
//
// The two hand-rolled-client gotchas from the SDK research are honored
// here: POSTs Accept both application/json and text/event-stream, and the
// reader copes with either framing.

export type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number | string
  result?: {
    protocolVersion?: string
    serverInfo?: { name?: string; version?: string }
    tools?: Array<{ name: string }>
    content?: Array<{ type: string; text: string }>
    isError?: boolean
  }
  error?: { code: number; message: string }
}

export type McpSession = {
  /** The protocol version captured from the initialize response, once initialized. */
  protocolVersion: string | undefined
  initialize(): Promise<JsonRpcMessage>
  notifyInitialized(): Promise<void>
  listTools(): Promise<Array<{ name: string }>>
  callTool(name: string, args: unknown, headers?: Record<string, string>): Promise<JsonRpcMessage>
}

export function resultText(message: JsonRpcMessage): string {
  return (message.result?.content ?? []).map((block) => block.text).join('\n')
}

export function mcpSession(
  url: string,
  post: (request: Request) => Promise<Response>,
  headers: Record<string, string>,
): McpSession {
  let nextId = 1

  const session: McpSession = {
    protocolVersion: undefined,

    async initialize() {
      const message = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'shlink-mcp-tests', version: '0.0.0' },
      })
      session.protocolVersion = message.result?.protocolVersion
      return message
    },

    async notifyInitialized() {
      const response = await post(build({ jsonrpc: '2.0', method: 'notifications/initialized' }, {}))
      if (!(response.status === 202 || response.ok)) {
        throw new Error(
          `HTTP ${response.status} on notifications/initialized: ${(await response.text()).slice(0, 200)}`,
        )
      }
    },

    async listTools() {
      const message = await rpc('tools/list', {})
      if (message.error !== undefined) throw new Error(`tools/list failed: ${message.error.message}`)
      return message.result?.tools ?? []
    },

    async callTool(name, args, extraHeaders = {}) {
      return rpc('tools/call', { name, arguments: args }, extraHeaders)
    },
  }

  function build(body: unknown, extraHeaders: Record<string, string>): Request {
    return new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session.protocolVersion !== undefined && { 'mcp-protocol-version': session.protocolVersion }),
        ...headers,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    })
  }

  async function rpc(
    method: string,
    params: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<JsonRpcMessage> {
    const response = await post(build({ jsonrpc: '2.0', id: nextId++, method, params }, extraHeaders))
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} on ${method}: ${(await response.text()).slice(0, 200)}`)
    }
    return readMessage(response)
  }

  return session
}

// The stateless server may answer application/json or an SSE-framed stream;
// only the message carrying the request id is the response we want.
async function readMessage(response: Response): Promise<JsonRpcMessage> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) return (await response.json()) as JsonRpcMessage
  const text = await response.text()
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      const message = JSON.parse(line.slice(5).trim()) as JsonRpcMessage
      if (message.id !== undefined) return message
    }
  }
  throw new Error(`SSE stream carried no JSON-RPC response: ${text.slice(0, 200)}`)
}
