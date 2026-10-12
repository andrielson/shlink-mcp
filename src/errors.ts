// Shlink-error → MCP-error mapping. Shlink answers errors as RFC 7807
// problem+json bodies; the SDK's HTTP client rejects with the raw parsed body
// (not an Error), so everything here guards unknowns before reading them.

import type { ProblemDetailsError } from '@shlinkio/shlink-js-sdk/api-contract'

export const SHLINK_ERROR_TYPE_PREFIX = 'https://shlink.io/api/error/'

export function isProblemDetails(value: unknown): value is ProblemDetailsError {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.type === 'string' &&
    typeof v.title === 'string' &&
    typeof v.detail === 'string' &&
    typeof v.status === 'number'
  )
}

// The stable error code is the type URI's last path segment, e.g.
// https://shlink.io/api/error/invalid-api-key → invalid-api-key.
export function shlinkErrorCode(type: string): string {
  return type.startsWith(SHLINK_ERROR_TYPE_PREFIX) ? type.slice(SHLINK_ERROR_TYPE_PREFIX.length) : type
}

// The uniform error line frozen with the tool catalog: one shape for every
// Shlink API failure, so an agent can parse status, code and detail anywhere.
export function shlinkErrorLine(problem: ProblemDetailsError): string {
  const base = `Shlink API error ${problem.status} (${shlinkErrorCode(problem.type)}): ${problem.title} — ${problem.detail}`
  const invalidElements = (problem as { invalidElements?: unknown }).invalidElements
  const hasElements = Array.isArray(invalidElements) && invalidElements.length > 0
  return hasElements ? `${base} invalidElements: ${JSON.stringify(invalidElements)}` : base
}

// A Shlink problem+json body turned into a real Error. It keeps the problem
// fields (so isProblemDetails recognizes it) while gaining an Error identity
// for catch sites that instanceof-check (the credential probe).
export class ShlinkApiClientError extends Error {
  readonly type: string
  readonly title: string
  readonly detail: string
  readonly status: number

  constructor(problem: ProblemDetailsError) {
    super(shlinkErrorLine(problem))
    this.name = 'ShlinkApiClientError'
    this.type = problem.type
    this.title = problem.title
    this.detail = problem.detail
    this.status = problem.status
  }
}

export function toToolError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const text = isProblemDetails(error)
    ? shlinkErrorLine(error)
    : error instanceof Error
      ? `Could not talk to the Shlink server: ${error.message}`
      : `Unexpected error: ${String(error)}`
  return { content: [{ type: 'text', text }], isError: true }
}

export function missingCredentialsToolError(): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [
      {
        type: 'text',
        text: 'Missing X-Api-Key or X-Shlink-Server-Url header on the MCP request.',
      },
    ],
    isError: true,
  }
}

// The MCP server's own HTTP-edge errors, also problem+json (our namespace).
export function problemResponse(status: number, code: string, title: string, detail: string): Response {
  return Response.json({ type: `urn:shlink-mcp:error:${code}`, title, detail, status }, { status })
}
