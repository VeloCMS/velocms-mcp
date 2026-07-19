---
name: velocms-publishing
description: Use this skill when the user wants to draft, edit, publish, or manage content on their VeloCMS blog through the velocms-mcp MCP server — creating or updating posts, attaching SEO metadata, moderating comments, or checking site settings/media/members. Trigger on requests like "draft a post about X and publish it to my blog", "update my VeloCMS post", "take that post down", or "moderate the pending comments".
---

# VeloCMS Publishing

Drives the `velocms-mcp` MCP server's tools against a VeloCMS blog's `/api/v1`
API. Requires the server to already be configured with `VELOCMS_SITE_URL`
(the tenant's blog URL) and `VELOCMS_API_KEY` (a Pro-plan-or-higher API key
from `/admin/settings -> API Keys`) — if tool calls fail with an
`UNAUTHORIZED` or missing-env error, tell the user to check that
configuration rather than guessing at a workaround.

## Draft -> review -> publish workflow

1. **Check for an existing post first** with `list_posts` (optionally
   `status: "draft"`) before creating a new one — avoid duplicate drafts for
   the same topic.
2. **Create the draft** with `create_post`. Always omit `status` or pass
   `status: "draft"` unless the user explicitly asked to publish
   immediately — a draft is safe to review and never appears on the live
   site. Write `contentHtml` (plain HTML) unless the user specifically wants
   a TipTap ProseMirror document (`contentJson`).
3. **Iterate** with `update_post`, passing only the fields that changed —
   it's a partial patch, not a full replace. Good candidates for a first
   pass: `excerpt` (shown in listings), `seoTitle` (<=60 chars), and
   `seoDescription` (<=160 chars) — these matter for how the post shows up
   in search results and social previews.
4. **Publish** with `publish_post` once the user confirms the draft looks
   right. This stamps `published_at` and makes the post live immediately —
   never call it without an explicit go-ahead from the user.
5. To retract a live post without deleting it, use `unpublish_post` (sets
   it back to draft). Use `delete_post` only when the user wants it gone
   permanently — it cannot be undone.

## Other tools

- `get_post` — fetch one post's full content (including `content_html`) by
  ID, e.g. before editing something you don't already have loaded.
- `list_media` — look up existing media library items (optionally filtered
  by MIME type prefix, e.g. `"image"`) to reference in post content; this
  server has no upload tool, so link to media the user has already
  uploaded through the dashboard.
- `list_comments` / `moderate_comment` — review pending comments and set
  their status to `approved`, `pending`, or `spam`.
- `list_members` — list subscribers (emails are masked, e.g.
  `u***@example.com`) for a quick audience snapshot; there is no tool to
  read a full unmasked email.
- `get_site_settings` — read the blog's name, description, and
  members/comments-enabled flags before writing content that assumes a
  particular site configuration.

## Handling errors

Every tool surfaces the VeloCMS API's own error code and message instead of
a raw stack trace:

- `UNAUTHORIZED` (401) — the API key is missing or invalid. Tell the user
  to check `VELOCMS_API_KEY`.
- `INVALID_SCOPE` / `FORBIDDEN` (403) — the key doesn't have the scope this
  action needs (e.g. a read-only key was used for `create_post`).
- `PLAN_UPGRADE_REQUIRED` (403) — the tenant's plan doesn't include API
  access; nothing to retry, tell the user they need to upgrade.
- `RATE_LIMITED` (429) — back off. The error includes how many seconds to
  wait before retrying.
- `VALIDATION_ERROR` (422) or a Zod error before the call is even made —
  re-check the field limits (title <=255 chars, excerpt <=500, seoTitle
  <=60, seoDescription <=160) and fix the input rather than retrying
  as-is.
