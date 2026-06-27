// API route: check if a post has images available
// Images are verified locally when uploaded to Drive and manifest is updated
// This endpoint just checks the manifest for image data
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const WRITABLE_PATH = "/tmp/gb-manifest.json"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const postId = url.searchParams.get("post_id")

    if (!postId) {
      return Response.json({ error: "post_id required" }, { status: 400 })
    }

    let manifestPath = WRITABLE_PATH
    if (!existsSync(manifestPath)) manifestPath = SRC_PATH
    if (!existsSync(manifestPath)) {
      return Response.json({ error: "No manifest" }, { status: 500 })
    }

    const content = await readFile(manifestPath, "utf-8")
    const manifest = JSON.parse(content)
    const post = manifest.posts?.find((p: any) => p.id === postId)

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 })
    }

    // Check if images exist — image_file_ids populated = images uploaded to Drive
    const hasImages = Array.isArray(post.image_file_ids) && post.image_file_ids.length > 0
    const imageCount = post.image_file_ids?.length || 0
    const expectedCount = post.slide_count || post.slides?.length || 0

    return Response.json({
      has_images: hasImages,
      image_count: imageCount,
      expected_count: expectedCount,
      file_names: post.image_file_names || [],
      // Status is "awaiting_images" if no images, "ready" if images exist
      image_status: hasImages ? "ready" : "awaiting_images",
    })
  } catch (err: any) {
    return Response.json({ error: err.message, has_images: false }, { status: 500 })
  }
}
