/**
 * Shared mocked-fetch helpers for the test suite — no live network calls.
 */

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FakeFetch {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
}

/**
 * Builds a `typeof fetch`-compatible mock that records every call (method,
 * URL, headers, raw body string) and returns Response objects from a
 * provided factory. `responses` can be a single factory (reused for every
 * call) or a FIFO array of factories (one consumed per call, last one
 * repeats once exhausted).
 */
export function createFakeFetch(
  responses: (() => Response) | Array<() => Response>,
): FakeFetch {
  const calls: RecordedCall[] = [];
  const queue = Array.isArray(responses) ? [...responses] : undefined;
  const single = Array.isArray(responses) ? undefined : responses;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers as HeadersInit).forEach((value, key) => {
        headers[key] = value;
      });
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    const maker = (queue && queue.length > 1 ? queue.shift() : queue?.[0]) ?? single;
    if (!maker) {
      throw new Error("createFakeFetch: no response factory available for this call");
    }
    return maker();
  }) as typeof fetch;

  return { fetchImpl, calls };
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}
