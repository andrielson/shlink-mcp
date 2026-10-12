import { describe, expect, test } from 'bun:test'

import type { HttpClient } from '@shlinkio/shlink-js-sdk'

import { ShlinkApiClientError } from './errors.ts'
import { defaultClientFactory, problemDetailsAsErrors } from './shlink-client.ts'

function httpClientWith(rejections: { json?: unknown; empty?: unknown }): HttpClient & {
  jsonArgs: Array<[string, unknown]>
  emptyArgs: Array<[string, unknown]>
} {
  const tracked = {
    jsonArgs: [] as Array<[string, unknown]>,
    emptyArgs: [] as Array<[string, unknown]>,
    jsonRequest<T>(url: string, options?: unknown): Promise<T> {
      tracked.jsonArgs.push([url, options])
      return rejections.json === undefined ? Promise.resolve({ ok: true } as T) : Promise.reject(rejections.json)
    },
    emptyRequest(url: string, options?: unknown): Promise<void> {
      tracked.emptyArgs.push([url, options])
      return rejections.empty === undefined ? Promise.resolve() : Promise.reject(rejections.empty)
    },
  }
  return tracked as HttpClient & typeof tracked
}

describe('problemDetailsAsErrors', () => {
  test('turns a raw problem+json rejection into a ShlinkApiClientError', async () => {
    const problem = {
      type: 'https://shlink.io/api/error/invalid-api-key',
      title: 'Invalid API key',
      detail: 'Provided API key is invalid',
      status: 401,
    }
    const inner = httpClientWith({ json: problem })
    const decorated = problemDetailsAsErrors(inner)

    const error = await decorated.jsonRequest('/rest/v3/short-urls').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ShlinkApiClientError)
    if (error instanceof ShlinkApiClientError) {
      expect(error.status).toBe(401)
      expect(error.type).toBe('https://shlink.io/api/error/invalid-api-key')
    }
  })

  test('passes non-problem rejections through unchanged', async () => {
    const networkError = new TypeError('fetch failed')
    const decorated = problemDetailsAsErrors(httpClientWith({ json: networkError }))

    const error = await decorated.jsonRequest('/rest/v3/short-urls').catch((e: unknown) => e)

    expect(error).toBe(networkError)
  })

  test('forwards calls and successful results to the inner client', async () => {
    const inner = httpClientWith({})
    const decorated = problemDetailsAsErrors(inner)

    await expect(decorated.jsonRequest('/rest/v3/short-urls', { method: 'GET' })).resolves.toEqual({ ok: true })
    await expect(decorated.emptyRequest('/rest/v3/tags', { method: 'DELETE' })).resolves.toBeUndefined()

    expect(inner.jsonArgs).toEqual([['/rest/v3/short-urls', { method: 'GET' }]])
    expect(inner.emptyArgs).toEqual([['/rest/v3/tags', { method: 'DELETE' }]])
  })

  test('normalizes emptyRequest rejections too', async () => {
    const problem = {
      type: 'https://shlink.io/api/error/short-url-not-found',
      title: 'Short URL not found',
      detail: 'No URL found with short code "abc"',
      status: 404,
    }
    const decorated = problemDetailsAsErrors(httpClientWith({ empty: problem }))

    const error = await decorated.emptyRequest('/rest/v3/short-urls/abc').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ShlinkApiClientError)
  })
})

describe('defaultClientFactory', () => {
  test('builds a client aimed at the credentials without touching the network', () => {
    const client = defaultClientFactory({ apiKey: 'a-key', serverUrl: 'https://s.example.com' })

    // The contract surface our tools call; reachability is the smoke run's job.
    expect(typeof client.listShortUrls).toBe('function')
    expect(typeof client.editTag).toBe('function')
    expect(typeof client.deleteShortUrlVisits).toBe('function')
  })
})
