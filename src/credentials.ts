// Per-request Shlink credentials: the target instance's own API key and base
// URL, carried on every MCP request so one deploy can serve any instance.

export type ShlinkCredentials = {
  apiKey: string
  serverUrl: string
}

// Header names are case-insensitive: Headers#get normalizes, so both the
// canonical X-Api-Key and any client-side lowercase variant match.
export function credentialsFrom(request: Request): ShlinkCredentials | null {
  const apiKey = request.headers.get('x-api-key')
  const serverUrl = request.headers.get('x-shlink-server-url')
  return apiKey && serverUrl ? { apiKey, serverUrl } : null
}
