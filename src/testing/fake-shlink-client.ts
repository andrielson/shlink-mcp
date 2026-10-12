// Unit-tier test double for the ShlinkApiClient contract type: records every
// call and resolves canned responses. The contract is structural, but the
// SDK's client class carries private state, so the double is cast into place
// once, here, rather than pretending to implement all ~20 methods inline.

import type { ShlinkApiClient } from '@shlinkio/shlink-js-sdk/api-contract'

export type RecordedCall = { method: string; args: unknown[] }

const REJECT = Symbol('rejectWith')
export type Rejection = { [REJECT]: unknown }
export const rejectWith = (error: unknown): Rejection => ({ [REJECT]: error })

export type FakeShlinkClient = {
  client: ShlinkApiClient
  calls: RecordedCall[]
}

export function fakeShlinkClient(responses: Record<string, unknown> = {}): FakeShlinkClient {
  const calls: RecordedCall[] = []

  const resolve = (outcome: unknown, fallback: unknown): Promise<unknown> => {
    if (outcome !== undefined && outcome !== null && typeof outcome === 'object' && REJECT in outcome) {
      return Promise.reject((outcome as Rejection)[REJECT])
    }
    return Promise.resolve(outcome !== undefined ? outcome : fallback)
  }

  const method = (name: string, fallback: unknown) => {
    const impl = (...args: unknown[]) => {
      calls.push({ method: name, args })
      return resolve(responses[name], fallback)
    }
    return impl
  }

  const client = {
    listShortUrls: method('listShortUrls', { data: [], pagination: { currentPage: 1, pagesCount: 1, totalItems: 0 } }),
    createShortUrl: method('createShortUrl', { shortCode: 'abc123', shortUrl: 'https://s.test/abc123' }),
    getShortUrl: method('getShortUrl', { shortCode: 'abc123', longUrl: 'https://example.com' }),
    updateShortUrl: method('updateShortUrl', { shortCode: 'abc123', longUrl: 'https://example.com' }),
    deleteShortUrl: method('deleteShortUrl', undefined),
    getShortUrlVisits: method('getShortUrlVisits', {
      data: [],
      pagination: { currentPage: 1, pagesCount: 1, totalItems: 0 },
    }),
    getTagVisits: method('getTagVisits', { data: [], pagination: { currentPage: 1, pagesCount: 1, totalItems: 0 } }),
    deleteShortUrlVisits: method('deleteShortUrlVisits', { deletedVisits: 0 }),
    listTags: method('listTags', { data: ['alpha'] }),
    tagsStats: method('tagsStats', {
      data: [{ tag: 'alpha', shortUrlsCount: 1, visitsSummary: { total: 0, nonBots: 0, bots: 0 } }],
    }),
    deleteTags: method('deleteTags', { tags: ['alpha'] }),
    editTag: method('editTag', { oldName: 'alpha', newName: 'beta' }),
  }

  return { client: client as unknown as ShlinkApiClient, calls }
}
