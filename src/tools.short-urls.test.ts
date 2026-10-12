import { describe, expect, test } from 'bun:test'

import { missingCredentialsToolError } from './errors.ts'
import { fakeShlinkClient, rejectWith } from './testing/fake-shlink-client.ts'
import { TOOLS } from './tools.ts'

const call = (name: keyof typeof TOOLS, args: unknown, responses: Record<string, unknown> = {}) => {
  const fake = fakeShlinkClient(responses)
  return {
    fake,
    result: TOOLS[name].run(args as never, fake.client) as Promise<{
      content: Array<{ type: string; text: string }>
      isError?: true
    }>,
  }
}

describe('list_short_urls', () => {
  test('sends page as a string and passes filters through', async () => {
    const { fake, result } = await call('list_short_urls', {
      page: 2,
      itemsPerPage: 25,
      searchTerm: 'example',
      tags: ['alpha', 'beta'],
      tagsMode: 'all',
      excludeTags: ['gamma'],
      excludeTagsMode: 'any',
      orderBy: 'longUrl-DESC',
      startDate: '2026-01-01T00:00:00+00:00',
      endDate: '2026-06-30T23:59:59+00:00',
      domain: 'DEFAULT',
      excludeMaxVisitsReached: true,
      excludePastValidUntil: false,
    })

    await result
    expect(fake.calls).toEqual([
      {
        method: 'listShortUrls',
        args: [
          {
            page: '2',
            itemsPerPage: 25,
            searchTerm: 'example',
            tags: ['alpha', 'beta'],
            tagsMode: 'all',
            excludeTags: ['gamma'],
            excludeTagsMode: 'any',
            orderBy: { field: 'longUrl', dir: 'DESC' },
            startDate: '2026-01-01T00:00:00+00:00',
            endDate: '2026-06-30T23:59:59+00:00',
            domain: 'DEFAULT',
            excludeMaxVisitsReached: true,
            excludePastValidUntil: false,
          },
        ],
      },
    ])
  })

  test('omits every parameter the caller did not set', async () => {
    const { fake, result } = await call('list_short_urls', {})

    await result
    expect(fake.calls).toEqual([{ method: 'listShortUrls', args: [{}] }])
  })

  test('returns the SDK list as pretty-printed JSON text', async () => {
    const list = { data: [{ shortCode: 'abc' }], pagination: { currentPage: 1, pagesCount: 1, totalItems: 1 } }
    const { result } = await call('list_short_urls', {}, { listShortUrls: list })

    const output = await result
    expect(output.isError).toBeUndefined()
    expect(output.content[0]?.type).toBe('text')
    expect(JSON.parse(output.content[0]?.text ?? '{}')).toEqual(list)
  })

  test('maps a Shlink rejection to the uniform error line', async () => {
    const { result } = await call(
      'list_short_urls',
      {},
      {
        listShortUrls: rejectWith(new Error('fetch failed')),
      },
    )

    const output = await result
    expect(output.isError).toBeTrue()
    expect(output.content[0]?.text).toBe('Could not talk to the Shlink server: fetch failed')
  })
})

describe('create_short_url', () => {
  test('passes the full creation data through', async () => {
    const { fake, result } = await call('create_short_url', {
      longUrl: 'https://example.com/long',
      customSlug: 'my-slug',
      shortCodeLength: 6,
      findIfExists: true,
      domain: 's.example.com',
      validSince: '2026-01-01T00:00:00+00:00',
      validUntil: '2026-12-31T23:59:59+00:00',
      maxVisits: 100,
      tags: ['alpha'],
      title: 'A title',
      crawlable: true,
      forwardQuery: false,
    })

    await result
    expect(fake.calls).toEqual([
      {
        method: 'createShortUrl',
        args: [
          {
            longUrl: 'https://example.com/long',
            customSlug: 'my-slug',
            shortCodeLength: 6,
            findIfExists: true,
            domain: 's.example.com',
            validSince: '2026-01-01T00:00:00+00:00',
            validUntil: '2026-12-31T23:59:59+00:00',
            maxVisits: 100,
            tags: ['alpha'],
            title: 'A title',
            crawlable: true,
            forwardQuery: false,
          },
        ],
      },
    ])
  })

  test('sends only the long URL when nothing else is set', async () => {
    const { fake, result } = await call('create_short_url', { longUrl: 'https://example.com' })

    await result
    expect(fake.calls).toEqual([{ method: 'createShortUrl', args: [{ longUrl: 'https://example.com' }] }])
  })
})

describe('get_short_url', () => {
  test('addresses the short URL by short code and optional domain', async () => {
    const withDomain = await call('get_short_url', { shortCode: 'abc', domain: 's.example.com' })
    await withDomain.result

    const withoutDomain = await call('get_short_url', { shortCode: 'abc' })
    await withoutDomain.result

    expect(withDomain.fake.calls).toEqual([
      { method: 'getShortUrl', args: [{ shortCode: 'abc', domain: 's.example.com' }] },
    ])
    expect(withoutDomain.fake.calls).toEqual([{ method: 'getShortUrl', args: [{ shortCode: 'abc' }] }])
  })
})

describe('update_short_url', () => {
  test('passes explicit nulls through and omits unset fields', async () => {
    const { fake, result } = await call('update_short_url', {
      shortCode: 'abc',
      title: null,
      tags: null,
      validUntil: null,
      maxVisits: null,
      crawlable: true,
    })

    await result
    expect(fake.calls).toEqual([
      {
        method: 'updateShortUrl',
        args: [{ shortCode: 'abc' }, { title: null, tags: null, validUntil: null, maxVisits: null, crawlable: true }],
      },
    ])
  })

  test('replaces longUrl without nulling it', async () => {
    const { fake, result } = await call('update_short_url', { shortCode: 'abc', longUrl: 'https://example.com/new' })

    await result
    expect(fake.calls).toEqual([
      { method: 'updateShortUrl', args: [{ shortCode: 'abc' }, { longUrl: 'https://example.com/new' }] },
    ])
  })

  test('addresses by domain when given', async () => {
    const { fake, result } = await call('update_short_url', { shortCode: 'abc', domain: 's.example.com', title: 'T' })

    await result
    expect(fake.calls).toEqual([
      { method: 'updateShortUrl', args: [{ shortCode: 'abc', domain: 's.example.com' }, { title: 'T' }] },
    ])
  })
})

describe('delete_short_url', () => {
  test('deletes by identifier and confirms in text (the API returns no body)', async () => {
    const { fake, result } = await call('delete_short_url', { shortCode: 'abc' })

    const output = await result
    expect(fake.calls).toEqual([{ method: 'deleteShortUrl', args: [{ shortCode: 'abc' }] }])
    expect(output.isError).toBeUndefined()
    expect(output.content[0]?.text).toBe('Deleted short URL abc.')
  })

  test('mentions the domain in the confirmation when one was given', async () => {
    const { result } = await call('delete_short_url', { shortCode: 'abc', domain: 's.example.com' })

    const output = await result
    expect(output.content[0]?.text).toBe('Deleted short URL s.example.com/abc.')
  })
})

describe('tool calls without credentials', () => {
  test('every short-URL tool answers the missing-credentials error without touching Shlink', async () => {
    for (const name of [
      'list_short_urls',
      'create_short_url',
      'get_short_url',
      'update_short_url',
      'delete_short_url',
    ] as const) {
      const output = await TOOLS[name].run({} as never, null)
      expect(output).toEqual(missingCredentialsToolError())
    }
  })
})
