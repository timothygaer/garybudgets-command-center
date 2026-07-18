// Serve the manifest file as the queue with image URLs and full post details
// Checks /tmp first (writable, has approval updates), falls back to repo copy
import { readFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { normalizeStatus } from "@/lib/manifest"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"
const GITHUB_MANIFEST_URL = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"

async function getGitHubManifest() {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null

  const resp = await fetch(GITHUB_MANIFEST_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "garybudgets command-center",
    },
    cache: "no-store",
  })
  if (!resp.ok) return null

  const fileData = await resp.json()
  const content = Buffer.from(fileData.content, "base64").toString("utf-8")
  return JSON.parse(content)
}

async function getManifestData() {
  const githubManifest = await getGitHubManifest()
  if (githubManifest) return githubManifest

  const writablePath = WRITABLE_PATH
  const srcPath = SRC_PATH

  // Always refresh writable copy from repo if repo is newer
  if (existsSync(srcPath)) {
    const srcTime = (await import("fs/promises")).stat(srcPath).then(s => s.mtimeMs).catch(() => 0)
    const wTime = existsSync(writablePath)
      ? (await import("fs/promises")).stat(writablePath).then(s => s.mtimeMs).catch(() => 0)
      : 0
    if ((await srcTime) > (await wTime)) {
      await copyFile(srcPath, writablePath)
    }
  } else if (!existsSync(writablePath)) {
    throw new Error("No manifest found")
  }

  const content = await readFile(writablePath, "utf-8")
  return JSON.parse(content)
}

export async function GET() {
  try {
    const manifest = await getManifestData()

    // Build slide previews using the Vercel-hosted image URLs
    const postsWithPreviews = manifest.posts.map((post: any) => {
      const normalizedStatus = normalizeStatus(post)
      const urls = post.image_urls || []
      const slidePreviews = (post.slides || []).map((slide: any, i: number) => ({ 
        slide: slide.slide,
        heading: slide.heading,
        prompt_summary: slide.prompt_summary,
        image_url: urls[i] || "",
        file_id: post.image_file_ids?.[i] || "",
      }))

      const hasPublicImages = urls.some((url: any) => typeof url === "string" && url.length > 0)
      const hasDriveImages = Array.isArray(post.image_file_ids) && post.image_file_ids.some((id: any) => typeof id === "string" && id.length > 0)

      return {
        ...post,
        status: normalizedStatus,
        slidePreviews,
        image_file_ids: undefined,
        image_file_names: undefined,
        drive_assets_folder_id: undefined,
        drive_post_folder_id: undefined,
        has_images: hasPublicImages || hasDriveImages,
      }
    })

    return Response.json({
      queue: postsWithPreviews.filter((post: any) => post.status !== "posted"),
      week: manifest.week_start,
      week_folder_id: manifest.week_folder_id,
    })
  } catch {
    return Response.json({ queue: [], message: "Could not parse manifest" })
  }
}
