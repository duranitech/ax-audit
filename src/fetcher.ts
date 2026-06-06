import { USER_AGENT } from './constants.js';
import type { FetchOptions, FetchResponse } from './types.js';

interface FetcherOptions {
  timeout?: number;
  verbose?: boolean;
  /** Number of retry attempts for transient failures (timeouts, 5xx, network errors). Default 2. */
  retries?: number;
  /** Base delay in ms for exponential backoff between retries. Default 250. */
  retryBaseDelay?: number;
}

/** Transient HTTP status codes worth retrying. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Fetcher {
  fetch: (url: string, options?: FetchOptions) => Promise<FetchResponse>;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html, application/json, text/plain, */*',
};

/**
 * Merge per-request headers over the fetcher defaults, case-insensitively.
 * A custom `accept` header therefore replaces the default `Accept` instead
 * of being sent alongside it.
 */
function mergeHeaders(custom?: Record<string, string>): Record<string, string> {
  if (!custom) return { ...DEFAULT_HEADERS };
  const merged: Record<string, string> = { ...DEFAULT_HEADERS };
  for (const [name, value] of Object.entries(custom)) {
    const existing = Object.keys(merged).find((k) => k.toLowerCase() === name.toLowerCase());
    if (existing) delete merged[existing];
    merged[name] = value;
  }
  return merged;
}

/**
 * Build a deterministic cache key for a URL + header combination. Headers are
 * lowercased and sorted so logically identical requests share one cache entry,
 * while requests that differ only in headers (e.g. `Accept: text/markdown`)
 * are cached separately — mirroring how `Vary: Accept` works on the wire.
 */
function cacheKey(url: string, options?: FetchOptions): string {
  if (!options?.headers || Object.keys(options.headers).length === 0) return url;
  const normalized = Object.entries(options.headers)
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${url}\u0000${JSON.stringify(normalized)}`;
}

export function createFetcher({
  timeout = 10000,
  verbose = false,
  retries = 2,
  retryBaseDelay = 250,
}: FetcherOptions = {}): Fetcher {
  const cache = new Map<string, FetchResponse>();
  const log = verbose ? (msg: string) => console.error(`  [verbose] ${msg}`) : () => {};

  /** A single fetch attempt. Never throws — failures become a status-0 result. */
  async function attempt(url: string, options?: FetchOptions): Promise<FetchResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: mergeHeaders(options?.headers),
        redirect: 'follow',
      });

      const body = await response.text();

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      log(`  ${response.status} ${response.statusText} (${body.length} bytes)`);
      return { status: response.status, headers, body, ok: response.ok, url: response.url };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorMsg = error.name === 'AbortError' ? 'Request timed out' : error.message;
      log(`  ERROR: ${errorMsg}`);
      return { status: 0, headers: {}, body: '', ok: false, url, error: errorMsg };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchUrl(url: string, options?: FetchOptions): Promise<FetchResponse> {
    const key = cacheKey(url, options);
    if (cache.has(key)) {
      log(`cache hit: ${url}`);
      return cache.get(key)!;
    }
    log(`fetch: ${url}`);

    let result = await attempt(url, options);

    // Retry transient failures with exponential backoff. A successful response
    // (even a 4xx that isn't in the retry set) short-circuits immediately.
    for (let i = 0; i < retries; i++) {
      const transient = result.status === 0 || RETRYABLE_STATUS.has(result.status);
      if (!transient) break;
      const delay = retryBaseDelay * 2 ** i;
      log(`  retry ${i + 1}/${retries} after ${delay}ms (status ${result.status})`);
      await sleep(delay);
      result = await attempt(url, options);
    }

    cache.set(key, result);
    return result;
  }

  return { fetch: fetchUrl };
}
