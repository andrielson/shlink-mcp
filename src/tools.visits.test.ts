import { describe, expect, test } from 'bun:test'

import { missingCredentialsToolError } from './errors.ts'
import { fakeShlinkClient } from './testing/fake-shlink-client.ts'
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

describe('get_short_url_visits', () => {
  test('sends page as a number and injects the 50-per-page default', async () => {
    const { fake, result } = await call('get_short_url_visits', { shortCode: 'abc', page: 2 })

    await result
    expect(fake.calls).toEqual([
      {
        method: 'getShortUrlVisits',
        args: [
          { shortCode: 'abc' },
          {
            page: 2,
            itemsPerPage: 50,
          },
        ],
      },
    ])
  })

  test('honors an explicit itemsPerPage and passes the date range', async () => {
    const { fake, result } = await call('get_short_url_visits', {
      shortCode: 'abc',
      itemsPerPage: 200,
      startDate: '2026-01-01T00:00:00+00:00',
      endDate: '2026-01-31T23:59:59+00:00',
    })

    await result
    expect(fake.calls).toEqual([
      {
        method: 'getShortUrlVisits',
        args: [
          { shortCode: 'abc' },
          {
            itemsPerPage: 200,
            startDate: '2026-01-01T00:00:00+00:00',
            endDate: '2026-01-31T23:59:59+00:00',
          },
        ],
      },
    ])
  })

  test('sends excludeBots only when true', async () => {
    const omitted = await call('get_short_url_visits', { shortCode: 'abc' })
    await omitted.result
    expect(omitted.fake.calls[0]?.args[1]).not.toHaveProperty('excludeBots')

    const disabled = await call('get_short_url_visits', { shortCode: 'abc', excludeBots: false })
    await disabled.result
    expect(disabled.fake.calls[0]?.args[1]).not.toHaveProperty('excludeBots')

    const enabled = await call('get_short_url_visits', { shortCode: 'abc', excludeBots: true })
    await enabled.result
    expect(enabled.fake.calls[0]?.args[1]).toHaveProperty('excludeBots', true)
  })

  test('addresses a short code on another domain', async () => {
    const { fake, result } = await call('get_short_url_visits', { shortCode: 'abc', domain: 's.example.com' })

    await result
    expect(fake.calls[0]?.args[0]).toEqual({ shortCode: 'abc', domain: 's.example.com' })
  })
})

describe('get_tag_visits', () => {
  test('filters visits of one tag, passing the DEFAULT keyword through', async () => {
    const { fake, result } = await call('get_tag_visits', {
      tag: 'alpha',
      domain: 'DEFAULT',
      startDate: '2026-01-01T00:00:00+00:00',
    })

    await result
    expect(fake.calls).toEqual([
      {
        method: 'getTagVisits',
        args: [
          'alpha',
          {
            domain: 'DEFAULT',
            itemsPerPage: 50,
            startDate: '2026-01-01T00:00:00+00:00',
          },
        ],
      },
    ])
  })

  test('omits the domain when not given and caps pages at 200', async () => {
    const { fake, result } = await call('get_tag_visits', { tag: 'alpha', itemsPerPage: 200 })

    await result
    expect(fake.calls).toEqual([{ method: 'getTagVisits', args: ['alpha', { itemsPerPage: 200 }] }])
  })
})

describe('delete_short_url_visits', () => {
  test('deletes by identifier and returns the deletedVisits body', async () => {
    const { fake, result } = await call(
      'delete_short_url_visits',
      { shortCode: 'abc', domain: 's.example.com' },
      {
        deleteShortUrlVisits: { deletedVisits: 7 },
      },
    )

    const output = await result
    expect(fake.calls).toEqual([
      { method: 'deleteShortUrlVisits', args: [{ shortCode: 'abc', domain: 's.example.com' }] },
    ])
    expect(JSON.parse(output.content[0]?.text ?? '{}')).toEqual({ deletedVisits: 7 })
  })
})

describe('tool calls without credentials', () => {
  test('every visits tool answers the missing-credentials error without touching Shlink', async () => {
    for (const name of ['get_short_url_visits', 'get_tag_visits', 'delete_short_url_visits'] as const) {
      const output = await TOOLS[name].run({} as never, null)
      expect(output).toEqual(missingCredentialsToolError())
    }
  })
})
