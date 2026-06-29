// API route for managing posts: change request, unapprove, delete
import { readFile, writeFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"
const CHANGE_REQUESTS_PATH = "/tmp/gb-change-requests.json"

async function getManifest() {
  let path = WRITABLE_PATH
  if (!existsSync(path)) {
    if (existsSync(SRC_PATH)) await copyFile(SRC_PATH, path)
    else throw new Error("No manifest")
  }
  const content = await readFile(path, "utf-8")
  return { manifest: JSON.parse(content), path }
}

async function saveManifest(manifest: any, path: string) {
  await writeFile(path, JSON.stringify(manifest, null, 2))
}

async function writeChangeRequest(postId: string, message: string) {
  let requests: any[] = []
  if (existsSync(CHANGE_REQUESTS_PATH)) {
    const c = await readFile(CHANGE_REQUESTS_PATH, "utf-8")
    try { requests = JSON.parse(c) } catch {}
  }
  requests.push({ post_id: postId, message, created_at: new Date().toISOString() })
  await writeFile(CHANGE_REQUESTS_PATH, JSON.stringify(requests, null, 2))
}

// Also persist unapprove/delete to GitHub so they survive deploys
async function writeToGitHub(manifest: any): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return false
  const url = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "gb" }
  try {
    const getResp = await fetch(url, { headers })
    if (!getResp.ok) return false
    const fileData = await getResp.json()
    const newContent = JSON.stringify(manifest, null, 2) + "\n"
    const putResp = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ message: "manage: post update", content: Buffer.from(newContent).toString("base64"), sha: fileData.sha }) })
    return putResp.ok
  } catch { return false }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, post_id, message } = body
    if (!action || !post_id) return Response.json({ error: "action and post_id required" }, { status: 400 })

    const { manifest, path } = await getManifest()
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
        await writeToGitHub(manifest)
        return Response.json({ success: true, message: `"${post.title}" unapproved — back to draft` })

      case "delete":
        manifest.posts.splice(idx, 1)
        await saveManifest(manifest, path)
        await writeToGitHub(manifest)
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
