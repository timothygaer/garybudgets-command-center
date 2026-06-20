import { uploadImageToHost, publishPost } from "@/lib/instagram"

export async function POST(request: Request) {
  try {
    const { caption, image_base64, filename } = await request.json()

    if (!image_base64) {
      return Response.json({ error: "Image data required" }, { status: 400 })
    }

    // Upload image to public host
    const imageUrl = await uploadImageToHost(image_base64, filename || "post.png")

    // Publish to Instagram
    const result = await publishPost(imageUrl, caption)

    if (result.error) {
      return Response.json({ error: result.error.message || "Publish failed", details: result.error }, { status: 400 })
    }

    return Response.json({ success: true, media_id: result.id, image_url: imageUrl })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
