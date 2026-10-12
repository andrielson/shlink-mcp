import { describe, expect, test } from 'bun:test'

import {
  isProblemDetails,
  missingCredentialsToolError,
  problemResponse,
  ShlinkApiClientError,
  shlinkErrorCode,
  toToolError,
} from './errors.ts'

describe('isProblemDetails', () => {
  test('accepts an RFC 7807 problem body', () => {
    expect(
      isProblemDetails({
        type: 'https://shlink.io/api/error/invalid-api-key',
        title: 'Invalid API key',
        detail: 'Provided API key is invalid',
        status: 401,
      }),
    ).toBeTrue()
  })

  test('rejects objects missing problem fields', () => {
    expect(isProblemDetails({ type: 'x', title: 'y' })).toBeFalse()
    expect(isProblemDetails(null)).toBeFalse()
    expect(isProblemDetails('nope')).toBeFalse()
  })
})

describe('shlinkErrorCode', () => {
  test('strips the Shlink error-type prefix', () => {
    expect(shlinkErrorCode('https://shlink.io/api/error/short-url-not-found')).toBe('short-url-not-found')
  })

  test('passes foreign type URIs through unchanged', () => {
    expect(shlinkErrorCode('urn:example:error')).toBe('urn:example:error')
  })
})

describe('toToolError', () => {
  test('maps a typed Shlink API error to the uniform line', () => {
    const error = new ShlinkApiClientError({
      type: 'https://shlink.io/api/error/invalid-api-key',
      title: 'Invalid API key',
      detail: 'Provided API key is invalid',
      status: 401,
    })

    const result = toToolError(error)
    expect(result.isError).toBeTrue()
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Shlink API error 401 (invalid-api-key): Invalid API key — Provided API key is invalid',
    })
  })

  test('maps a raw problem+json rejection (guard path, no decorator in front)', () => {
    const result = toToolError({
      type: 'https://shlink.io/api/error/short-url-not-found',
      title: 'Short URL not found',
      detail: 'No URL found with short code "abc"',
      status: 404,
    })

    expect(result.isError).toBeTrue()
    expect(result.content[0]?.type).toBe('text')
    if (result.content[0]?.type !== 'text') throw new Error('unreachable')
    expect(result.content[0].text).toBe(
      'Shlink API error 404 (short-url-not-found): Short URL not found — No URL found with short code "abc"',
    )
  })

  test('appends invalidElements when the problem body carries them', () => {
    const result = toToolError({
      type: 'https://shlink.io/api/error/invalid-data',
      title: 'Invalid data',
      detail: 'Provided data is invalid',
      status: 400,
      invalidElements: ['longUrl', 'maxVisits'],
    })

    if (result.content[0]?.type !== 'text') throw new Error('unreachable')
    expect(result.content[0].text).toBe(
      'Shlink API error 400 (invalid-data): Invalid data — Provided data is invalid invalidElements: ["longUrl","maxVisits"]',
    )
  })

  test('does not append invalidElements when the body lacks them', () => {
    const result = toToolError({
      type: 'https://shlink.io/api/error/invalid-data',
      title: 'Invalid data',
      detail: 'Provided data is invalid',
      status: 400,
      invalidElements: [],
    })

    if (result.content[0]?.type !== 'text') throw new Error('unreachable')
    expect(result.content[0].text).not.toInclude('invalidElements')
  })

  test('maps a non-problem Error to the could-not-talk line', () => {
    const result = toToolError(new Error('fetch failed'))

    expect(result.isError).toBeTrue()
    if (result.content[0]?.type !== 'text') throw new Error('unreachable')
    expect(result.content[0].text).toBe('Could not talk to the Shlink server: fetch failed')
  })

  test('maps an unknown thrown value to the unexpected line', () => {
    const result = toToolError('boom')

    expect(result.isError).toBeTrue()
    if (result.content[0]?.type !== 'text') throw new Error('unreachable')
    expect(result.content[0].text).toBe('Unexpected error: boom')
  })
})

describe('missingCredentialsToolError', () => {
  test('returns an error result naming both required headers', () => {
    const result = missingCredentialsToolError()

    expect(result.isError).toBeTrue()
    if (result.content[0]?.type !== 'text') throw new Error('unreachable')
    expect(result.content[0].text).toInclude('X-Api-Key')
    expect(result.content[0].text).toInclude('X-Shlink-Server-Url')
  })
})

describe('problemResponse', () => {
  test('renders an HTTP response with a shlink-mcp problem body', async () => {
    const response = problemResponse(401, 'missing-credentials', 'Missing Shlink credentials', 'Send both headers.')

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toInclude('application/json')
    await expect(response.json()).resolves.toEqual({
      type: 'urn:shlink-mcp:error:missing-credentials',
      title: 'Missing Shlink credentials',
      detail: 'Send both headers.',
      status: 401,
    })
  })
})
