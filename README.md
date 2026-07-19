# @velocms/mcp

An [MCP](https://modelcontextprotocol.io) server for [VeloCMS](https://velocms.org) —
draft, edit, publish, and manage your blog (posts, media, comments, members,
site settings) from Claude Code, Claude Desktop, Cursor, or any other MCP
client.

It's a thin, typed wrapper around the VeloCMS Public API
(`https://<your-blog>/api/v1`, documented at
[`/api/openapi`](https://velocms.org/api/openapi) on any VeloCMS site): every
tool maps to one real API call, with Zod-validated inputs and readable
errors — no scraping, no browser automation, just the platform's own
supported REST API.

## What it does

| Tool | What it does |
|---|---|
| `list_posts` | List posts, paginated, optionally filtered by status (`draft`/`published`) |
| `get_post` | Fetch a single post by ID, including its full content and SEO fields |
| `create_post` | Create a new post (defaults to `draft`) |
| `update_post` | Partially update an existing post — only the fields you pass change |
| `delete_post` | Permanently delete a post |
| `publish_post` | Set a post's status to `published` (stamps `published_at`) |
| `unpublish_post` | Set a post's status back to `draft` |
| `list_media` | List the media library, paginated, optionally filtered by MIME type |
| `list_comments` | List comments, paginated, optionally filtered by post or moderation status |
| `moderate_comment` | Set a comment's status to `approved`, `pending`, or `spam` |
| `list_members` | List subscribers/readers (emails are masked, e.g. `u***@example.com`) |
| `get_site_settings` | Read the blog's name, description, and feature flags |

Every tool ships a description an LLM can read to figure out when and how to
use it — that's the point of MCP, not just a REST proxy with extra steps.
See [Tool reference](#tool-reference) below for full argument lists.

## Setup

### 1. Get a VeloCMS API key

In your VeloCMS dashboard: **Settings → API Keys** → create a key with the
scopes you need (`posts:read`, `posts:write`, `media:read`, `comments:read`,
`comments:moderate`, `members:read`, `site-settings:read`, etc.). API access
requires the **Pro plan or higher**.

### 2. Configure your MCP client

You don't need to clone this repo — `npx` fetches and runs it on demand.

#### Claude Code

```bash
claude mcp add velocms \
  --env VELOCMS_SITE_URL=https://myblog.velocms.org \
  --env VELOCMS_API_KEY=velo_your_64_char_hex_key_here \
  -- npx -y -p @velocms/mcp velocms-mcp
```

MCP servers register their tools at session start, so restart your Claude
Code session after adding this.

#### Claude Desktop

Add to your `claude_desktop_config.json` (Settings → Developer → Edit
Config):

```json
{
  "mcpServers": {
    "velocms": {
      "command": "npx",
      "args": ["-y", "-p", "@velocms/mcp", "velocms-mcp"],
      "env": {
        "VELOCMS_SITE_URL": "https://myblog.velocms.org",
        "VELOCMS_API_KEY": "velo_your_64_char_hex_key_here"
      }
    }
  }
}
```

Restart Claude Desktop after editing.

#### Cursor / any other MCP client

Same shape as above — point the client's MCP config at
`npx -y -p @velocms/mcp velocms-mcp` with `VELOCMS_SITE_URL` and
`VELOCMS_API_KEY` set in its `env`. The server speaks standard MCP over
stdio, so any client that supports stdio MCP servers works.

### 3. Local install (contributing / running from source)

```bash
git clone https://github.com/VeloCMS/velocms-mcp.git
cd velocms-mcp
npm install
npm run build
cp .env.example .env
# edit .env and set VELOCMS_SITE_URL + VELOCMS_API_KEY
VELOCMS_SITE_URL=... VELOCMS_API_KEY=... node dist/index.js
```

## Config reference

| Env var | Required | Description |
|---|---|---|
| `VELOCMS_SITE_URL` | yes | Your blog's base URL — a `*.velocms.org` subdomain or a bound custom domain. No trailing slash needed. |
| `VELOCMS_API_KEY` | yes | An API key from `/admin/settings → API Keys`. Requires Pro plan or higher. Never logged. |

If either is missing, the server prints a clear message to stderr and exits
immediately (`process.exit(1)`) — it never starts half-configured.

## Tool reference

Argument names are camelCase; the server maps them to the API's snake_case
JSON fields for you.

**`list_posts`** — `page?`, `perPage?` (max 100), `status?` (`draft` |
`published`).

**`get_post`** — `id` (required).

**`create_post`** — `title` (required, ≤255 chars), `slug?`, `contentHtml?`,
`contentJson?` (TipTap ProseMirror document — prefer `contentHtml` unless
you need this), `excerpt?` (≤500), `status?` (`draft` default | `published`),
`tags?` (string array), `seoTitle?` (≤60), `seoDescription?` (≤160).

**`update_post`** — `id` (required) + any of the `create_post` fields
(all optional here). At least one field besides `id` is required — the tool
rejects a no-op call before making any network request.

**`delete_post`** — `id` (required). Permanent.

**`publish_post`** / **`unpublish_post`** — `id` (required). Shorthand for
`update_post({ status: "published" })` / `update_post({ status: "draft" })`.

**`list_media`** — `page?`, `perPage?`, `type?` (MIME type prefix, e.g.
`"image"`).

**`list_comments`** — `page?`, `perPage?`, `postId?`, `status?` (`approved`
| `pending` | `spam`).

**`moderate_comment`** — `id` (required), `status` (required: `approved` |
`pending` | `spam`).

**`list_members`** — `page?`, `perPage?`, `tier?` (`free` | `paid`).

**`get_site_settings`** — no arguments.

## Error handling model

The VeloCMS API returns a consistent JSON error envelope:

```json
{ "error": { "code": "RATE_LIMITED", "message": "...", "details": {} } }
```

This client surfaces that message directly (never a raw stack trace),
enriched with actionable hints:

- **401** (`UNAUTHORIZED`) — the message tells you to check `VELOCMS_API_KEY`.
- **403** (`PLAN_UPGRADE_REQUIRED`) — the message points at `/admin/billing`.
- **403** (`INVALID_SCOPE`/`FORBIDDEN`) — the message tells you to check the
  key's scopes.
- **429** (`RATE_LIMITED`) — the `Retry-After` response header (seconds) is
  parsed and included in the error message, and returned as
  `retryAfterSeconds` if you're calling the client library directly.
- **Any other non-2xx** — the API's own `code` + `message` are surfaced as-is.

Rate limits are plan-based (Pro: 30/min, 1,000/hr · Business: 120/min,
5,000/hr · Agency: 300/min, 20,000/hr) — this server does not retry
automatically; it fails fast with the wait time so an interactive tool call
never blocks silently.

## Security

- Your API key is a **tenant-scoped** credential — it can only reach the
  one blog it was issued for, and only the endpoints its scopes allow.
- The key is read once from the environment and never logged, echoed, or
  included in any tool output.
- Member emails returned by `list_members` are masked by the API itself
  (e.g. `u***@example.com`) — this server never sees or handles unmasked
  member PII.
- Encrypted tenant settings (Stripe keys, AI provider keys) are excluded
  from `get_site_settings` by the API — there is no way to read them
  through this server.

## Notes on this MCP server

- **`moderate_comment`'s body field is `status`, not `action`** —
  `PATCH /api/v1/comments/{id}/moderate` takes `{ "status": "approved" |
  "pending" | "spam" }` per the API's own schema, so the tool's input is
  named to match.
- **`get_post` and `get_site_settings` return the record directly** (not
  wrapped in `{ "data": ... }`) — only the write endpoints (`create_post`,
  `update_post`, `moderate_comment`) wrap their response, matching the API's
  own inconsistency here (documented in `openapi.yaml`).
- There is currently no `upload_media` tool — `POST /api/v1/media` takes
  `multipart/form-data`, which doesn't map cleanly onto typical MCP client
  transports. `list_media` is available for referencing media already
  uploaded through the dashboard. Contributions welcome if you need this.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test             # vitest — all tests run against a mocked fetch, no live API calls
npm run build        # emits dist/
```

The test suite covers: the `Authorization: Bearer` header on every request,
each tool's exact method/URL/body mapping, error-code mapping for
401/403/429/500 responses, and the missing-env-var fail-fast path. No test
in this repository makes a real network call.

## License

MIT — see [LICENSE](LICENSE).
