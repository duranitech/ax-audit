/**
 * Shared test helpers for creating mock contexts and fetch responses.
 */

/**
 * Create a mock FetchResponse.
 */
export function mockResponse(overrides = {}) {
  return {
    status: 200,
    headers: {},
    body: '',
    ok: true,
    url: '',
    ...overrides,
  };
}

/**
 * Create a mock CheckContext with a route-based fake fetch.
 *
 * A route value can be either a FetchResponse, or a function
 * `(url, fetchOptions) => FetchResponse` for tests that need to vary the
 * response by request headers (e.g. content negotiation on `Accept`).
 *
 * @param {Record<string, import('../dist/types.js').FetchResponse | Function>} routes - URL pattern to response (or responder) mapping
 * @param {object} options - Additional context options
 */
export function mockContext(routes = {}, options = {}) {
  return {
    url: options.url || 'https://example.com',
    html: options.html || '',
    headers: options.headers || {},
    fetch: async (url, fetchOptions) => {
      for (const [pattern, response] of Object.entries(routes)) {
        if (url.includes(pattern)) {
          return typeof response === 'function' ? response(url, fetchOptions) : response;
        }
      }
      return mockResponse({ status: 404, ok: false, body: '', url });
    },
  };
}
