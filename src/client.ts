/**
 * Minimal REST client for the VeloCMS Public API (`public/openapi.yaml` in the
 * main VeloCMS repository is the source of truth for every shape used here).
 *
 * Auth: `Authorization: Bearer <api-key>` — verbatim format from
 * `src/lib/api/middleware.ts` `withApiAuth()` (missing/invalid header ->
 * `401 UNAUTHORIZED`; see that file's step 1).
 *
 * Base path: `${siteUrl}/api/v1`. Every endpoint requires a Pro-or-higher
 * plan and the scope listed for it in `openapi.yaml`.
 *
 * Error envelope (`openapi.yaml` `#/components/schemas/ApiError`):
 *
 *   { "error": { "code": "...", "message": "...", "details"?: {...} } }
 *
 * Rate limiting (`openapi.yaml` `#/components/responses/RateLimited`,
 * `middleware.ts` steps 4-5): a `429` response carries a `Retry-After` header
 * (seconds until the window resets). This client does not retry
 * automatically — it surfaces the wait time in the thrown error's message
 * and `retryAfterSeconds` so the calling agent can decide what to do next.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export interface VeloCmsClientOptions {
  /** Tenant site base URL, e.g. `https://myblog.velocms.org` or a bound custom domain. */
  siteUrl: string;
  /** API key from the VeloCMS admin → Settings → API Keys (format: `velo_<64-hex>`). */
  apiKey: string;
  /** Injectable fetch implementation — used by tests, defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 30s). */
  requestTimeoutMs?: number;
}

/** `openapi.yaml` `ApiError.error.code` enum, plus a local fallback for unrecognized/absent codes. */
export type VeloCmsApiErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_SCOPE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "PLAN_UPGRADE_REQUIRED"
  | "HTTPS_REQUIRED"
  | "UNKNOWN_ERROR";

interface VeloCmsApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

function isApiErrorBody(value: unknown): value is VeloCmsApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string";
}

/**
 * Thrown for every non-2xx response. Carries the API's own error code +
 * message (never a raw stack trace) plus the HTTP status and, on 429s, the
 * `Retry-After` value in seconds.
 */
export class VeloCmsApiError extends Error {
  readonly code: VeloCmsApiErrorCode;
  readonly status: number | null;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    opts: {
      code?: VeloCmsApiErrorCode;
      status?: number | null;
      details?: Record<string, unknown>;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "VeloCmsApiError";
    this.code = opts.code ?? "UNKNOWN_ERROR";
    this.status = opts.status ?? null;
    this.details = opts.details;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined>;
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export class VeloCmsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(opts: VeloCmsClientOptions) {
    if (!opts.siteUrl) {
      throw new Error(
        "VeloCmsClient requires siteUrl (e.g. https://myblog.velocms.org). Set VELOCMS_SITE_URL.",
      );
    }
    if (!opts.apiKey) {
      throw new Error(
        "VeloCmsClient requires apiKey. Get one from your VeloCMS dashboard: " +
          "/admin/settings -> API Keys (Pro plan or higher required). Set VELOCMS_API_KEY.",
      );
    }
    this.baseUrl = opts.siteUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Sends one request against `${siteUrl}/api/v1${path}`. Resolves with the
   * parsed JSON body on 2xx (or `undefined` for a 204), throws
   * `VeloCmsApiError` on any non-2xx response or network failure/timeout.
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    opts: { query?: QueryParams; body?: unknown } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new VeloCmsApiError(
          `Request to ${path} timed out after ${this.requestTimeoutMs}ms.`,
          { code: "INTERNAL_ERROR" },
        );
      }
      throw new VeloCmsApiError(
        `Network error calling the VeloCMS API (${path}): ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          "Check that VELOCMS_SITE_URL is correct and reachable.",
        { code: "INTERNAL_ERROR" },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const rawText = await response.text();
    let json: unknown;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      throw this.buildError(response, json, path);
    }

    return json as T;
  }

  private buildError(response: Response, json: unknown, path: string): VeloCmsApiError {
    const body = isApiErrorBody(json) ? json : undefined;
    const code = (body?.error.code as VeloCmsApiErrorCode | undefined) ?? "UNKNOWN_ERROR";
    let message = body?.error.message ?? `VeloCMS API returned HTTP ${response.status} for ${path}.`;
    const details = body?.error.details;

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterParsed = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
    const retryAfterSeconds = Number.isFinite(retryAfterParsed) ? retryAfterParsed : undefined;

    if (response.status === 401) {
      message +=
        " Check that VELOCMS_API_KEY is set and valid (get one from /admin/settings -> API Keys).";
    } else if (response.status === 403) {
      message +=
        code === "PLAN_UPGRADE_REQUIRED"
          ? " The VeloCMS Public API requires a Pro plan or higher — upgrade at /admin/billing."
          : " Check that VELOCMS_API_KEY has the scope required for this operation.";
    } else if (response.status === 429 && retryAfterSeconds !== undefined) {
      message += ` Retry after ${retryAfterSeconds} second(s).`;
    }

    return new VeloCmsApiError(message, {
      code,
      status: response.status,
      details,
      retryAfterSeconds,
    });
  }
}
