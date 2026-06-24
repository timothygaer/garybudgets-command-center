// API route for approving posts
// When a post is approved, this creates a cron job to publish at the scheduled time
import { readFile, writeFile } from "fs/promises"
import { existsSync, mkdirSync } from "fs"
import { join } from "path"
import { NextRequest, NextResponse } from "next/server"

const MANIFEST_PATH = "/tmp/gb-posts/manifest.json"

export async function POST(request: Request) {
  try {
    const { post_id } = await request.json()

    if (!post_id) {
      return NextResponse.json({ error: "post_id required" }, { status: 400 })
    }

    // Read current manifest
    if (!existsSync(MANIFEST_PATH)) {
      return NextResponse.json({ error: "No manifest found" }, { status: 404 })
    }

    const content = await readFile(MANIFEST_PATH, "utf-8")
    const manifest = JSON.parse(content)

    // Find the post
    const postIndex = manifest.posts.findIndex((p: any) => p.id === post_id)
    if (postIndex === -1) {
      return NextResponse.json({ error: `Post ${post_id} not found` }, { status: 404 })
    }

    const post = manifest.posts[postIndex]

    // Set approved status
    manifest.posts[postIndex].status = "approved"
    manifest.posts[postIndex].approved_at = new Date().toISOString()

    // Write back updated manifest
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

    return NextResponse.json({
      success: true,
      message: `"${post.title}" approved and scheduled`,
      post_id,
      scheduled_for: post.original_schedule,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
