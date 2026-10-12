// The Shlink client layer: one fresh client per MCP request, built from that
// request's credentials. The decorator wraps the SDK's HTTP client so every
// problem+json rejection becomes a typed ShlinkApiClientError instead of the
// SDK's raw parsed body (the gap found while choosing the client layer).

import type { HttpClient, RequestOptions } from '@shlinkio/shlink-js-sdk'
import { ShlinkApiClient } from '@shlinkio/shlink-js-sdk'
import type { ShlinkApiClient as ShlinkApiClientContract } from '@shlinkio/shlink-js-sdk/api-contract'
import { FetchHttpClient } from '@shlinkio/shlink-js-sdk/fetch'

import type { ShlinkCredentials } from './credentials.ts'
import { isProblemDetails, ShlinkApiClientError } from './errors.ts'

export type ClientFactory = (credentials: ShlinkCredentials) => ShlinkApiClientContract

async function rejectProblemDetailsAs<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw isProblemDetails(error) ? new ShlinkApiClientError(error) : error
  }
}

export function problemDetailsAsErrors(httpClient: HttpClient): HttpClient {
  return {
    jsonRequest: <T>(url: string, options?: RequestOptions) =>
      rejectProblemDetailsAs<T>(httpClient.jsonRequest<T>(url, options)),
    emptyRequest: (url: string, options?: RequestOptions) =>
      rejectProblemDetailsAs(httpClient.emptyRequest(url, options)),
  }
}

// Plain object allocation, no I/O: cheap enough to build one per request.
export const defaultClientFactory: ClientFactory = ({ apiKey, serverUrl }) =>
  new ShlinkApiClient(problemDetailsAsErrors(new FetchHttpClient()), { baseUrl: serverUrl, apiKey })
