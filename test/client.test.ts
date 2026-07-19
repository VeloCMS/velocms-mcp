import { describe, expect, it } from "vitest";
import { VeloCmsApiError, VeloCmsClient } from "../src/client.js";
import { createFakeFetch, emptyResponse, jsonResponse } from "./helpers.js";

describe("VeloCmsClient constructor", () => {
  it("throws a clear error when siteUrl is missing", () => {
    expect(() => new VeloCmsClient({ siteUrl: "", apiKey: "velo_x" })).toThrow(
      /siteUrl.*VELOCMS_SITE_URL/s,
    );
  });

  it("throws a clear error when apiKey is missing", () => {
    expect(
      () => new VeloCmsClient({ siteUrl: "https://example.velocms.org", apiKey: "" }),
    ).toThrow(/apiKey.*VELOCMS_API_KEY/s);
  });
});

describe("VeloCmsClient.request — request shape", () => {
  it("attaches Authorization: Bearer <apiKey> on every request", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ ok: true }));
    const client = new VeloCmsClient({
      siteUrl: "https://myblog.velocms.org",
      apiKey: "velo_secret123",
      fetchImpl,
    });

    await client.request("GET", "/posts");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.authorization).toBe("Bearer velo_secret123");
  });

  it("targets {siteUrl}/api/v1{path}, trims a trailing slash off siteUrl, and serializes query params", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ items: [] }));
    const client = new VeloCmsClient({
      siteUrl: "https://myblog.velocms.org/",
      apiKey: "velo_x",
      fetchImpl,
    });

    await client.request("GET", "/posts", { query: { page: 2, per_page: 10, status: "draft" } });

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      "https://myblog.velocms.org/api/v1/posts?page=2&per_page=10&status=draft",
    );
  });

  it("omits undefined query params entirely (does not send page=undefined)", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ items: [] }));
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    await client.request("GET", "/media", { query: { page: undefined, type: undefined } });

    expect(calls[0]?.url).toBe("https://x.velocms.org/api/v1/media");
  });

  it("sends a JSON-encoded body with Content-Type: application/json when a body is given", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ data: { id: "1" } }, { status: 201 }),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    await client.request("POST", "/posts", { body: { title: "Hello" } });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(calls[0]?.body).toBe(JSON.stringify({ title: "Hello" }));
  });

  it("sends no Content-Type header and no body for a bodyless GET", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ ok: true }));
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    await client.request("GET", "/site-settings");

    expect(calls[0]?.headers["content-type"]).toBeUndefined();
    expect(calls[0]?.body).toBeUndefined();
  });

  it("resolves undefined for a 204 No Content response (delete_post shape)", async () => {
    const { fetchImpl } = createFakeFetch(() => emptyResponse(204));
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const result = await client.request("DELETE", "/posts/abc123");
    expect(result).toBeUndefined();
  });
});

describe("VeloCmsClient.request — error mapping", () => {
  it("401 -> VeloCmsApiError(code=UNAUTHORIZED) with a VELOCMS_API_KEY hint", async () => {
    const { fetchImpl } = createFakeFetch(() =>
      jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header." } },
        { status: 401 },
      ),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "bad", fetchImpl });

    const caught: VeloCmsApiError = await client.request("GET", "/posts").catch((e: unknown) => e as VeloCmsApiError);

    expect(caught).toBeInstanceOf(VeloCmsApiError);
    expect(caught.code).toBe("UNAUTHORIZED");
    expect(caught.status).toBe(401);
    expect(caught.message).toMatch(/VELOCMS_API_KEY/);
  });

  it("403 PLAN_UPGRADE_REQUIRED -> message points at /admin/billing", async () => {
    const { fetchImpl } = createFakeFetch(() =>
      jsonResponse(
        {
          error: {
            code: "PLAN_UPGRADE_REQUIRED",
            message: "API access requires Pro or higher plan.",
          },
        },
        { status: 403 },
      ),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const caught: VeloCmsApiError = await client
      .request("GET", "/posts")
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught.code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(caught.status).toBe(403);
    expect(caught.message).toMatch(/admin\/billing/);
  });

  it("403 INVALID_SCOPE -> message points at the API key's scopes", async () => {
    const { fetchImpl } = createFakeFetch(() =>
      jsonResponse(
        { error: { code: "INVALID_SCOPE", message: "This endpoint requires posts:write." } },
        { status: 403 },
      ),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const caught: VeloCmsApiError = await client
      .request("POST", "/posts", { body: { title: "x" } })
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught.code).toBe("INVALID_SCOPE");
    expect(caught.message).toMatch(/scope/i);
  });

  it("429 RATE_LIMITED -> retryAfterSeconds parsed from the Retry-After header, surfaced in the message", async () => {
    const { fetchImpl } = createFakeFetch(() =>
      jsonResponse(
        { error: { code: "RATE_LIMITED", message: "Per-minute rate limit exceeded." } },
        { status: 429, headers: { "Retry-After": "42" } },
      ),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const caught: VeloCmsApiError = await client
      .request("GET", "/posts")
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught.code).toBe("RATE_LIMITED");
    expect(caught.status).toBe(429);
    expect(caught.retryAfterSeconds).toBe(42);
    expect(caught.message).toMatch(/Retry after 42 second/);
  });

  it("500 -> VeloCmsApiError(code=INTERNAL_ERROR), message preserved from the API body", async () => {
    const { fetchImpl } = createFakeFetch(() =>
      jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
        { status: 500 },
      ),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const caught: VeloCmsApiError = await client
      .request("GET", "/posts")
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught.code).toBe("INTERNAL_ERROR");
    expect(caught.status).toBe(500);
    expect(caught.message).toBe("Unexpected server error.");
  });

  it("a non-JSON / malformed error body still produces a VeloCmsApiError, never throws a raw parse error", async () => {
    const { fetchImpl } = createFakeFetch(
      () => new Response("<html>Internal Server Error</html>", { status: 500 }),
    );
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const caught: VeloCmsApiError = await client
      .request("GET", "/posts")
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught).toBeInstanceOf(VeloCmsApiError);
    expect(caught.status).toBe(500);
    expect(caught.code).toBe("UNKNOWN_ERROR");
  });

  it("times out and rejects with VeloCmsApiError when the request exceeds requestTimeoutMs", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as typeof fetch;

    const client = new VeloCmsClient({
      siteUrl: "https://x.velocms.org",
      apiKey: "k",
      fetchImpl,
      requestTimeoutMs: 10,
    });

    const caught: VeloCmsApiError = await client
      .request("GET", "/posts")
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught).toBeInstanceOf(VeloCmsApiError);
    expect(caught.message).toMatch(/timed out/);
  });

  it("a network failure (fetch rejects) becomes a VeloCmsApiError mentioning VELOCMS_SITE_URL", async () => {
    const fetchImpl = (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch;
    const client = new VeloCmsClient({ siteUrl: "https://x.velocms.org", apiKey: "k", fetchImpl });

    const caught: VeloCmsApiError = await client
      .request("GET", "/posts")
      .catch((e: unknown) => e as VeloCmsApiError);

    expect(caught).toBeInstanceOf(VeloCmsApiError);
    expect(caught.message).toMatch(/VELOCMS_SITE_URL/);
  });
});
