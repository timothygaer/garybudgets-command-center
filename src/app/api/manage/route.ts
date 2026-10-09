// API route for managing posts: change request, unapprove, delete
import { readFile, writeFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"
const CHANGE_REQUESTS_PATH = "/tmp/gb-change-requests.json"
const GITHUB_MANIFEST_API = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"

/**
 * The manifest to mutate. GitHub is the source of truth.
 *
 * This used to read /tmp (per-instance, evaporates) or the manifest bundled with
 * the deployment (which lags behind every commit the VM makes) and NEVER read
 * GitHub — then writeToGitHub PUT the result back with a freshly-fetched sha. So
 * Delete/Unapprove/Skip could not even find posts created after the last deploy,
 * and when it did find them it wrote a stale manifest over the live one, wiping
 * everything newer. Read GitHub first; fall back to the local copies only when
 * GitHub is unreachable.
 */
async function getManifest() {
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
        if (Array.isArray(manifest.posts)) {
          await writeFile(WRITABLE_PATH, JSON.stringify(manifest, null, 2))
          return { manifest, path: WRITABLE_PATH, sha: d.sha as string | undefined }
        }
      }
      console.log(`manage: GitHub manifest read failed (${resp.status}); using local copy`)
    } catch (err: any) {
      console.log(`manage: GitHub manifest read error (${err.message}); using local copy`)
    }
  }

  let path = WRITABLE_PATH
  if (!existsSync(path)) {
    if (existsSync(SRC_PATH)) await copyFile(SRC_PATH, path)
    else throw new Error("No manifest")
  }
  const content = await readFile(path, "utf-8")
  return { manifest: JSON.parse(content), path, sha: undefined as string | undefined }
}

async function saveManifest(manifest: any, path: string) {
  await writeFile(path, JSON.stringify(manifest, null, 2))
}

async function writeChangeRequest(postId: string, message: string) {
  let requests: any[] = []
  if (existsSync(CHANGE_REQUESTS_PATH)) {
    try { requests = JSON.parse(await readFile(CHANGE_REQUESTS_PATH, "utf-8")) } catch {}
  }
  requests.push({ post_id: postId, message, created_at: new Date().toISOString() })
  await writeFile(CHANGE_REQUESTS_PATH, JSON.stringify(requests, null, 2))
  
  // Also persist to GitHub via a dedicated file so it survives deploys
  await writeChangeRequestToGitHub(postId, message)
}

async function writeChangeRequestToGitHub(postId: string, message: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return false
  const url = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/change-requests.json"
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "gb" }
  try {
    let existing: any[] = []
    let sha: string | undefined
    // Try to read existing file
    const getResp = await fetch(url, { headers })
    if (getResp.ok) {
      const d = await getResp.json()
      sha = d.sha
      try { existing = JSON.parse(Buffer.from(d.content, "base64").toString("utf-8")) } catch {}
    }
    existing.push({ post_id: postId, message, created_at: new Date().toISOString() })
    const newContent = JSON.stringify(existing, null, 2) + "\n"
    const body: any = {
      message: `change request: ${postId}`,
      content: Buffer.from(newContent).toString("base64"),
    }
    if (sha) body.sha = sha
    const putResp = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) })
    return putResp.ok
  } catch { return false }
}

// Also persist unapprove/delete to GitHub so they survive deploys.
// `sha` is the blob sha of the manifest revision we actually based this change on.
// GitHub rejects the PUT if it no longer matches, so a concurrent write (e.g. the
// VM publishing a post) fails loudly instead of being silently overwritten.
async function writeToGitHub(manifest: any, sha?: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return false
  // No sha means we could not read GitHub and only had the stale local copy —
  // never push that over the live manifest.
  if (!sha) { console.log("manage: refusing to write manifest — no GitHub revision to base on"); return false }
  const url = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "gb" }
  try {
    const newContent = JSON.stringify(manifest, null, 2) + "\n"
    const putResp = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ message: "manage: post update", content: Buffer.from(newContent).toString("base64"), sha }) })
    if (!putResp.ok) console.log(`manage: manifest PUT failed (${putResp.status})`)
    return putResp.ok
  } catch { return false }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, post_id, message, posts } = body

    // research_add: adds posts directly to manifest (from Topic Scout)
    if (action === "research_add") {
      if (!posts || !Array.isArray(posts)) return Response.json({ error: "posts array required" }, { status: 400 })
      const { manifest, path, sha } = await getManifest()
      manifest.posts.push(...posts)
      await saveManifest(manifest, path)
      if (!(await writeToGitHub(manifest, sha))) return Response.json({ error: "Saved locally but could not be published to GitHub — nothing changed. Please retry." }, { status: 502 })
      return Response.json({ success: true, message: `${posts.length} posts added from Topic Scout`, count: posts.length })
    }

    if (!action || !post_id) return Response.json({ error: "action and post_id required" }, { status: 400 })

    const { manifest, path, sha } = await getManifest()
    const idx = manifest.posts.findIndex((p: any) => p.id === post_id)
    if (idx === -1) return Response.json({ error: `Post ${post_id} not found` }, { status: 404 })

    const post = manifest.posts[idx]

    switch (action) {
      case "change_request":
        await writeChangeRequest(post_id, message || "")
        return Response.json({ success: true, message: `Change request saved for "${post.title}"` })

      case "unapprove":
        if (post.status !== "approved") return Response.json({ error: "Post is not approved" }, { status: 400 })
        post.status = "draft"
        delete post.approved_at
        await saveManifest(manifest, path)
        if (!(await writeToGitHub(manifest, sha))) return Response.json({ error: "Change saved locally but could not be published to GitHub — nothing changed. Please retry." }, { status: 502 })
        return Response.json({ success: true, message: `"${post.title}" unapproved — back to draft` })

      case "skip":
        // Mark a stuck/stopped post as skipped so the publisher stops retrying it,
        // but keep it visible (red) in the calendar until the user fixes/re-approves.
        post.skipped = true
        post.stuck = false
        if (post.status === "approved") post.status = "approved"
        await saveManifest(manifest, path)
        if (!(await writeToGitHub(manifest, sha))) return Response.json({ error: "Change saved locally but could not be published to GitHub — nothing changed. Please retry." }, { status: 502 })
        return Response.json({ success: true, message: `"${post.title}" skipped — publisher will not retry it until you re-approve` })

      case "delete":
        manifest.posts.splice(idx, 1)
        await saveManifest(manifest, path)
        if (!(await writeToGitHub(manifest, sha))) return Response.json({ error: "Change saved locally but could not be published to GitHub — nothing changed. Please retry." }, { status: 502 })
        return Response.json({ success: true, message: `"${post.title}" deleted` })

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function GET() {
  const { readFile } = await import("fs/promises")
  const { existsSync } = await import("fs")
  const CHANGE_REQUESTS_PATH = "/tmp/gb-change-requests.json"
  if (!existsSync(CHANGE_REQUESTS_PATH)) {
    return Response.json({ requests: [] })
  }
  const content = await readFile(CHANGE_REQUESTS_PATH, "utf-8")
  return Response.json({ requests: JSON.parse(content) })
}
