// The integration tier (CONTEXT.md): the MCP server end-to-end through a
// real Bun.serve socket against the real ephemeral Shlink — no fakes. One
// compose lifecycle and one server per run (this is the only integration
// file; a second file would start a second lifecycle).
//
// The tests form an ordered story over the single fresh instance: later
// tests build on the short URLs, tags and visits earlier ones created, so
// declaration order is load-bearing — bun:test runs them in order.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { handleRequest } from '../../src/server.ts'
import { type McpSession, mcpSession, resultText } from '../../src/testing/mcp-session.ts'
import {
  externallyManagedShlink,
  resolveTestsIdentity,
  shlinkTarget,
  startEphemeralShlink,
  stopEphemeralShlink,
  type TestsIdentity,
} from '../compose-project.ts'

// ---------------------------------------------------------------------------
// Harness: compose identity, ephemeral Shlink, real socket, MCP session
// ---------------------------------------------------------------------------

type Pagination = { currentPage: number; pagesCount: number; totalItems: number }
type ShortUrlRecord = { shortCode: string; longUrl: string; title: string | null; tags: string[] }
type VisitRecord = { potentialBot: boolean }
type VisitsPage = { data: VisitRecord[]; pagination: Pagination }
type TagStatsEntry = {
  tag: string
  shortUrlsCount: number
  visitsSummary: { total: number; nonBots: number; bots: number }
}

// Deterministic user agents, so bot classification never depends on how
// Bun's fetch introduces itself.
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

let identity: TestsIdentity
let target: { baseUrl: string; apiKey: string }
let server: ReturnType<typeof Bun.serve> | undefined
let session: McpSession
let mcpUrl: string

beforeAll(async () => {
  identity = await resolveTestsIdentity()
  target = shlinkTarget(identity)
  if (!externallyManagedShlink()) await startEphemeralShlink(identity)

  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => handleRequest(request) })
  mcpUrl = `http://127.0.0.1:${server.port}/mcp`
  session = mcpSession(mcpUrl, (request) => fetch(request), {
    'x-api-key': target.apiKey,
    'x-shlink-server-url': target.baseUrl,
  })

  const initialized = await session.initialize()
  expect(initialized.error).toBeUndefined()
  await session.notifyInitialized()
}, 180_000)

afterAll(async () => {
  server?.stop(true)
  if (identity !== undefined && !externallyManagedShlink()) await stopEphemeralShlink(identity)
}, 60_000)

/** Call a tool and parse its JSON payload, failing loudly on isError results. */
async function toolJson<T>(name: string, args: unknown, headers?: Record<string, string>): Promise<T> {
  const message = await session.callTool(name, args, headers)
  const text = resultText(message)
  if (message.result?.isError === true) throw new Error(`${name} returned an error result: ${text}`)
  return JSON.parse(text) as T
}

/** Call a tool expected to fail, capturing the error line the client sees. */
async function toolError(
  name: string,
  args: unknown,
  headers?: Record<string, string>,
): Promise<{ isError: boolean; text: string }> {
  const message = await session.callTool(name, args, headers)
  return { isError: message.result?.isError === true, text: resultText(message) }
}

// Visit seeding (CONTEXT.md): following the short URL over plain HTTP with
// manual redirects — Shlink records the redirect itself, the long URL is
// never fetched, and the default-domain Host header doesn't matter.
// Sequential on purpose: the instance's SQLite store 500s on concurrent
// writes (same reason the bulk creations below run one at a time).
async function seedVisits(shortCode: string, count: number, userAgent: string): Promise<void> {
  for (let i = 0; i < count; i++) {
    await fetch(`${target.baseUrl}/${shortCode}`, { redirect: 'manual', headers: { 'user-agent': userAgent } })
  }
}

// Shlink persists visits around serving the redirects; give a freshly seeded
// count a moment to become visible before letting the assertion fail.
async function waitFor<T>(read: () => Promise<T>, satisfies: (value: T) => boolean, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms
  let value = await read()
  while (!satisfies(value) && Date.now() < deadline) {
    await Bun.sleep(100)
    value = await read()
  }
  return value
}

// ---------------------------------------------------------------------------
// The HTTP edge
// ---------------------------------------------------------------------------

