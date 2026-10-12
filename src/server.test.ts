import { describe, expect, test } from 'bun:test'

import type { ShlinkApiClient } from '@shlinkio/shlink-js-sdk/api-contract'

import { handleRequest, type ServerDeps } from './server.ts'
import { fakeShlinkClient, rejectWith } from './testing/fake-shlink-client.ts'

// The initialize-time credential probe, driven through the handleRequest
// seam with a fake client factory — no socket, no Shlink.

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
