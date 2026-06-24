import { uploadImageToHost, publishPost } from "@/lib/instagram"
import { readFile } from "fs/promises"

const IG_ID = "17841414649666550"

export async function POST(request: Request) {
  try {
    const { caption, image_base64, filename, image_urls, post_id } = await request.json()

    // If we have pre-uploaded image URLs (catbox), publish carousel directly
    if (image_urls && image_urls.length > 0) {
      const token = process.env.INSTAGRAM_ACCESS_TOKEN
      if (!token) {
        return Response.json({ error: "INSTAGRAM_ACCESS_TOKEN not configured" }, { status: 500 })
      }

      const IG_ID = "17841414649666554"
      const BASE = `https://graph.instagram.com/v21.0/${IG_ID}`

      // Step 1: Create individual media containers
      const containerIds: string[] = []
      for (const url of image_urls) {
        const r = await fetch(`${BASE}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: url,
            is_carousel_item: true,
            access_token: token,
          }),
        })
        const data = await r.json()
        if (!data.id) {
          return Response.json({ error: `Container creation failed: ${JSON.stringify(data)}` }, { status: 400 })
        }
        containerIds.push(data.id)
        // Small delay for rate limiting
        await new Promise(r => setTimeout(r, 1000))
      }

      // Step 2: Create carousel
      await new Promise(r => setTimeout(r, 3000))
      const carouselR = await fetch(`${BASE}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "CAROUSEL",
          children: containerIds.join(","),
          caption: caption,
          access_token: token,
        }),
      })
      const carouselData = await carouselR.json()
      if (!carouselData.id) {
        return Response.json({ error: `Carousel creation failed: ${JSON.stringify(carouselData)}` }, { status: 400 })
      }

      // Step 3: Publish
      await new Promise(r => setTimeout(r, 10000))
      const publishR = await fetch(`${BASE}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: carouselData.id,
          access_token: token,
        }),
      })
      const publishData = await publishR.json()
      if (!publishData.id) {
        return Response.json({ error: `Publish failed: ${JSON.stringify(publishData)}` }, { status: 400 })
      }

      // Get permalink
      const permalinkR = await fetch(`${BASE}/${publishData.id}?fields=id,permalink&access_token=${token}`)
      const permalinkData = await permalinkR.json()

      return Response.json({
        success: true,
        media_id: publishData.id,
        permalink: permalinkData.permalink,
        image_url: image_urls[0],
      })
    }

    // Legacy: single image via base64 upload
    if (!image_base64) {
      return Response.json({ error: "Image data or image_urls required" }, { status: 400 })
    }

    const imageUrl = await uploadImageToHost(image_base64, filename || "post.png")
    const result = await publishPost(imageUrl, caption)

    if (result.error) {
      return Response.json({ error: result.error.message || "Publish failed", details: result.error }, { status: 400 })
    }

    return Response.json({ success: true, media_id: result.id, image_url: imageUrl })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
