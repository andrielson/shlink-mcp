// The frozen tool catalog (see the wayfinder map): one fine-grained tool per
// Shlink operation. Each entry couples the public MCP surface (title,
// description, annotations, zod input schema) with the run function that maps
// parsed arguments onto one ShlinkApiClient call — that mapping, not the MCP
// wiring, is where the behavioral quirks live, so the run functions stay
// directly unit-testable behind a fake client.

import type { ToolAnnotations } from '@modelcontextprotocol/server'
import type { ShlinkApiClient, ShlinkShortUrlsListParams } from '@shlinkio/shlink-js-sdk/api-contract'
import { z } from 'zod'

import { missingCredentialsToolError, toToolError } from './errors.ts'

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: true }

export type ToolRunner<S extends z.ZodType> = (args: z.infer<S>, client: ShlinkApiClient | null) => Promise<ToolResult>

type ToolMeta = { title: string; description: string; annotations: ToolAnnotations }

export function defineTool<S extends z.ZodType>(meta: ToolMeta, inputSchema: S, run: ToolRunner<S>) {
  return { ...meta, inputSchema, run }
}

// ---------------------------------------------------------------------------
// Shared schema fragments (frozen catalog conventions)
// ---------------------------------------------------------------------------

// Read-only lookup: safe to auto-approve and to retry; every tool here talks
// to an external Shlink instance.
const READ_ONLY_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true }

// Shlink rejects offset-naive datetimes; date-only values are also accepted.
const ISO_8601_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/

const isoTimestamp = (what: string) =>
  z
    .string()
    .regex(ISO_8601_WITH_OFFSET, 'Must be ISO-8601 with a UTC offset, e.g. 2026-01-31 or 2026-01-31T12:00:00+00:00.')
    .describe(what)

const pageParam = z.number().int().min(1).optional().describe('Page number, starting at 1 (Shlink default: 1).')

const shortUrlsPerPageParam = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe('Page size (Shlink default: 10; this server caps at 200).')

const visitsPerPageParam = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe('Page size (this server defaults to 50 and caps at 200; Shlink itself would return every visit).')

// On short-code-scoped tools, `domain` disambiguates; on list/visit tools it
// filters — where the keyword DEFAULT selects the instance's default domain.
const domainDisambiguator = z
  .string()
  .optional()
  .describe('Domain authority the short code belongs under. Omit for the default domain.')

const domainFilter = z
  .string()
  .optional()
  .describe('Filter to one domain authority; the keyword DEFAULT selects the instance’s default domain.')

const ORDER_FIELDS = ['longUrl', 'shortCode', 'dateCreated', 'title', 'visits', 'nonBotVisits'] as const
const ORDER_DIRECTIONS = ['ASC', 'DESC'] as const
const orderByValues = ORDER_FIELDS.flatMap((field) => ORDER_DIRECTIONS.map((dir) => `${field}-${dir}`)) as [
  string,
  ...string[],
]

// The <field>-<direction> string is our tool surface; the SDK wants it split.
const orderByParam = (what: string) =>
  z.enum(orderByValues).optional().describe(`${what} as <field>-<direction>, e.g. visits-DESC.`)

function toOrderBy(value: string): { field: (typeof ORDER_FIELDS)[number]; dir: (typeof ORDER_DIRECTIONS)[number] } {
  const [field, dir] = value.split('-')
  return { field: field as (typeof ORDER_FIELDS)[number], dir: dir as (typeof ORDER_DIRECTIONS)[number] }
}

const excludeBotsParam = z
  .boolean()
  .optional()
  .describe('Exclude potential bot visits. Sent to Shlink only when true — any presence of the flag excludes bots.')

// Conditional spread: only parameters the caller set are sent, so Shlink's
// own defaults stay in charge of everything omitted.
const and = (condition: boolean, value: object | undefined) => (condition && value ? value : {})

// Raw SDK pass-through (frozen catalog: no reshaping, no field filtering).
function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

// ---------------------------------------------------------------------------
// Short URLs
// ---------------------------------------------------------------------------