describe('the HTTP edge over a real socket', () => {
  test('GET /health answers ok', async () => {
    const response = await fetch(`http://127.0.0.1:${server?.port}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test('an unknown path answers 404 problem+json naming the MCP endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${server?.port}/nope`)
    const body = (await response.json()) as { type?: string; detail?: string }

    expect(response.status).toBe(404)
    expect(body.type).toBe('urn:shlink-mcp:error:not-found')
    expect(body.detail).toContain('/mcp')
  })

  test('a POST without credential headers is turned away before the MCP handler', async () => {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    const body = (await response.json()) as { type?: string }

    expect(response.status).toBe(401)
    expect(body.type).toBe('urn:shlink-mcp:error:missing-credentials')
  })

  test('initialize with a rejected key fails the connection at the credential probe', async () => {
    const badKeySession = mcpSession(mcpUrl, (request) => fetch(request), {
      'x-api-key': 'wrong-key-on-purpose',
      'x-shlink-server-url': target.baseUrl,
    })

    await expect(badKeySession.initialize()).rejects.toThrow('HTTP 401')
  })
})

// ---------------------------------------------------------------------------
// The twelve frozen tools, as one ordered story
// ---------------------------------------------------------------------------

const stamp = `it${Date.now().toString(36)}`
const tags = {
  primaryA: `${stamp}-alpha`,
  primaryB: `${stamp}-beta`,
  bulk: `${stamp}-bulk`,
  renamed: `${stamp}-renamed`,
  visits: `${stamp}-visits`,
}

const story = {
  primary: undefined as ShortUrlRecord | undefined,
  bulkFirstCode: '',
  visitsShortCode: '',
}

