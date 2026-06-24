// Serve the manifest file as the queue with image URLs and full post details
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const VERIFIED_PATH = join(process.cwd(), "manifest.json")
const FALLBACK_PATH = "/tmp/gb-posts/manifest.json"

export async function GET() {
  let manifestPath = VERIFIED_PATH

  if (!existsSync(manifestPath)) {
    manifestPath = FALLBACK_PATH
  }

  if (!existsSync(manifestPath)) {
    return Response.json({
      queue: [],
      message: "No manifest found. Run weekly content generation first.",
    })
  }

  try {
    const content = await readFile(manifestPath, "utf-8")
    const manifest = JSON.parse(content)

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
        // Clean up internal fields
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
  } catch (err) {
    return Response.json({ queue: [], message: "Could not parse manifest" })
  }
}
