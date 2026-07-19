import { describe, expect, it } from "vitest";
import { VeloCmsApiError, VeloCmsClient } from "../src/client.js";
import { tools } from "../src/tools.js";
import { createFakeFetch, emptyResponse, jsonResponse } from "./helpers.js";

const EXPECTED_TOOL_NAMES = [
  "list_posts",
  "get_post",
  "create_post",
  "update_post",
  "delete_post",
  "publish_post",
  "unpublish_post",
  "list_media",
  "list_comments",
  "moderate_comment",
  "list_members",
  "get_site_settings",
];

function makeClient(fetchImpl: typeof fetch): VeloCmsClient {
  return new VeloCmsClient({
    siteUrl: "https://myblog.velocms.org",
    apiKey: "velo_test",
    fetchImpl,
  });
}

describe("tool registry", () => {
  it("exposes exactly the 12 documented tools, each with a title, description, and inputSchema", () => {
    expect(Object.keys(tools).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.title, `${name}.title`).toBeTruthy();
      expect(tool.description.length, `${name}.description`).toBeGreaterThan(20);
      expect(typeof tool.inputSchema, `${name}.inputSchema`).toBe("object");
      expect(typeof tool.handler, `${name}.handler`).toBe("function");
    }
  });
});

describe("list_posts", () => {
  it("GET /posts with page/per_page/status query params", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ page: 2, per_page: 5, total: 1, total_pages: 1, items: [] }),
    );
    await tools.list_posts!.handler(makeClient(fetchImpl), {
      page: 2,
      perPage: 5,
      status: "published",
    });

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      "https://myblog.velocms.org/api/v1/posts?page=2&per_page=5&status=published",
    );
  });

  it("propagates a VeloCmsApiError on a 500 (does not swallow errors)", async () => {
    const { fetchImpl } = createFakeFetch(() =>
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, { status: 500 }),
    );
    await expect(tools.list_posts!.handler(makeClient(fetchImpl), {})).rejects.toBeInstanceOf(
      VeloCmsApiError,
    );
  });
});

describe("get_post", () => {
  it("GET /posts/{id}, unwrapped response (not { data })", async () => {
    const post = { id: "abc123", title: "Hi", slug: "hi", status: "draft", created: "t", updated: "t" };
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse(post));

    const result = await tools.get_post!.handler(makeClient(fetchImpl), { id: "abc123" });

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/posts/abc123");
    expect(result).toEqual(post);
  });
});

describe("create_post", () => {
  it("POST /posts with the required title + only the optional fields provided (camelCase -> snake_case)", async () => {
    const created = { id: "new1", title: "Hello", slug: "hello", status: "published", created: "t", updated: "t" };
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ data: created }, { status: 201 }));

    const result = await tools.create_post!.handler(makeClient(fetchImpl), {
      title: "Hello",
      status: "published",
      tags: ["intro", "welcome"],
      seoTitle: "Hello — my blog",
    });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/posts");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      title: "Hello",
      status: "published",
      tags: ["intro", "welcome"],
      seo_title: "Hello — my blog",
    });
    expect(result).toEqual(created);
  });

  it("rejects (via Zod) a title over 255 chars before ever calling fetch", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ data: {} }, { status: 201 }));
    await expect(
      tools.create_post!.handler(makeClient(fetchImpl), { title: "x".repeat(256) }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("update_post", () => {
  it("PATCH /posts/{id} with only the changed fields, mapped to snake_case", async () => {
    const updated = { id: "abc", title: "New title", slug: "abc", status: "draft", created: "t", updated: "t2" };
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ data: updated }));

    const result = await tools.update_post!.handler(makeClient(fetchImpl), {
      id: "abc",
      title: "New title",
    });

    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/posts/abc");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ title: "New title" });
    expect(result).toEqual(updated);
  });

  it("refuses a no-op update (id only, nothing else) without calling fetch", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ data: {} }));
    await expect(
      tools.update_post!.handler(makeClient(fetchImpl), { id: "abc" }),
    ).rejects.toThrow(/at least one field/i);
    expect(calls).toHaveLength(0);
  });
});

describe("delete_post", () => {
  it("DELETE /posts/{id} -> { ok: true, id } on 204", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => emptyResponse(204));

    const result = await tools.delete_post!.handler(makeClient(fetchImpl), { id: "abc" });

    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/posts/abc");
    expect(result).toEqual({ ok: true, id: "abc" });
  });
});

describe("publish_post / unpublish_post", () => {
  it("publish_post sends PATCH { status: 'published' }", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ data: { id: "abc", status: "published" } }),
    );
    await tools.publish_post!.handler(makeClient(fetchImpl), { id: "abc" });

    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/posts/abc");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ status: "published" });
  });

  it("unpublish_post sends PATCH { status: 'draft' }", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ data: { id: "abc", status: "draft" } }),
    );
    await tools.unpublish_post!.handler(makeClient(fetchImpl), { id: "abc" });

    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ status: "draft" });
  });
});

describe("list_media", () => {
  it("GET /media with a type filter", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ page: 1, per_page: 20, total: 0, total_pages: 0, items: [] }),
    );
    await tools.list_media!.handler(makeClient(fetchImpl), { type: "image" });

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/media?type=image");
  });
});

describe("list_comments", () => {
  it("GET /comments with post_id + status query params (camelCase postId -> post_id)", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ page: 1, per_page: 20, total: 0, total_pages: 0, items: [] }),
    );
    await tools.list_comments!.handler(makeClient(fetchImpl), { postId: "p1", status: "pending" });

    expect(calls[0]?.url).toBe(
      "https://myblog.velocms.org/api/v1/comments?post_id=p1&status=pending",
    );
  });
});

describe("moderate_comment", () => {
  it("PATCH /comments/{id}/moderate with { status } body (field is 'status', not 'action')", async () => {
    const moderated = { id: "c1", post_id: "p1", author_name: "A", body: "b", status: "approved", created: "t", updated: "t" };
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ data: moderated }));

    const result = await tools.moderate_comment!.handler(makeClient(fetchImpl), {
      id: "c1",
      status: "approved",
    });

    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/comments/c1/moderate");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ status: "approved" });
    expect(result).toEqual(moderated);
  });

  it("rejects an invalid status value via Zod before calling fetch", async () => {
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse({ data: {} }));
    await expect(
      tools.moderate_comment!.handler(makeClient(fetchImpl), { id: "c1", status: "banana" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("list_members", () => {
  it("GET /members with a tier filter", async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      jsonResponse({ page: 1, per_page: 20, total: 0, total_pages: 0, items: [] }),
    );
    await tools.list_members!.handler(makeClient(fetchImpl), { tier: "paid" });

    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/members?tier=paid");
  });
});

describe("get_site_settings", () => {
  it("GET /site-settings, unwrapped response, no query params", async () => {
    const settings = {
      id: "s1",
      tenant_id: "t1",
      site_name: "My Blog",
      members_enabled: true,
      comments_enabled: true,
      created: "t",
      updated: "t",
    };
    const { fetchImpl, calls } = createFakeFetch(() => jsonResponse(settings));

    const result = await tools.get_site_settings!.handler(makeClient(fetchImpl), {});

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://myblog.velocms.org/api/v1/site-settings");
    expect(result).toEqual(settings);
  });
});
