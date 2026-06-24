// Serve the manifest file as the queue
import { readFile } from "fs/promises"
import { existsSync } from "fs"

const MANIFEST_PATH = "/Users/dit/workspace/garybudgets-command-center/manifest.json"
const FALLBACK_PATH = "/tmp/gb-posts/manifest.json"

export async function GET() {
  let manifestPath = MANIFEST_PATH

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

    // Add Drive thumbnail URLs for each image
    const postsWithPreviews = manifest.posts.map((post: any) => {
      const slidePreviews = post.image_file_ids.map((fileId: string, i: number) => {
        // Google Drive thumbnail URL format
        return {
          slide: i + 1,
          file_id: fileId,
          thumbnail: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
          name: post.image_file_names?.[i] || "",
          heading: post.slides?.[i]?.heading || `Slide ${i + 1}`,
        }
      })
      return {
        ...post,
        slidePreviews,
        // Remove raw file IDs from top level to avoid bloat
        image_file_ids: undefined,
        image_file_names: undefined,
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
