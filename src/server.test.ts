import { beforeAll, describe, expect, test } from 'bun:test'

import type { ShlinkApiClient } from '@shlinkio/shlink-js-sdk/api-contract'

import type { ShlinkCredentials } from './credentials.ts'
import { handleRequest, type ServerDeps } from './server.ts'
import { type FakeShlinkClient, fakeShlinkClient, rejectWith } from './testing/fake-shlink-client.ts'
import { type McpSession, mcpSession, resultText } from './testing/mcp-session.ts'

// The initialize-time credential probe and the MCP session, driven through
// the handleRequest seam with a fake client factory — no socket, no Shlink.

function initializeRequest(): Request {
  return new Request('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-api-key': 'a-key',
      'x-shlink-server-url': 'https://s.example.com',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe-test', version: '0' } },
    }),
  })
}

function depsWith(client: ShlinkApiClient): ServerDeps {
  return { clientFactory: () => client, serverName: 'test-server', serverVersion: '0.0.0' }
}

describe('credential probe at initialize', () => {
  test('lets the request through when the probe succeeds', async () => {
    const response = await handleRequest(initializeRequest(), depsWith(fakeShlinkClient().client))

    expect(response.status).toBe(200)
  })

  test('answers 401 invalid-credentials when Shlink rejects the key', async () => {
    const fake = fakeShlinkClient({
      listShortUrls: rejectWith({
        type: 'https://shlink.io/api/error/invalid-api-key',
        title: 'Invalid API key',
        detail: 'Provided API key is invalid',
        status: 401,
      }),
    })

    const response = await handleRequest(initializeRequest(), depsWith(fake.client))
    const body = (await response.json()) as { type?: string }

    expect(response.status).toBe(401)
    expect(body.type).toBe('urn:shlink-mcp:error:invalid-credentials')
  })

  test('answers 502 shlink-error when Shlink fails with a non-auth problem (5xx is not bad credentials)', async () => {
    const fake = fakeShlinkClient({
      listShortUrls: rejectWith({
        type: 'https://shlink.io/api/error/internal-error',
        title: 'Internal Server Error',
        detail: 'Unexpected server error',
        status: 500,
      }),
    })

    const response = await handleRequest(initializeRequest(), depsWith(fake.client))
    const body = (await response.json()) as { type?: string }

    expect(response.status).toBe(502)
    expect(body.type).toBe('urn:shlink-mcp:error:shlink-error')
  })

  test('answers 502 shlink-unreachable on a network error', async () => {
    const fake = fakeShlinkClient({ listShortUrls: rejectWith(new Error('fetch failed')) })

    const response = await handleRequest(initializeRequest(), depsWith(fake.client))
    const body = (await response.json()) as { type?: string }

    expect(response.status).toBe(502)
    expect(body.type).toBe('urn:shlink-mcp:error:shlink-unreachable')
  })
})

describe('MCP session through the edge', () => {
  const credentialsSeen: ShlinkCredentials[] = []
  let fake: FakeShlinkClient
  let session: McpSession

  beforeAll(async () => {
    fake = fakeShlinkClient()
    const deps: ServerDeps = {
      clientFactory: (credentials) => {
        credentialsSeen.push(credentials)
        return fake.client
      },
      serverName: 'test-server',
      serverVersion: '0.0.0',
    }
    session = mcpSession('http://localhost:3000/mcp', (request) => handleRequest(request, deps), {
      'x-api-key': 'a-key',
      'x-shlink-server-url': 'https://s.example.com',
    })
    await session.initialize()
    await session.notifyInitialized()
  }, 10_000)

  test('tools/list exposes exactly the twelve frozen tools', async () => {
    const tools = await session.listTools()

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'create_short_url',
      'delete_short_url',
      'delete_short_url_visits',
      'delete_tags',
      'get_short_url',
      'get_short_url_visits',
      'get_tag_visits',
      'get_tags_stats',
      'list_short_urls',
      'list_tags',
      'rename_tag',
      'update_short_url',
    ])
  })

  test('a schema-violating tool call is rejected without reaching Shlink', async () => {
    const callsBefore = fake.calls.length

    const message = await session.callTool('list_short_urls', { itemsPerPage: 201 })

    // The SDK reports schema violations as an isError tool result naming the
    // offending parameter, never letting the run function (or Shlink) see them.
    expect(message.result?.isError).toBe(true)
    expect(resultText(message)).toContain('Input validation error')
    expect(resultText(message)).toContain('itemsPerPage')
    expect(fake.calls.length).toBe(callsBefore)
  })

  test('each request builds its Shlink client from that request’s headers', async () => {
    await session.callTool('list_short_urls', {}, { 'x-shlink-server-url': 'https://other.example.com' })

    const last = credentialsSeen.at(-1)
    expect(last?.serverUrl).toBe('https://other.example.com')
    expect(last?.apiKey).toBe('a-key')
  })

  test('a POST missing the credential headers is turned away at the edge', async () => {
    const request = new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list', params: {} }),
    })

    const response = await handleRequest(request)
    const body = (await response.json()) as { type?: string }

    expect(response.status).toBe(401)
    expect(body.type).toBe('urn:shlink-mcp:error:missing-credentials')
  })
})
