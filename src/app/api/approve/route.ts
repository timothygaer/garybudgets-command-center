// API route for approving posts
// Writes to /tmp/manifest.json (the only writable location on Vercel)
import { readFile, writeFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"

async function ensureWritableManifest(): Promise<string> {
  // If /tmp version exists, use it (it may have been updated by a previous approval)
  if (existsSync(WRITABLE_PATH)) {
    return WRITABLE_PATH
  }
  // Copy the git repo version to /tmp
  if (existsSync(SRC_PATH)) {
    await copyFile(SRC_PATH, WRITABLE_PATH)
    return WRITABLE_PATH
  }
  throw new Error("No manifest.json found in repo")
}

export async function POST(request: Request) {
  try {
    const { post_id } = await request.json()

    if (!post_id) {
      return Response.json({ error: "post_id required" }, { status: 400 })
    }

    const manifestPath = await ensureWritableManifest()
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

    // Write to writable /tmp
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    return Response.json({
      success: true,
      message: `"${post.title}" approved`,
      post_id,
      scheduled_for: post.proposed_schedule || post.original_schedule,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
