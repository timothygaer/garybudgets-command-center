// API route: check if a post has images available
// Images are verified locally when uploaded to Drive and manifest is updated
// This endpoint just checks the manifest for image data
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const GITHUB_MANIFEST_API = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"

/**
 * Read the manifest from GitHub, which is the source of truth. The local copies
 * (/tmp, and the one bundled with the deployment) both lag behind it, so checking
 * images against them made a freshly-built post look like it was still
 * "awaiting_images" — which blocks approval. Read-only endpoint, no sha needed.
 */
async function readManifest(): Promise<any | null> {
  const token = process.env.GITHUB_TOKEN
  if (token) {
    try {
      const resp = await fetch(GITHUB_MANIFEST_API, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "gb" },
        cache: "no-store",
      })
      if (resp.ok) {
        const d = await resp.json()
        const manifest = JSON.parse(Buffer.from(d.content, "base64").toString("utf-8"))
        if (Array.isArray(manifest.posts)) return manifest
      }
    } catch { /* fall back to the local copies below */ }
  }
  for (const p of [join("/tmp", "gb-manifest.json"), SRC_PATH]) {
    if (existsSync(p)) {
      try { return JSON.parse(await readFile(p, "utf-8")) } catch { /* try the next one */ }
    }
  }
  return null
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const postId = url.searchParams.get("post_id")

    if (!postId) {
      return Response.json({ error: "post_id required" }, { status: 400 })
    }

    const manifest = await readManifest()
    if (!manifest) {
      return Response.json({ error: "No manifest" }, { status: 500 })
    }
    const post = manifest.posts?.find((p: any) => p.id === postId)

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 })
    }

    // Check if images exist — image_file_ids populated = images uploaded to Drive
    const hasImages = Array.isArray(post.image_file_ids) && post.image_file_ids.length > 0
    const imageCount = post.image_file_ids?.length || 0
    const expectedCount = post.slide_count || post.slides?.length || 0

    return Response.json({
      has_images: hasImages,
      image_count: imageCount,
      expected_count: expectedCount,
      file_names: post.image_file_names || [],
      // Status is "awaiting_images" if no images, "ready" if images exist
      image_status: hasImages ? "ready" : "awaiting_images",
    })
  } catch (err: any) {
    return Response.json({ error: err.message, has_images: false }, { status: 500 })
  }
}
