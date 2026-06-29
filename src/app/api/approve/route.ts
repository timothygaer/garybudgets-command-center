// API route for approving posts
// Triggers publishing or scheduling based on the post's proposed_schedule
// Also writes approval state back to the GitHub repo manifest via REST API
// so approval survives Vercel cold-starts and new deploys.
import { readFile, writeFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { normalizeStatus } from "@/lib/manifest"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"

async function ensureWritableManifest(): Promise<{ manifest: any; path: string }> {
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

/**
 * Write approved_at back to the GitHub repo manifest via REST API.
 * This is the key piece: approval state goes into the source of truth,
 * so every future Vercel deploy includes it.
 */
async function writeApprovalToGitHub(postId: string, approvedAt: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.log("GitHub persist: no GITHUB_TOKEN set in Vercel env")
    return false
  }

  const url = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "garybudgets command-center",
  }

  try {
    // 1. Get current file and its SHA
    const getResp = await fetch(url, { headers })
    if (!getResp.ok) {
      console.log(`GitHub GET failed: ${getResp.status}`)
      return false
    }
    const fileData = await getResp.json()
    const sha = fileData.sha
    const currentContent = Buffer.from(fileData.content, "base64").toString("utf-8")
    const manifest = JSON.parse(currentContent)

    // 2. Update the post — with SHA conflict retry
    let attempts = 0
    const maxAttempts = 5
    let currentSha = sha
    
    while (attempts < maxAttempts) {
      // Re-read from GitHub on retry to get the fresh SHA
      if (attempts > 0) {
        const refreshResp = await fetch(url, { headers })
        if (!refreshResp.ok) break
        const freshData = await refreshResp.json()
        currentSha = freshData.sha
        const freshContent = Buffer.from(freshData.content, "base64").toString("utf-8")
        const freshManifest = JSON.parse(freshContent)
        const idx = freshManifest.posts.findIndex((p: any) => p.id === postId)
        if (idx === -1) break
        freshManifest.posts[idx].status = "approved"
        freshManifest.posts[idx].approved_at = approvedAt
        manifest.posts = freshManifest.posts
      }
      
      const newContent = JSON.stringify(manifest, null, 2) + "\n"
      const putResp = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `auto: approve ${postId}`,
          content: Buffer.from(newContent).toString("base64"),
          sha: currentSha,
        }),
      })
      
      if (putResp.ok) {
        console.log(`GitHub persist: ${postId} written (attempt ${attempts + 1})`)
        return true
      }
      
      const errText = await putResp.text()
      // Retry on stale SHA (422)
      if (putResp.status === 422 && errText.includes("sha")) {
        attempts++
        continue
      }
      console.log(`GitHub persist PUT failed (${putResp.status}): ${errText.slice(0, 200)}`)
      return false
    }
    console.log(`GitHub persist: ${postId} exhausted retries (${maxAttempts})`)
    return false
  } catch (err: any) {
    console.log(`GitHub persist fetch error: ${err.message}`)
    return false
  }
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

    // Idempotency check via shared normalizer
    const effectiveStatus = normalizeStatus(post)
    if (effectiveStatus === "approved") {
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

    // Gate: no images = can't approve
    const hasImages = Array.isArray(post.image_file_ids) && post.image_file_ids.length > 0
    if (!hasImages) {
      return Response.json({
        success: false,
        error: "Cannot approve — no images uploaded yet.",
        post_id,
        image_status: "awaiting_images",
      }, { status: 400 })
    }

    // Mark as approved locally
    const approvedAt = new Date().toISOString()
    manifest.posts[postIndex].status = "approved"
    manifest.posts[postIndex].approved_at = approvedAt
    await saveManifest(manifest, path)

    // Persist to GitHub repo — this is what survives deploys
    const githubOk = await writeApprovalToGitHub(post_id, approvedAt)

    // Check for immediate publish
    const isImmediate = post.proposed_schedule === "Immediate on approval" ||
                        post.original_schedule === "Immediate on approval"

    if (isImmediate) {
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

    return Response.json({
      success: true,
      message: `"${post.title}" approved and scheduled for ${schedule}`,
      post_id,
      scheduled_for: schedule,
      posted: false,
      github_persisted: githubOk,
    })

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
