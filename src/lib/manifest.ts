// Shared manifest helpers.
// Status must be derived from durable fields, not just the raw `status` string:
// - Published metadata means the post is posted even if a stale status remains.
// - `approved_at` means approved even if Vercel copied an older draft status into /tmp.

export type ManifestLikePost = {
  status?: string | null
  approved_at?: string | null
  posted_at?: string | null
  instagram_url?: string | null
  instagram_media_id?: string | null
}

export function normalizeStatus(post: ManifestLikePost): string {
  if (post.status === "posted" || post.posted_at || post.instagram_url || post.instagram_media_id) return "posted"
  if (post.approved_at) return "approved"
  return post.status || "draft"
}
