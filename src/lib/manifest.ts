// Shared status normalization for manifests.
// A post with an approved_at timestamp should always be treated as approved,
// even if the repo manifest has stale status: "draft" from a git push.
// This protects against Vercel deploy → /tmp copy loss of approval state.

export function normalizeStatus(post: { status: string; approved_at?: string | null }): string {
  if (post.status === "posted") return "posted"
  if (post.approved_at) return "approved"
  return post.status
}