describe('the twelve frozen tools against a fresh ephemeral Shlink', () => {
  test('create_short_url creates and returns the short URL', async () => {
    const created = await toolJson<ShortUrlRecord>('create_short_url', {
      longUrl: `https://example.com/${stamp}-primary`,
      customSlug: `${stamp}-main`,
      tags: [tags.primaryA, tags.primaryB],
      title: `${stamp} primary`,
    })

    expect(created.shortCode).toBe(`${stamp}-main`)
    expect(created.longUrl).toBe(`https://example.com/${stamp}-primary`)
    expect(created.title).toBe(`${stamp} primary`)
    expect(created.tags).toEqual([tags.primaryA, tags.primaryB])
    story.primary = created
  }, 30_000)

  test('get_short_url fetches it back by short code', async () => {
    const fetched = await toolJson<ShortUrlRecord>('get_short_url', { shortCode: story.primary?.shortCode })

    expect(fetched.longUrl).toBe(`https://example.com/${stamp}-primary`)
    expect(fetched.tags).toEqual([tags.primaryA, tags.primaryB])
  })

  test('update_short_url replaces the fields it is given', async () => {
    const updated = await toolJson<ShortUrlRecord>('update_short_url', {
      shortCode: story.primary?.shortCode,
      longUrl: `https://example.com/${stamp}-primary-v2`,
      title: `${stamp} primary v2`,
    })

    expect(updated.longUrl).toBe(`https://example.com/${stamp}-primary-v2`)
    expect(updated.title).toBe(`${stamp} primary v2`)
    // Omitted fields (tags) are left unchanged.
    expect(updated.tags).toEqual([tags.primaryA, tags.primaryB])
  })

  test('null-clears: explicit nulls clear title and tags, omission keeps the rest', async () => {
    const updated = await toolJson<ShortUrlRecord>('update_short_url', {
      shortCode: story.primary?.shortCode,
      title: null,
      tags: null,
    })

    expect(updated.title).toBeNull()
    expect(updated.tags).toEqual([])
    expect(updated.longUrl).toBe(`https://example.com/${stamp}-primary-v2`)

    // The round trip the strategy asked for: a get afterwards shows the
    // fields cleared, not just the update response.
    const refetched = await toolJson<ShortUrlRecord>('get_short_url', { shortCode: story.primary?.shortCode })
    expect(refetched.title).toBeNull()
    expect(refetched.tags).toEqual([])
    expect(refetched.longUrl).toBe(`https://example.com/${stamp}-primary-v2`)
  })

  test('list_short_urls pages with the Shlink default of 10 and the pagination envelope', async () => {
    // 11 more short URLs (bulk-0 also carries the visits tag for later),
    // created one at a time: the instance's SQLite store 500s under
    // concurrent writes.
    const bulkCodes: string[] = []
    for (let i = 0; i < 11; i++) {
      const first = i === 0
      const created = await toolJson<ShortUrlRecord>('create_short_url', {
        longUrl: `https://example.com/${stamp}-bulk-${i}`,
        tags: first ? [tags.bulk, tags.visits] : [tags.bulk],
      })
      if (first) story.bulkFirstCode = created.shortCode
      bulkCodes.push(created.shortCode)
    }
    expect(bulkCodes).toHaveLength(11)

    // Only the primary existed before the bulk (the visits and bots URLs
    // are created by later tests), so 1 + 11 = 12 total.
    const firstPage = await toolJson<{ data: ShortUrlRecord[]; pagination: Pagination }>('list_short_urls', {})
    expect(firstPage.data).toHaveLength(10)
    expect(firstPage.pagination.currentPage).toBe(1)
    expect(firstPage.pagination.totalItems).toBe(12)
    expect(firstPage.pagination.pagesCount).toBe(2)

    const secondPage = await toolJson<{ data: ShortUrlRecord[]; pagination: Pagination }>('list_short_urls', {
      page: 2,
    })
    expect(secondPage.data).toHaveLength(2)
    expect(secondPage.pagination.currentPage).toBe(2)

    // The default page size caps a filtered list too.
    const filtered = await toolJson<{ data: ShortUrlRecord[]; pagination: Pagination }>('list_short_urls', {
      searchTerm: `${stamp}-bulk-`,
    })
    expect(filtered.pagination.totalItems).toBe(11)
    expect(filtered.data).toHaveLength(10)
  }, 60_000)

  test('get_short_url_visits lists seeded visits with the 50 default cap', async () => {
    const created = await toolJson<ShortUrlRecord>('create_short_url', {
      longUrl: `https://example.com/${stamp}-visits`,
      customSlug: `${stamp}-v`,
      tags: [tags.visits],
    })
    story.visitsShortCode = created.shortCode
    await seedVisits(created.shortCode, 55, BROWSER_UA)

    const defaultPage = await waitFor(
      () => toolJson<VisitsPage>('get_short_url_visits', { shortCode: created.shortCode }),
      (page) => page.pagination.totalItems === 55,
    )
    expect(defaultPage.data).toHaveLength(50)
    // The envelope also carries itemsPerPage/itemsInCurrentPage; the frozen
    // contract passes responses through raw, so assert the documented trio
    // without pinning the whole object.
    expect(defaultPage.pagination.currentPage).toBe(1)
    expect(defaultPage.pagination.pagesCount).toBe(2)
    expect(defaultPage.pagination.totalItems).toBe(55)

    const secondPage = await toolJson<VisitsPage>('get_short_url_visits', { shortCode: created.shortCode, page: 2 })
    expect(secondPage.data).toHaveLength(5)

    const uncapped = await toolJson<VisitsPage>('get_short_url_visits', {
      shortCode: created.shortCode,
      itemsPerPage: 200,
    })
    expect(uncapped.data).toHaveLength(55)
    // Seeded with a browser UA: nothing here is a potential bot.
    expect(uncapped.data.every((visit) => visit.potentialBot === false)).toBe(true)
  }, 60_000)

  test('excludeBots hides the potential-bot visits', async () => {
    const created = await toolJson<ShortUrlRecord>('create_short_url', {
      longUrl: `https://example.com/${stamp}-bots`,
      customSlug: `${stamp}-b`,
      tags: [`${stamp}-bots`],
    })
    await seedVisits(created.shortCode, 3, BROWSER_UA)
    await seedVisits(created.shortCode, 2, BOT_UA)

    const all = await waitFor(
      () => toolJson<VisitsPage>('get_short_url_visits', { shortCode: created.shortCode }),
      (page) => page.pagination.totalItems === 5,
    )
    expect(all.data).toHaveLength(5)
    expect(all.data.filter((visit) => visit.potentialBot).length).toBe(2)

    const noBots = await toolJson<VisitsPage>('get_short_url_visits', {
      shortCode: created.shortCode,
      excludeBots: true,
    })
    expect(noBots.pagination.totalItems).toBe(3)
    expect(noBots.data).toHaveLength(3)
    expect(noBots.data.every((visit) => visit.potentialBot === false)).toBe(true)
  }, 60_000)

  test('list_tags returns every tag with its pagination envelope', async () => {
    const listed = await toolJson<{ data: string[]; pagination: Pagination }>('list_tags', {})

    for (const tag of [tags.primaryA, tags.primaryB, tags.bulk, tags.visits, `${stamp}-bots`]) {
      expect(listed.data).toContain(tag)
    }
    expect(listed.pagination.totalItems).toBeGreaterThanOrEqual(5)
  })

  test('rename_tag moves every carrying short URL to the new name', async () => {
    const renamed = await toolJson<{ oldName: string; newName: string }>('rename_tag', {
      oldName: tags.bulk,
      newName: tags.renamed,
    })

    expect(renamed).toEqual({ oldName: tags.bulk, newName: tags.renamed })

    const listed = await toolJson<{ data: string[] }>('list_tags', {})
    expect(listed.data).toContain(tags.renamed)
    expect(listed.data).not.toContain(tags.bulk)

    const bulkFirst = await toolJson<ShortUrlRecord>('get_short_url', { shortCode: story.bulkFirstCode })
    expect(bulkFirst.tags).toContain(tags.renamed)
    expect(bulkFirst.tags).not.toContain(tags.bulk)
  })

  test('get_tag_visits aggregates visits across the tag’s short URLs (50 default cap)', async () => {
    // 5 more visits on bulk-0, which also carries the visits tag: the tag
    // then covers 55 (visits URL) + 5 (bulk-0) = 60 visits.
    await seedVisits(story.bulkFirstCode, 5, BROWSER_UA)

    const defaultPage = await waitFor(
      () => toolJson<VisitsPage>('get_tag_visits', { tag: tags.visits }),
      (page) => page.pagination.totalItems === 60,
    )
    expect(defaultPage.data).toHaveLength(50)
    expect(defaultPage.pagination.currentPage).toBe(1)
    expect(defaultPage.pagination.pagesCount).toBe(2)
    expect(defaultPage.pagination.totalItems).toBe(60)

    const uncapped = await toolJson<VisitsPage>('get_tag_visits', { tag: tags.visits, itemsPerPage: 200 })
    expect(uncapped.data).toHaveLength(60)
  }, 60_000)

  test('get_tags_stats reports per-tag short-URL counts and visit totals', async () => {
    const stats = await waitFor(
      () => toolJson<{ data: TagStatsEntry[] }>('get_tags_stats', {}),
      (result) => {
        const visits = result.data.find((entry) => entry.tag === tags.visits)
        return visits?.shortUrlsCount === 2 && visits.visitsSummary.total === 60
      },
    )

    const visits = stats.data.find((entry) => entry.tag === tags.visits)
    expect(visits?.shortUrlsCount).toBe(2)
    expect(visits?.visitsSummary.total).toBe(60)

    const renamed = stats.data.find((entry) => entry.tag === tags.renamed)
    expect(renamed?.shortUrlsCount).toBe(11)
  }, 30_000)

  test('delete_tags keeps the short URLs and drops only the tags', async () => {
    await toolJson('delete_tags', { tags: [tags.renamed] })

    const listed = await toolJson<{ data: string[] }>('list_tags', {})
    expect(listed.data).not.toContain(tags.renamed)

    const bulkFirst = await toolJson<ShortUrlRecord>('get_short_url', { shortCode: story.bulkFirstCode })
    expect(bulkFirst.tags).toEqual([tags.visits])
  })

  test('delete_short_url_visits returns the deleted count and empties the visit list', async () => {
    const result = await toolJson<{ deletedVisits: number }>('delete_short_url_visits', {
      shortCode: story.visitsShortCode,
    })

    expect(result.deletedVisits).toBe(55)

    const visits = await toolJson<VisitsPage>('get_short_url_visits', { shortCode: story.visitsShortCode })
    expect(visits.pagination.totalItems).toBe(0)
    expect(visits.data).toHaveLength(0)
  })

  test('delete_short_url removes it; a later get is a 404 error', async () => {
    const temp = await toolJson<ShortUrlRecord>('create_short_url', {
      longUrl: `https://example.com/${stamp}-tmp`,
    })

    const message = await session.callTool('delete_short_url', { shortCode: temp.shortCode })
    expect(message.result?.isError).not.toBe(true)
    expect(resultText(message)).toContain(temp.shortCode)

    const gone = await toolError('get_short_url', { shortCode: temp.shortCode })
    expect(gone.isError).toBe(true)
    expect(gone.text).toContain('404 (short-url-not-found)')
  }, 30_000)

  test('error mapping: a wrong API key becomes the uniform Shlink error line', async () => {
    const failure = await toolError('list_short_urls', {}, { 'x-api-key': 'wrong-key-on-purpose' })

    expect(failure.isError).toBe(true)
    expect(failure.text).toContain('Shlink API error 401 (invalid-api-key)')
  })

  test('error mapping: an unknown short code becomes the 404 error line', async () => {
    const failure = await toolError('get_short_url', { shortCode: `${stamp}-missing` })

    expect(failure.isError).toBe(true)
    expect(failure.text).toContain('Shlink API error 404 (short-url-not-found)')
  })

  test('error mapping: renaming to an existing tag becomes the 409 error line', async () => {
    // Both tags exist (created with the primary), so the rename conflicts.
    const failure = await toolError('rename_tag', { oldName: tags.primaryA, newName: tags.primaryB })

    expect(failure.isError).toBe(true)
    expect(failure.text).toContain('Shlink API error 409 (tag-conflict)')
  })

  // Note: Shlink 5.1.7 exposes no reachable 400 invalid-data through this
  // tool surface — the schema-rejectable inputs never reach Shlink, and the
  // instance accepts everything else probes could throw at it (ftp:// and
  // mailto: long URLs, unknown domains, empty slugs; impossible datetimes
  // answer 500, an upstream validation gap). The problem+json invalidElements
  // formatting therefore stays specified at the unit tier, with the fake.
})
