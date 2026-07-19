# Changelog


## 0.1.1 — 2026-07-19

- Add `mcpName` (org.velocms/mcp) for official MCP Registry verification. No functional changes.
All notable changes to this project are documented in this file.

## [0.1.0] - 2026-07-19

### Added

- Initial release.
- MCP stdio server exposing 12 tools against the VeloCMS Public API (`/api/v1`):
  `list_posts`, `get_post`, `create_post`, `update_post`, `delete_post`,
  `publish_post`, `unpublish_post`, `list_media`, `list_comments`,
  `moderate_comment`, `list_members`, `get_site_settings`.
- Zod-validated tool inputs, readable error messages (API error code + status +
  message, `Retry-After` surfaced on 429s).
- Config via `VELOCMS_SITE_URL` + `VELOCMS_API_KEY` environment variables.
