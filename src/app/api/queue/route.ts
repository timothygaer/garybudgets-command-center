// Serve the manifest file as the queue with image URLs and full post details
// Checks /tmp first (writable, has approval updates), falls back to repo copy
import { readFile, copyFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"

async function getManifestData() {
  let manifestPath = WRITABLE_PATH

  if (!existsSync(manifestPath)) {
    // Fall back to repo copy
    if (existsSync(SRC_PATH)) {
      await copyFile(SRC_PATH, manifestPath)
    } else {
      throw new Error("No manifest found")
    }
  }

  const content = await readFile(manifestPath, "utf-8")
  return JSON.parse(content)
}

export async function GET() {
  try {
    const manifest = await getManifestData()

    // Build slide previews using the public catbox URLs
    const postsWithPreviews = manifest.posts.map((post: any) => {
      const urls = post.image_urls || []
      const slidePreviews = (post.slides || []).map((slide: any, i: number) => ({
        slide: slide.slide,
        heading: slide.heading,
        prompt_summary: slide.prompt_summary,
        image_url: urls[i] || "",
        file_id: post.image_file_ids?.[i] || "",
      }))

      return {
        ...post,
        slidePreviews,
        image_file_ids: undefined,
        image_file_names: undefined,
        drive_assets_folder_id: undefined,
        drive_post_folder_id: undefined,
      }
    })

    return Response.json({
      queue: postsWithPreviews,
      week: manifest.week_start,
      week_folder_id: manifest.week_folder_id,
    })
  } catch {
    return Response.json({ queue: [], message: "Could not parse manifest" })
  }
}
