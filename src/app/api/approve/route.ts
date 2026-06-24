// API route for approving posts
// When a post is approved, this marks it in the manifest
import { readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const VERIFIED_PATH = join(process.cwd(), "manifest.json")
const FALLBACK_PATH = "/tmp/gb-posts/manifest.json"

function getManifestPath() {
  if (existsSync(VERIFIED_PATH)) return VERIFIED_PATH
  if (existsSync(FALLBACK_PATH)) return FALLBACK_PATH
  return null
}

export async function POST(request: Request) {
  try {
    const { post_id } = await request.json()

    if (!post_id) {
      return Response.json({ error: "post_id required" }, { status: 400 })
    }

    const manifestPath = getManifestPath()
    if (!manifestPath) {
      return Response.json({ error: "No manifest found" }, { status: 404 })
    }

    const content = await readFile(manifestPath, "utf-8")
    const manifest = JSON.parse(content)

    // Find the post
    const postIndex = manifest.posts.findIndex((p: any) => p.id === post_id)
    if (postIndex === -1) {
      return Response.json({ error: `Post ${post_id} not found` }, { status: 404 })
    }

    const post = manifest.posts[postIndex]

    // Set approved status
    manifest.posts[postIndex].status = "approved"
    manifest.posts[postIndex].approved_at = new Date().toISOString()

    // Write back
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    return Response.json({
      success: true,
      message: `"${post.title}" approved`,
      post_id,
      scheduled_for: post.original_schedule,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
