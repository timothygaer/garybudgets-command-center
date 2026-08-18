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
const GITHUB_MANIFEST_URL = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"

function githubHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "garybudgets command-center",
  }
}

function requestOrigin(request: Request): string {
  const host = request.headers.get("host") || "garybudgets-command-center.vercel.app"
  const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp)(\?.*)?$/i.test(url)
}

function normalizeImageUrls(post: any, origin: string): string[] {
  if (!Array.isArray(post.image_urls)) return []

  return post.image_urls
    .filter((url: any) => typeof url === "string" && url.trim().length > 0)
    .map((url: string) => {
      try {
        return new URL(url, origin).toString()
      } catch {
        return ""
      }
    })
    .filter((url: string) => url.length > 0 && isImageUrl(url))
}

async function filterReachableImageUrls(imageUrls: string[]): Promise<string[]> {
  const checks = await Promise.all(imageUrls.map(async (url) => {
    try {
      const resp = await fetch(url, { method: "HEAD", cache: "no-store" })
      const contentType = resp.headers.get("content-type") || ""
      const contentLength = Number(resp.headers.get("content-length") || "0")
      return resp.ok && contentType.startsWith("image/") && contentLength > 500_000 ? url : ""
    } catch {
      return ""
    }
  }))
  return checks.filter(Boolean)
}

