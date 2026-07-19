/**
 * Tool registry for velocms-mcp. Each entry is `{ title, description,
 * inputSchema, handler }`:
 *
 * - `inputSchema` is a Zod *raw shape* (a plain object of Zod schemas) —
 *   this is what `@modelcontextprotocol/sdk`'s `server.registerTool()`
 *   expects as its second argument's `inputSchema` field.
 * - `handler(client, rawArgs)` re-validates `rawArgs` against
 *   `z.object(shape)` internally (belt-and-suspenders: the MCP SDK already
 *   validates against `inputSchema` before calling the handler, but parsing
 *   again here gives every handler a precisely-typed `args` value without
 *   needing an `any` escape hatch at the registry boundary — and it means
 *   `handler` can be called directly and safely from tests/CLI code with a
 *   plain object).
 *
 * Every request/response shape below is taken from `public/openapi.yaml` in
 * the main VeloCMS repository (the canonical API contract) — see the
 * per-tool comments for the exact operationId + line references used.
 */

import { z } from "zod";
import { VeloCmsClient } from "./client.js";
import type {
  ApiEnvelope,
  CommentRecord,
  MediaItem,
  MemberSummary,
  PaginatedList,
  PostFull,
  PostStatus,
  PostSummary,
  SiteSettings,
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared arg pieces
// ---------------------------------------------------------------------------

const postStatusEnum = z.enum(["draft", "published"]);
const commentStatusEnum = z.enum(["approved", "pending", "spam"]);
const memberTierEnum = z.enum(["free", "paid"]);

const pageArg = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe("Page number (1-based). Default: 1.");

const perPageArg = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Records per page, max 100. Default: 20.");

export interface ToolEntry {
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (client: VeloCmsClient, rawArgs: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// list_posts — GET /api/v1/posts (openapi.yaml operationId: listPosts)
// ---------------------------------------------------------------------------

const listPostsShape = {
  page: pageArg,
  perPage: perPageArg,
  status: postStatusEnum.optional().describe("Filter by post status (draft or published)."),
};
const listPostsSchema = z.object(listPostsShape);

async function handleListPosts(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PaginatedList<PostSummary>> {
  const args = listPostsSchema.parse(rawArgs);
  return client.request<PaginatedList<PostSummary>>("GET", "/posts", {
    query: { page: args.page, per_page: args.perPage, status: args.status },
  });
}

// ---------------------------------------------------------------------------
// get_post — GET /api/v1/posts/{id} (operationId: getPost)
// Response is the PostFull record DIRECTLY (not wrapped in `data`) —
// see openapi.yaml lines ~836-842.
// ---------------------------------------------------------------------------

const getPostShape = {
  id: z.string().min(1).describe("PocketBase record ID of the post."),
};
const getPostSchema = z.object(getPostShape);

async function handleGetPost(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PostFull> {
  const args = getPostSchema.parse(rawArgs);
  return client.request<PostFull>("GET", `/posts/${encodeURIComponent(args.id)}`);
}

// ---------------------------------------------------------------------------
// create_post — POST /api/v1/posts (operationId: createPost)
// Body: CreatePostBody. Response: 201 { data: PostFull }.
// ---------------------------------------------------------------------------

const createPostShape = {
  title: z.string().min(1).max(255).describe("Post title. Required."),
  slug: z.string().min(1).max(255).optional().describe("Auto-generated from title if omitted."),
  contentHtml: z.string().optional().describe("Post body as HTML."),
  contentJson: z
    .unknown()
    .optional()
    .describe(
      "TipTap ProseMirror JSON document (arbitrary structure). Prefer contentHtml unless you " +
        "specifically need to write a ProseMirror document.",
    ),
  excerpt: z.string().max(500).optional(),
  status: postStatusEnum
    .optional()
    .describe(
      "draft (default) or published. Publishing here stamps published_at automatically — " +
        "or create as draft and call publish_post later.",
    ),
  tags: z.array(z.string()).optional(),
  seoTitle: z.string().max(60).optional().describe("SEO meta title, max 60 chars."),
  seoDescription: z.string().max(160).optional().describe("SEO meta description, max 160 chars."),
};
const createPostSchema = z.object(createPostShape);

async function handleCreatePost(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PostFull> {
  const args = createPostSchema.parse(rawArgs);
  const body: Record<string, unknown> = { title: args.title };
  if (args.slug !== undefined) body.slug = args.slug;
  if (args.contentHtml !== undefined) body.content_html = args.contentHtml;
  if (args.contentJson !== undefined) body.content_json = args.contentJson;
  if (args.excerpt !== undefined) body.excerpt = args.excerpt;
  if (args.status !== undefined) body.status = args.status;
  if (args.tags !== undefined) body.tags = args.tags;
  if (args.seoTitle !== undefined) body.seo_title = args.seoTitle;
  if (args.seoDescription !== undefined) body.seo_description = args.seoDescription;

  const response = await client.request<ApiEnvelope<PostFull>>("POST", "/posts", { body });
  return response.data;
}

// ---------------------------------------------------------------------------
// update_post — PATCH /api/v1/posts/{id} (operationId: updatePost)
// Body: PatchPostBody (all fields optional). Response: 200 { data: PostFull }.
// ---------------------------------------------------------------------------

const updatePostShape = {
  id: z.string().min(1).describe("PocketBase record ID of the post to update."),
  title: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
  contentHtml: z.string().optional(),
  contentJson: z.unknown().optional().describe("TipTap ProseMirror JSON document."),
  excerpt: z.string().max(500).optional(),
  status: postStatusEnum
    .optional()
    .describe(
      "draft or published. Transitioning draft -> published stamps published_at automatically. " +
        "Prefer publish_post/unpublish_post for a status-only change.",
    ),
  tags: z.array(z.string()).optional(),
  seoTitle: z.string().max(60).optional(),
  seoDescription: z.string().max(160).optional(),
};
const updatePostSchema = z.object(updatePostShape);

const UPDATE_POST_FIELD_KEYS = [
  "title",
  "slug",
  "contentHtml",
  "contentJson",
  "excerpt",
  "status",
  "tags",
  "seoTitle",
  "seoDescription",
] as const;

async function handleUpdatePost(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PostFull> {
  const args = updatePostSchema.parse(rawArgs);

  const body: Record<string, unknown> = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.slug !== undefined) body.slug = args.slug;
  if (args.contentHtml !== undefined) body.content_html = args.contentHtml;
  if (args.contentJson !== undefined) body.content_json = args.contentJson;
  if (args.excerpt !== undefined) body.excerpt = args.excerpt;
  if (args.status !== undefined) body.status = args.status;
  if (args.tags !== undefined) body.tags = args.tags;
  if (args.seoTitle !== undefined) body.seo_title = args.seoTitle;
  if (args.seoDescription !== undefined) body.seo_description = args.seoDescription;

  const hasAnyField = UPDATE_POST_FIELD_KEYS.some((key) => args[key] !== undefined);
  if (!hasAnyField) {
    throw new Error(
      "update_post: provide at least one field to change besides id (title, slug, contentHtml, " +
        "contentJson, excerpt, status, tags, seoTitle, seoDescription).",
    );
  }

  const response = await client.request<ApiEnvelope<PostFull>>(
    "PATCH",
    `/posts/${encodeURIComponent(args.id)}`,
    { body },
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// delete_post — DELETE /api/v1/posts/{id} (operationId: deletePost) -> 204
// ---------------------------------------------------------------------------

const deletePostShape = {
  id: z.string().min(1).describe("PocketBase record ID of the post to delete."),
};
const deletePostSchema = z.object(deletePostShape);

async function handleDeletePost(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<{ ok: true; id: string }> {
  const args = deletePostSchema.parse(rawArgs);
  await client.request<undefined>("DELETE", `/posts/${encodeURIComponent(args.id)}`);
  return { ok: true, id: args.id };
}

// ---------------------------------------------------------------------------
// publish_post / unpublish_post — both PATCH /api/v1/posts/{id} with a
// status-only body (openapi.yaml PatchPostBody.status). Kept as separate
// tools from update_post because "publish this" / "take this down" are the
// two most common single-purpose actions an agent performs.
// ---------------------------------------------------------------------------

const publishPostShape = {
  id: z.string().min(1).describe("PocketBase record ID of the post to publish."),
};
const publishPostSchema = z.object(publishPostShape);

async function setPostStatus(
  client: VeloCmsClient,
  id: string,
  status: PostStatus,
): Promise<PostFull> {
  const response = await client.request<ApiEnvelope<PostFull>>(
    "PATCH",
    `/posts/${encodeURIComponent(id)}`,
    { body: { status } },
  );
  return response.data;
}

async function handlePublishPost(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PostFull> {
  const args = publishPostSchema.parse(rawArgs);
  return setPostStatus(client, args.id, "published");
}

const unpublishPostShape = {
  id: z.string().min(1).describe("PocketBase record ID of the post to unpublish."),
};
const unpublishPostSchema = z.object(unpublishPostShape);

async function handleUnpublishPost(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PostFull> {
  const args = unpublishPostSchema.parse(rawArgs);
  return setPostStatus(client, args.id, "draft");
}

// ---------------------------------------------------------------------------
// list_media — GET /api/v1/media (operationId: listMedia)
// ---------------------------------------------------------------------------

const listMediaShape = {
  page: pageArg,
  perPage: perPageArg,
  type: z.string().optional().describe("Filter by MIME type prefix (e.g. 'image')."),
};
const listMediaSchema = z.object(listMediaShape);

async function handleListMedia(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PaginatedList<MediaItem>> {
  const args = listMediaSchema.parse(rawArgs);
  return client.request<PaginatedList<MediaItem>>("GET", "/media", {
    query: { page: args.page, per_page: args.perPage, type: args.type },
  });
}

// ---------------------------------------------------------------------------
// list_comments — GET /api/v1/comments (operationId: listComments)
// ---------------------------------------------------------------------------

const listCommentsShape = {
  page: pageArg,
  perPage: perPageArg,
  postId: z.string().optional().describe("Filter to comments on a specific post."),
  status: commentStatusEnum.optional().describe("Filter by moderation status."),
};
const listCommentsSchema = z.object(listCommentsShape);

async function handleListComments(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PaginatedList<CommentRecord>> {
  const args = listCommentsSchema.parse(rawArgs);
  return client.request<PaginatedList<CommentRecord>>("GET", "/comments", {
    query: { page: args.page, per_page: args.perPage, post_id: args.postId, status: args.status },
  });
}

// ---------------------------------------------------------------------------
// moderate_comment — PATCH /api/v1/comments/{id}/moderate
// (operationId: moderateComment). Body field is `status` per openapi.yaml
// lines ~1109-1115 (NOT "action" — see README "Notes on this MCP server").
// ---------------------------------------------------------------------------

const moderateCommentShape = {
  id: z.string().min(1).describe("PocketBase record ID of the comment to moderate."),
  status: commentStatusEnum.describe(
    "Moderation status to apply: approved, pending, or spam.",
  ),
};
const moderateCommentSchema = z.object(moderateCommentShape);

async function handleModerateComment(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<CommentRecord> {
  const args = moderateCommentSchema.parse(rawArgs);
  const response = await client.request<ApiEnvelope<CommentRecord>>(
    "PATCH",
    `/comments/${encodeURIComponent(args.id)}/moderate`,
    { body: { status: args.status } },
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// list_members — GET /api/v1/members (operationId: listMembers)
// Email local parts are masked by the API (e.g. u***@example.com) — this
// tool never sees or handles unmasked member emails.
// ---------------------------------------------------------------------------

const listMembersShape = {
  page: pageArg,
  perPage: perPageArg,
  tier: memberTierEnum.optional().describe("Filter by subscription tier (free or paid)."),
};
const listMembersSchema = z.object(listMembersShape);

async function handleListMembers(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<PaginatedList<MemberSummary>> {
  const args = listMembersSchema.parse(rawArgs);
  return client.request<PaginatedList<MemberSummary>>("GET", "/members", {
    query: { page: args.page, per_page: args.perPage, tier: args.tier },
  });
}

// ---------------------------------------------------------------------------
// get_site_settings — GET /api/v1/site-settings (operationId: getSiteSettings)
// Response is the SiteSettings record directly (not wrapped in `data`).
// Encrypted fields (member_stripe_*, ai_api_key) are excluded by the API.
// ---------------------------------------------------------------------------

const getSiteSettingsShape = {};
const getSiteSettingsSchema = z.object(getSiteSettingsShape);

async function handleGetSiteSettings(
  client: VeloCmsClient,
  rawArgs: Record<string, unknown>,
): Promise<SiteSettings> {
  getSiteSettingsSchema.parse(rawArgs);
  return client.request<SiteSettings>("GET", "/site-settings");
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const tools: Record<string, ToolEntry> = {
  list_posts: {
    title: "List posts",
    description:
      "Lists blog posts for the authenticated tenant, paginated (default 20/page, max 100). " +
      "Optionally filter by status (draft or published). Requires the posts:read API key scope.",
    inputSchema: listPostsShape,
    handler: handleListPosts,
  },
  get_post: {
    title: "Get a post",
    description:
      "Fetches a single post by its PocketBase record ID, including content_html/content_json " +
      "and SEO fields. Requires the posts:read scope.",
    inputSchema: getPostShape,
    handler: handleGetPost,
  },
  create_post: {
    title: "Create a post",
    description:
      "Creates a new blog post. Defaults to status=draft — pass status=published to publish " +
      "immediately (stamps published_at automatically), or create as a draft and call " +
      "publish_post once you're ready. Requires the posts:write scope.",
    inputSchema: createPostShape,
    handler: handleCreatePost,
  },
  update_post: {
    title: "Update a post",
    description:
      "Partially updates an existing post — only the fields you pass are changed. Requires at " +
      "least one field besides id. Requires the posts:write scope.",
    inputSchema: updatePostShape,
    handler: handleUpdatePost,
  },
  delete_post: {
    title: "Delete a post",
    description: "Permanently deletes a post by ID. Requires the posts:write scope.",
    inputSchema: deletePostShape,
    handler: handleDeletePost,
  },
  publish_post: {
    title: "Publish a post",
    description:
      "Sets a post's status to published (stamps published_at). Shorthand for " +
      "update_post({ status: 'published' }). Requires the posts:write scope.",
    inputSchema: publishPostShape,
    handler: handlePublishPost,
  },
  unpublish_post: {
    title: "Unpublish a post",
    description:
      "Sets a post's status back to draft, taking it off the public site. Shorthand for " +
      "update_post({ status: 'draft' }). Requires the posts:write scope.",
    inputSchema: unpublishPostShape,
    handler: handleUnpublishPost,
  },
  list_media: {
    title: "List media",
    description:
      "Lists items in the media library, paginated. Optionally filter by MIME type prefix " +
      "(e.g. 'image'). Requires the media:read scope.",
    inputSchema: listMediaShape,
    handler: handleListMedia,
  },
  list_comments: {
    title: "List comments",
    description:
      "Lists comments, paginated. Optionally filter to a specific post (postId) and/or by " +
      "moderation status (approved, pending, spam). Requires the comments:read scope.",
    inputSchema: listCommentsShape,
    handler: handleListComments,
  },
  moderate_comment: {
    title: "Moderate a comment",
    description:
      "Sets a comment's moderation status (approved, pending, or spam). Requires the " +
      "comments:moderate scope.",
    inputSchema: moderateCommentShape,
    handler: handleModerateComment,
  },
  list_members: {
    title: "List members",
    description:
      "Lists reader/subscriber records, paginated. Email local parts are masked by the API " +
      "(e.g. u***@example.com). Optionally filter by tier (free or paid). Requires the " +
      "members:read scope.",
    inputSchema: listMembersShape,
    handler: handleListMembers,
  },
  get_site_settings: {
    title: "Get site settings",
    description:
      "Fetches the tenant's site configuration (name, description, logo, favicon, " +
      "members/comments enabled flags). Encrypted fields (Stripe keys, AI API key) are always " +
      "excluded by the API. Requires the site-settings:read scope.",
    inputSchema: getSiteSettingsShape,
    handler: handleGetSiteSettings,
  },
};
