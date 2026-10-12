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

describe('list_tags', () => {
  test('calls listTags with no arguments (SDK 3.2.1 sends no listing params)', async () => {
    const { fake, result } = await call('list_tags', {})

    await result
    expect(fake.calls).toEqual([{ method: 'listTags', args: [] }])
  })

  test('passes the SDK result through as JSON text', async () => {
    const tags = { data: ['alpha', 'beta'], pagination: { currentPage: 1, pagesCount: 1, totalItems: 2 } }
    const { result } = await call('list_tags', {}, { listTags: tags })

    const output = await result
    expect(output.isError).toBeUndefined()
    expect(JSON.parse(output.content[0]?.text ?? '{}')).toEqual(tags)
  })
})

describe('rename_tag', () => {
  test('renames via the SDK editTag method', async () => {
    const { fake, result } = await call('rename_tag', { oldName: 'alpha', newName: 'beta' })

    await result
    expect(fake.calls).toEqual([{ method: 'editTag', args: [{ oldName: 'alpha', newName: 'beta' }] }])
  })

  test('returns the echoed renaming as JSON text', async () => {
    const { result } = await call('rename_tag', { oldName: 'alpha', newName: 'beta' })

    const output = await result
    expect(JSON.parse(output.content[0]?.text ?? '{}')).toEqual({ oldName: 'alpha', newName: 'beta' })
  })

  test('maps a tag-conflict rejection to the uniform error line', async () => {
    const { result } = await call(
      'rename_tag',
      { oldName: 'alpha', newName: 'beta' },
      {
        editTag: rejectWith({
          type: 'https://shlink.io/api/error/tag-conflict',
          title: 'Tag conflict',
          detail: 'A tag with name beta already exists',
          status: 409,
        }),
      },
    )

    const output = await result
    expect(output.isError).toBeTrue()
    expect(output.content[0]?.text).toBe(
      'Shlink API error 409 (tag-conflict): Tag conflict — A tag with name beta already exists',
    )
  })
})

describe('delete_tags', () => {
  test('deletes the whole array in one bulk call', async () => {
    const { fake, result } = await call('delete_tags', { tags: ['alpha', 'beta'] })

    await result
    expect(fake.calls).toEqual([{ method: 'deleteTags', args: [['alpha', 'beta']] }])
  })

  test('passes the SDK echo through as JSON text', async () => {
    const { result } = await call('delete_tags', { tags: ['alpha'] }, { deleteTags: { tags: ['alpha'] } })

    const output = await result
    expect(JSON.parse(output.content[0]?.text ?? '{}')).toEqual({ tags: ['alpha'] })
  })
})

describe('get_tags_stats', () => {
  test('calls tagsStats with no arguments', async () => {
    const { fake, result } = await call('get_tags_stats', {})

    await result
    expect(fake.calls).toEqual([{ method: 'tagsStats', args: [] }])
  })

  test('passes the stats list through as JSON text', async () => {
    const stats = { data: [{ tag: 'alpha', shortUrlsCount: 3, visitsSummary: { total: 12, nonBots: 10, bots: 2 } }] }
    const { result } = await call('get_tags_stats', {}, { tagsStats: stats })

    const output = await result
    expect(JSON.parse(output.content[0]?.text ?? '{}')).toEqual(stats)
  })
})

describe('tool calls without credentials', () => {
  test('every tag tool answers the missing-credentials error without touching Shlink', async () => {
    for (const name of ['list_tags', 'rename_tag', 'delete_tags', 'get_tags_stats'] as const) {
      const output = await TOOLS[name].run({} as never, null)
      expect(output).toEqual(missingCredentialsToolError())
    }
  })
})