async function ensureWritableManifest(): Promise<{ manifest: any; path: string }> {
  const token = process.env.GITHUB_TOKEN
  if (token) {
    const resp = await fetch(GITHUB_MANIFEST_URL, { headers: githubHeaders(token), cache: "no-store" })
    if (resp.ok) {
      const fileData = await resp.json()
      const content = Buffer.from(fileData.content, "base64").toString("utf-8")
      return { manifest: JSON.parse(content), path: WRITABLE_PATH }
    }
    console.log(`GitHub manifest read failed: ${resp.status}; falling back to local manifest`)
  }

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

async function getUsableImageUrls(post: any, origin: string): Promise<string[]> {
  const imageUrls = normalizeImageUrls(post, origin)
  if (imageUrls.length === 0) return []

  // Vercel-hosted image URLs are the publish path. Accept both absolute URLs
  // and site-relative manifest paths such as /images/<post-id>/1.png, but only
  // after proving those URLs currently return real image bytes. Placeholder
  // manifest paths are not enough to approve a post.
  return filterReachableImageUrls(imageUrls)
}

/** For reel posts: the cover only needs to be a reachable image (any size — it's a thumbnail). */
async function getUsableCoverUrl(post: any, origin: string): Promise<string> {
  for (const url of normalizeImageUrls(post, origin)) {
    try {
      const resp = await fetch(url, { method: "HEAD", cache: "no-store" })
      const contentType = resp.headers.get("content-type") || ""
      if (resp.ok && contentType.startsWith("image/")) return url
    } catch { /* try next */ }
  }
  return ""
}

/** For reel posts: the publishable artifact is the video — require a real, sizable video URL. */
async function getUsableVideoUrl(post: any): Promise<string> {
  const url = post.video_url || ""
  if (!url) return ""
  try {
    const resp = await fetch(url, { method: "HEAD", cache: "no-store" })
    const contentType = resp.headers.get("content-type") || ""
    const contentLength = Number(resp.headers.get("content-length") || "0")
    return resp.ok && contentType.startsWith("video/") && contentLength > 500_000 ? url : ""
  } catch {
    return ""
  }
}

/**
 * Write approved_at back to the GitHub repo manifest via REST API.
 * This is the key piece: approval state goes into the source of truth,
 * so every future Vercel deploy includes it.
 */
async function writeApprovalToGitHub(postId: string, approvedAt: string, schedule: string | undefined, imageUrls: string[]): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.log("GitHub persist: no GITHUB_TOKEN set in Vercel env")
    return false
  }

  const url = GITHUB_MANIFEST_URL
  const headers = githubHeaders(token)

  try {
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      // Always read the latest GitHub manifest before writing. Vercel /tmp may
      // be stale, and concurrent jobs can update manifest.json between retries.
      const getResp = await fetch(url, { headers, cache: "no-store" })
      if (!getResp.ok) {
        console.log(`GitHub GET failed: ${getResp.status}`)
        return false
      }
      const fileData = await getResp.json()
      const currentSha = fileData.sha
      const currentContent = Buffer.from(fileData.content, "base64").toString("utf-8")
      const manifest = JSON.parse(currentContent)
      const idx = manifest.posts.findIndex((p: any) => p.id === postId)
      if (idx === -1) {
        console.log(`GitHub persist: ${postId} not found`)
        return false
      }

      manifest.posts[idx].status = "approved"
      manifest.posts[idx].approved_at = approvedAt
      if (schedule) manifest.posts[idx].proposed_schedule = schedule
      if (imageUrls.length > 0) {
        manifest.posts[idx].image_urls = imageUrls
        manifest.posts[idx].has_images = true
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
    const origin = requestOrigin(request)
    const usableImageUrls = await getUsableImageUrls(post, origin)
    const isReel = !!(post.video_url)
    const usableVideoUrl = isReel ? await getUsableVideoUrl(post) : ""
    const usableCoverUrl = isReel ? (await getUsableCoverUrl(post, origin)) || usableImageUrls[0] || "" : ""
    let schedule = post.proposed_schedule || post.original_schedule

    // ALWAYS assign the next available slot on approval, in the order posts are
    // approved. Drafts are no longer baked with a schedule at creation, and even if
    // a stale schedule exists, approval reassigns it so approval order drives the
    // calendar. Max 2/day Mon-Sat at 9:00 AM / 12:00 PM.
    {
      const now = new Date()
      // Find the next available Mon-Sat slot at 9:00 AM PT
      // Start looking from tomorrow
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)

      // Find a Mon-Sat day that doesn't already have 2 posts scheduled.
      // Only count APPROVED posts (those that actually occupy a real slot). Drafts
      // and ready posts carry placeholder/no schedules and get reassigned here on
      // approval, so they must not consume capacity.
      const allSchedules = manifest.posts
        .filter((p: any) => p.status === "approved" && (p.proposed_schedule || p.original_schedule))
        .map((p: any) => p.proposed_schedule || p.original_schedule)

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

      let slotFound = false
      for (let days = 1; days <= 14; days++) {
        const check = new Date(tomorrow)
        check.setDate(check.getDate() + days - 1)
        const dayOfWeek = check.getDay()
        // Skip Sunday (day 0)
        if (dayOfWeek === 0) continue

        // Count posts already on this day
        const dateStr = `${dayNames[dayOfWeek]}, ${monthNames[check.getMonth()]} ${check.getDate()}`
        const dayPostCount = allSchedules.filter((s: string) => s && s.startsWith(dateStr)).length

        // Max 2 posts per day
        if (dayPostCount < 2) {
          const hour = dayPostCount === 0 ? "9:00" : "12:00"
          schedule = `${dateStr} · ${hour} AM PT`
          slotFound = true
          break
        }
      }

      if (!slotFound) {
        schedule = `${dayNames[now.getDay()]}, ${monthNames[now.getMonth()]} ${now.getDate()} · 9:00 AM PT`
      }

      // Write the schedule back
      manifest.posts[postIndex].proposed_schedule = schedule
    }

    // Idempotency check via shared normalizer
    const effectiveStatus = normalizeStatus(post)
    if (effectiveStatus === "approved") {
      const approvedAt = post.approved_at || new Date().toISOString()
      manifest.posts[postIndex].status = "approved"
      manifest.posts[postIndex].approved_at = approvedAt
      manifest.posts[postIndex].stuck = false
      manifest.posts[postIndex].skipped = false
      if (usableImageUrls.length > 0) {
        manifest.posts[postIndex].image_urls = usableImageUrls
        manifest.posts[postIndex].has_images = true
      }
      await saveManifest(manifest, path)
      const githubOk = await writeApprovalToGitHub(post_id, approvedAt, schedule, usableImageUrls)
      if (!githubOk) {
        return Response.json({
          success: false,
          error: "Approval exists locally but could not be persisted to GitHub. Try again before relying on this post to publish.",
          post_id,
          scheduled_for: schedule,
          github_persisted: false,
        }, { status: 502 })
      }
      return Response.json({
        success: true,
        message: `"${post.title}" was already approved and scheduled for ${schedule}`,
        post_id,
        scheduled_for: schedule,
        already_approved: true,
        posted: false,
        github_persisted: true,
      })
    }

    // Gate: no publishable media = can't approve. Reels validate the VIDEO
    // (video_url reachable + real video bytes); carousels validate images.
    if (isReel) {
      if (!usableVideoUrl) {
        return Response.json({
          success: false,
          error: "Cannot approve — reel video is not reachable (video_url missing or not serving).",
          post_id,
          image_status: "awaiting_video",
        }, { status: 400 })
      }
      if (!usableCoverUrl) {
        return Response.json({
          success: false,
          error: "Cannot approve — reel cover image not found.",
          post_id,
          image_status: "awaiting_cover",
        }, { status: 400 })
      }
    } else if (usableImageUrls.length === 0) {
      return Response.json({
        success: false,
        error: "Cannot approve — no publishable images found.",
        post_id,
        image_status: "awaiting_images",
      }, { status: 400 })
    }

    // Mark as approved locally
    const approvedAt = new Date().toISOString()
    manifest.posts[postIndex].status = "approved"
    manifest.posts[postIndex].approved_at = approvedAt
    manifest.posts[postIndex].stuck = false
    manifest.posts[postIndex].skipped = false
    const persistedImageUrls = isReel
      ? (usableCoverUrl ? [usableCoverUrl] : usableImageUrls)
      : usableImageUrls
    if (persistedImageUrls.length > 0) {
      manifest.posts[postIndex].image_urls = persistedImageUrls
      manifest.posts[postIndex].has_images = true
    }
    await saveManifest(manifest, path)

    // Persist to GitHub repo — this is what survives deploys
    const githubOk = await writeApprovalToGitHub(post_id, approvedAt, schedule, persistedImageUrls)
    if (!githubOk) {
      return Response.json({
        success: false,
        error: "Approved locally, but GitHub persistence failed. The approval is not durable yet; try again before relying on this post to publish.",
        post_id,
        scheduled_for: schedule,
        posted: false,
        github_persisted: false,
      }, { status: 502 })
    }

    // Check for immediate publish
    const isImmediate = post.proposed_schedule === "Immediate on approval" ||
                        post.original_schedule === "Immediate on approval"

    if (isImmediate) {
      try {
        const publishUrl = `${origin}/api/publish`
        const publishResp = await fetch(publishUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caption: post.caption + "\n\n" + post.hashtags,
            image_urls: usableImageUrls,
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
      github_persisted: true,
    })

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
