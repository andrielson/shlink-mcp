import { describe, expect, test } from 'bun:test'

import { TOOLS } from './tools.ts'

// The minimal-arguments contract: everything the catalog calls optional must
// actually parse as absent. Born from a smoke-run regression (date filters
// that were required instead of optional crashed every omitted-args call).

describe('input schemas accept their minimal arguments', () => {
  const minimalArgs: Record<keyof typeof TOOLS, unknown> = {
    list_short_urls: {},
    create_short_url: { longUrl: 'https://example.com' },
    get_short_url: { shortCode: 'abc' },
    update_short_url: { shortCode: 'abc' },
    delete_short_url: { shortCode: 'abc' },
    get_short_url_visits: { shortCode: 'abc' },
    list_tags: {},
    rename_tag: { oldName: 'a', newName: 'b' },
    delete_tags: { tags: ['a'] },
    get_tags_stats: {},
    get_tag_visits: { tag: 'a' },
    delete_short_url_visits: { shortCode: 'abc' },
  }

  for (const [name, args] of Object.entries(minimalArgs) as Array<[keyof typeof TOOLS, unknown]>) {
    test(`${name} parses ${JSON.stringify(args)}`, () => {
      const parsed = TOOLS[name].inputSchema.safeParse(args)
      expect(parsed.success).toBeTrue()
    })
  }
})

describe('input schemas reject out-of-contract values', () => {
  test('itemsPerPage above the 200 cap is rejected', () => {
    const parsed = TOOLS.list_short_urls.inputSchema.safeParse({ itemsPerPage: 201 })
    expect(parsed.success).toBeFalse()
  })

  test('offset-naive datetimes are rejected', () => {
    const parsed = TOOLS.get_short_url_visits.inputSchema.safeParse({
      shortCode: 'abc',
      startDate: '2026-01-01T00:00:00',
    })
    expect(parsed.success).toBeFalse()
  })

  test('an unknown orderBy combo is rejected', () => {
    const parsed = TOOLS.list_short_urls.inputSchema.safeParse({ orderBy: 'visits-SIDEWAYS' })
    expect(parsed.success).toBeFalse()
  })
})