export const TOOLS = {
  list_short_urls: defineTool(
    {
      title: 'List short URLs',
      description:
        'List short URLs on the configured Shlink instance with optional filtering, sorting and pagination. Returns the page of short URLs plus the pagination envelope (currentPage, pagesCount, totalItems).',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      page: pageParam,
      itemsPerPage: shortUrlsPerPageParam,
      searchTerm: z.string().optional().describe('Case-insensitive filter matching long URLs and short codes.'),
      tags: z.array(z.string()).optional().describe('Only short URLs carrying all/any of these tags (see tagsMode).'),
      tagsMode: z.enum(['any', 'all']).optional().describe('How to combine the tags filter (Shlink default: any).'),
      excludeTags: z.array(z.string()).optional().describe('Skip short URLs carrying these tags.'),
      excludeTagsMode: z
        .enum(['any', 'all'])
        .optional()
        .describe('How to combine the excluded tags (Shlink default: any).'),
      orderBy: orderByParam('Sort order'),
      startDate: isoTimestamp('Only short URLs created from this moment.').optional(),
      endDate: isoTimestamp('Only short URLs created up to this moment.').optional(),
      domain: domainFilter,
      excludeMaxVisitsReached: z.boolean().optional().describe('Skip short URLs whose visit quota is exhausted.'),
      excludePastValidUntil: z.boolean().optional().describe('Skip short URLs whose validity window has ended.'),
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        const params: ShlinkShortUrlsListParams = {
          ...and(args.page !== undefined, { page: String(args.page) }),
          ...and(args.itemsPerPage !== undefined, { itemsPerPage: args.itemsPerPage }),
          ...and(args.searchTerm !== undefined, { searchTerm: args.searchTerm }),
          ...and(args.tags !== undefined, { tags: args.tags }),
          ...and(args.tagsMode !== undefined, { tagsMode: args.tagsMode }),
          ...and(args.excludeTags !== undefined, { excludeTags: args.excludeTags }),
          ...and(args.excludeTagsMode !== undefined, { excludeTagsMode: args.excludeTagsMode }),
          ...(args.orderBy !== undefined ? { orderBy: toOrderBy(args.orderBy) } : {}),
          ...and(args.startDate !== undefined, { startDate: args.startDate }),
          ...and(args.endDate !== undefined, { endDate: args.endDate }),
          ...and(args.domain !== undefined, { domain: args.domain }),
          ...and(args.excludeMaxVisitsReached !== undefined, { excludeMaxVisitsReached: args.excludeMaxVisitsReached }),
          ...and(args.excludePastValidUntil !== undefined, { excludePastValidUntil: args.excludePastValidUntil }),
        }
        return jsonResult(await client.listShortUrls(params))
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  create_short_url: defineTool(
    {
      title: 'Create short URL',
      description:
        'Create a new short URL on the configured Shlink instance. Returns the resulting short URL object, including shortCode and shortUrl.',
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    z.object({
      longUrl: z.url().describe('The long URL to shorten.'),
      customSlug: z.string().optional().describe('Custom slug to serve as the short code instead of a generated one.'),
      shortCodeLength: z
        .number()
        .int()
        .min(4)
        .optional()
        .describe('Length of the generated short code (Shlink default: 5).'),
      findIfExists: z
        .boolean()
        .optional()
        .describe('Return an existing identical short URL instead of creating a duplicate.'),
      domain: z.string().optional().describe('Domain authority to create the short URL under.'),
      validSince: isoTimestamp('Moment from which the short URL starts working.').optional(),
      validUntil: isoTimestamp('Moment after which the short URL stops working.').optional(),
      maxVisits: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Maximum number of visits before the short URL stops working.'),
      tags: z.array(z.string()).optional().describe('Tags to attach.'),
      title: z.string().optional().describe('Descriptive title for the short URL.'),
      crawlable: z.boolean().optional().describe('Whether search engines are allowed to crawl it.'),
      forwardQuery: z.boolean().optional().describe('Whether the long URL receives the short URL’s query params.'),
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        const shortUrl = await client.createShortUrl({
          longUrl: args.longUrl,
          ...and(args.customSlug !== undefined, { customSlug: args.customSlug }),
          ...and(args.shortCodeLength !== undefined, { shortCodeLength: args.shortCodeLength }),
          ...and(args.findIfExists !== undefined, { findIfExists: args.findIfExists }),
          ...and(args.domain !== undefined, { domain: args.domain }),
          ...and(args.validSince !== undefined, { validSince: args.validSince }),
          ...and(args.validUntil !== undefined, { validUntil: args.validUntil }),
          ...and(args.maxVisits !== undefined, { maxVisits: args.maxVisits }),
          ...and(args.tags !== undefined, { tags: args.tags }),
          ...and(args.title !== undefined, { title: args.title }),
          ...and(args.crawlable !== undefined, { crawlable: args.crawlable }),
          ...and(args.forwardQuery !== undefined, { forwardQuery: args.forwardQuery }),
        })
        return jsonResult(shortUrl)
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  get_short_url: defineTool(
    {
      title: 'Get short URL',
      description:
        'Fetch a single short URL by short code. To find short URLs by long URL, tag or any other criterion, use list_short_urls.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      shortCode: z.string().describe('The short code to fetch.'),
      domain: domainDisambiguator,
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        return jsonResult(
          await client.getShortUrl({
            shortCode: args.shortCode,
            ...and(args.domain !== undefined, { domain: args.domain }),
          }),
        )
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  update_short_url: defineTool(
    {
      title: 'Update short URL',
      description:
        'Edit a short URL. Explicitly setting a nullable field to null clears it; omitting a field leaves it unchanged. longUrl can only be replaced, never cleared.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    z.object({
      shortCode: z.string().describe('The short code to edit.'),
      domain: domainDisambiguator,
      // Null-clears: explicit null clears a field, omission leaves it alone.
      longUrl: z.url().optional().describe('Replacement long URL (cannot be cleared, only replaced).'),
      title: z.string().nullable().optional().describe('New title; explicit null clears it, omit to leave unchanged.'),
      tags: z.array(z.string()).nullable().optional().describe('Replacement tag list; explicit null clears all tags.'),
      crawlable: z
        .boolean()
        .nullable()
        .optional()
        .describe('Search-engine crawlability; explicit null restores the default.'),
      forwardQuery: z
        .boolean()
        .nullable()
        .optional()
        .describe('Query-param forwarding; explicit null restores the default.'),
      validSince: isoTimestamp('New validity start; explicit null clears it, omit to leave unchanged.')
        .nullable()
        .optional(),
      validUntil: isoTimestamp('New validity end; explicit null clears it, omit to leave unchanged.')
        .nullable()
        .optional(),
      maxVisits: z
        .number()
        .int()
        .min(1)
        .nullable()
        .optional()
        .describe('New visit quota; explicit null clears it, omit to leave unchanged.'),
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        const shortUrl = await client.updateShortUrl(
          { shortCode: args.shortCode, ...and(args.domain !== undefined, { domain: args.domain }) },
          {
            ...and(args.longUrl !== undefined, { longUrl: args.longUrl }),
            ...and(args.title !== undefined, { title: args.title }),
            ...and(args.tags !== undefined, { tags: args.tags }),
            ...and(args.crawlable !== undefined, { crawlable: args.crawlable }),
            ...and(args.forwardQuery !== undefined, { forwardQuery: args.forwardQuery }),
            ...and(args.validSince !== undefined, { validSince: args.validSince }),
            ...and(args.validUntil !== undefined, { validUntil: args.validUntil }),
            ...and(args.maxVisits !== undefined, { maxVisits: args.maxVisits }),
          },
        )
        return jsonResult(shortUrl)
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  delete_short_url: defineTool(
    {
      title: 'Delete short URL',
      description:
        'Permanently delete a short URL and its visits. To keep the short URL and clear only its visits, use delete_short_url_visits.',
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    z.object({
      shortCode: z.string().describe('The short code to delete.'),
      domain: domainDisambiguator,
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        await client.deleteShortUrl({
          shortCode: args.shortCode,
          ...and(args.domain !== undefined, { domain: args.domain }),
        })
        return {
          content: [
            { type: 'text', text: `Deleted short URL ${args.domain ? `${args.domain}/` : ''}${args.shortCode}.` },
          ],
        }
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  // No listing parameters: the SDK's listTags sends none (verified against
  // 3.2.1 — same accepted-gap class as tagsStats), so Shlink returns every
  // tag with its pagination envelope.
  list_tags: defineTool(
    {
      title: 'List tags',
      description:
        'List every tag name on the configured Shlink instance, with its pagination envelope. For per-tag counts and visit totals, use get_tags_stats.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({}),
    async (_args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        return jsonResult(await client.listTags())
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  rename_tag: defineTool(
    {
      title: 'Rename tag',
      description:
        'Rename a tag on every short URL that carries it. Returns the applied renaming. Shlink answers 409 tag-conflict if the new name already exists.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    z.object({
      oldName: z.string().describe('The tag to rename.'),
      newName: z.string().describe('The new name.'),
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        return jsonResult(await client.editTag({ oldName: args.oldName, newName: args.newName }))
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  delete_tags: defineTool(
    {
      title: 'Delete tags',
      description: 'Delete one or more tags in bulk. Short URLs keep existing; they simply lose the deleted tags.',
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    z.object({
      tags: z.array(z.string()).min(1).describe('Tag names to delete (bulk; their short URLs stay).'),
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        return jsonResult(await client.deleteTags(args.tags))
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  get_tags_stats: defineTool(
    {
      title: 'Get tags stats',
      description:
        'Statistics for every tag: how many short URLs carry it and its visits summary (total, nonBots, bots).',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({}),
    async (_args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        return jsonResult(await client.tagsStats())
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  // -------------------------------------------------------------------------
  // Visits
  // ---------------------------------------------------------------------------

  // Visits endpoints default to returning EVERY item, so this server always
  // sends itemsPerPage (50 unless the caller chooses up to 200).
  get_short_url_visits: defineTool(
    {
      title: 'List short URL visits',
      description:
        'List the visits recorded for one short URL, with date filtering and pagination. For visits across every short URL carrying a tag, use get_tag_visits.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      shortCode: z.string().describe('The short code whose visits to list.'),
      domain: domainDisambiguator,
      startDate: isoTimestamp('Only visits from this moment.').optional(),
      endDate: isoTimestamp('Only visits up to this moment.').optional(),
      excludeBots: excludeBotsParam,
      page: pageParam,
      itemsPerPage: visitsPerPageParam,
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        const visits = await client.getShortUrlVisits(
          { shortCode: args.shortCode, ...and(args.domain !== undefined, { domain: args.domain }) },
          {
            ...and(args.page !== undefined, { page: args.page }),
            itemsPerPage: args.itemsPerPage ?? 50,
            ...and(args.startDate !== undefined, { startDate: args.startDate }),
            ...and(args.endDate !== undefined, { endDate: args.endDate }),
            ...and(args.excludeBots === true, { excludeBots: true }),
          },
        )
        return jsonResult(visits)
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  get_tag_visits: defineTool(
    {
      title: 'List tag visits',
      description:
        'List the visits recorded for all short URLs carrying a tag, with date filtering and pagination. For a single short URL’s visits, use get_short_url_visits.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    z.object({
      tag: z.string().describe('The tag whose short URLs’ visits to list.'),
      domain: domainFilter,
      startDate: isoTimestamp('Only visits from this moment.').optional(),
      endDate: isoTimestamp('Only visits up to this moment.').optional(),
      excludeBots: excludeBotsParam,
      page: pageParam,
      itemsPerPage: visitsPerPageParam,
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        const visits = await client.getTagVisits(args.tag, {
          ...and(args.domain !== undefined, { domain: args.domain }),
          ...and(args.page !== undefined, { page: args.page }),
          itemsPerPage: args.itemsPerPage ?? 50,
          ...and(args.startDate !== undefined, { startDate: args.startDate }),
          ...and(args.endDate !== undefined, { endDate: args.endDate }),
          ...and(args.excludeBots === true, { excludeBots: true }),
        })
        return jsonResult(visits)
      } catch (error) {
        return toToolError(error)
      }
    },
  ),

  delete_short_url_visits: defineTool(
    {
      title: 'Delete short URL visits',
      description:
        'Delete every visit recorded for one short URL. Returns the number of deleted visits; the short URL itself is kept — to remove it, use delete_short_url.',
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    z.object({
      shortCode: z.string().describe('The short code whose visits to delete.'),
      domain: domainDisambiguator,
    }),
    async (args, client) => {
      if (!client) return missingCredentialsToolError()
      try {
        return jsonResult(
          await client.deleteShortUrlVisits({
            shortCode: args.shortCode,
            ...and(args.domain !== undefined, { domain: args.domain }),
          }),
        )
      } catch (error) {
        return toToolError(error)
      }
    },
  ),
} as const
