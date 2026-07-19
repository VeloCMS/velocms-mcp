/**
 * Response DTOs for the VeloCMS Public API (`/api/v1`), mirrored from
 * `public/openapi.yaml` in the main VeloCMS repository (components.schemas).
 * Kept intentionally close to the wire shape (snake_case field names) so a
 * tool's JSON output matches what `openapi.yaml` documents.
 */

export type PostStatus = "draft" | "published";

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  status: PostStatus;
  excerpt?: string | null;
  tags?: string[];
  published_at?: string | null;
  created: string;
  updated: string;
}

/** GET /api/v1/posts/{id} response shape (PostFull = PostSummary + body/SEO fields). */
export interface PostFull extends PostSummary {
  content_html?: string;
  content_json?: unknown;
  seo_title?: string | null;
  seo_description?: string | null;
}

/** Envelope every paginated list endpoint returns (openapi.yaml PaginatedMeta + items). */
export interface PaginatedList<T> {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  items: T[];
}

export interface MediaItem {
  id: string;
  filename: string;
  url: string;
  mime_type: string;
  size: number;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  created: string;
}

export type CommentStatus = "approved" | "pending" | "spam";

export interface CommentRecord {
  id: string;
  post_id: string;
  author_name: string;
  author_email?: string | null;
  body: string;
  parent_id?: string | null;
  status: CommentStatus;
  created: string;
  updated: string;
}

export type MemberTier = "free" | "paid";
export type MemberStatus = "active" | "cancelled" | "past_due";

export interface MemberSummary {
  id: string;
  /** Local part is masked by the API for privacy, e.g. `u***@example.com`. */
  email: string;
  tier: MemberTier;
  status: MemberStatus;
  created: string;
  updated: string;
}

export interface SiteSettings {
  id: string;
  tenant_id: string;
  site_name: string;
  site_description?: string | null;
  site_logo?: string | null;
  site_favicon?: string | null;
  members_enabled: boolean;
  comments_enabled: boolean;
  created: string;
  updated: string;
}

/** POST/PATCH endpoints that wrap their record in `{ "data": ... }`. */
export interface ApiEnvelope<T> {
  data: T;
}
