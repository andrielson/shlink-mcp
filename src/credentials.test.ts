import { describe, expect, test } from 'bun:test'

import { credentialsFrom } from './credentials.ts'

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/mcp', { method: 'POST', headers })
}

describe('credentialsFrom', () => {
  test('extracts the API key and server URL from a request', () => {
    const request = requestWith({ 'X-Api-Key': 'a-key', 'X-Shlink-Server-Url': 'https://s.example.com' })

    expect(credentialsFrom(request)).toEqual({ apiKey: 'a-key', serverUrl: 'https://s.example.com' })
  })

  test('returns null when the API key header is missing', () => {
    const request = requestWith({ 'X-Shlink-Server-Url': 'https://s.example.com' })

    expect(credentialsFrom(request)).toBeNull()
  })

  test('returns null when the server URL header is missing', () => {
    const request = requestWith({ 'X-Api-Key': 'a-key' })

    expect(credentialsFrom(request)).toBeNull()
  })

  test('matches header names case-insensitively', () => {
    const request = requestWith({ 'x-api-key': 'a-key', 'x-shlink-server-url': 'https://s.example.com' })

    expect(credentialsFrom(request)).toEqual({ apiKey: 'a-key', serverUrl: 'https://s.example.com' })
  })
})
