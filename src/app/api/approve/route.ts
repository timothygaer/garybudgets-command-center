// API route for approving posts
// Triggers publishing or scheduling based on the post's proposed_schedule
import { readFile, writeFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"

async function ensureWritableManifest(): Promise<any> {
  if (existsSync(WRITABLE_PATH)) {
    const content = await readFile(WRITABLE_PATH, "utf-8")
    return { manifest: JSON.parse(content), path: WRITABLE_PATH }
  }
  if (existsSync(SRC_PATH)) {
    await copyFile(SRC_PATH, WRITABLE_PATH)
    const content = await readFile(WRITABLE_PATH, "utf-8")
    return { manifest: JSON.parse(content), path: WRITABLE_PATH }
  }
  throw new Error("No manifest.json found")
}

async function saveManifest(manifest: any, path: string) {
  await writeFile(path, JSON.stringify(manifest, null, 2))
}

export async function POST(request: Request) {
  try {
    const { post_id } = await request.json()
    if (!post_id) {
      return Response.json({ error: "post_id required" }, { status: 400 })
    }

    const { manifest, path } = await ensureWritableManifest()
    const postIndex = manifest.posts.findIndex((p: any) => p.id === post_id)
    if (postIndex === -1) {
      return Response.json({ error: `Post ${post_id} not found` }, { status: 404 })
    }

    const post = manifest.posts[postIndex]
    const schedule = post.proposed_schedule || post.original_schedule

    // Idempotency: if a post already has an approval timestamp, keep it approved and do not re-approve.
    // This prevents stale manifests from making previously-approved posts appear as approveable again.
    if (post.status === "approved" || (post.approved_at && post.status !== "posted")) {
      manifest.posts[postIndex].status = "approved"
      await saveManifest(manifest, path)
      return Response.json({
        success: true,
        message: `"${post.title}" was already approved and scheduled for ${schedule}`,
        post_id,
        scheduled_for: schedule,
        already_approved: true,
        posted: false,
      })
    }

    // Gate: do not approve if no images exist
    const hasImages = Array.isArray(post.image_file_ids) && post.image_file_ids.length > 0
    if (!hasImages) {
      return Response.json({
        success: false,
        error: "Cannot approve — no images uploaded yet. Generate images in ChatGPT and upload to the Google Drive Assets folder first.",
        post_id,
        image_status: "awaiting_images",
      }, { status: 400 })
    }

    // Mark as approved
    manifest.posts[postIndex].status = "approved"
    manifest.posts[postIndex].approved_at = new Date().toISOString()
    await saveManifest(manifest, path)

    // Check if this post is marked for immediate publish
    const isImmediate = post.proposed_schedule === "Immediate on approval" || 
                        post.original_schedule === "Immediate on approval"

    if (isImmediate) {
      // Post 1 - publish immediately via the publish API
      try {
        const publishUrl = `https://${request.headers.get("host") || "garybudgets-command-center.vercel.app"}/api/publish`
        const publishResp = await fetch(publishUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caption: post.caption + "\n\n" + post.hashtags,
            image_urls: post.image_urls,
            post_id: post.id,
          }),
        })
        const publishResult = await publishResp.json()
        
        if (publishResult.success || publishResult.media_id) {
          manifest.posts[postIndex].status = "posted"
          manifest.posts[postIndex].posted_at = new Date().toISOString()
          manifest.posts[postIndex].instagram_url = publishResult.permalink || `https://www.instagram.com/p/${publishResult.media_id}/`
          manifest.posts[postIndex].instagram_media_id = publishResult.media_id
          await saveManifest(manifest, path)
          
          return Response.json({
            success: true,
            message: `"${post.title}" posted immediately`,
            post_id,
            posted: true,
            instagram_url: manifest.posts[postIndex].instagram_url,
          })
        } else {
          return Response.json({
            success: true,
            message: `"${post.title}" approved but publish failed: ${publishResult.error || "unknown"}`,
            post_id,
          })
        }
      } catch (publishErr: any) {
        return Response.json({
          success: true,
          message: `"${post.title}" approved but publish call failed: ${publishErr.message}`,
          post_id,
        })
      }
    }

    // Scheduled post — just mark approved
    return Response.json({
      success: true,
      message: `"${post.title}" approved and scheduled for ${schedule}`,
      post_id,
      scheduled_for: schedule,
      posted: false,
    })

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
