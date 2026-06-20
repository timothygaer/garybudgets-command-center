// Instagram Graph API helper — runs on the server side only
const IG_USER_ID = "17841414649666554"
const BASE = "https://graph.instagram.com/v21.0"

function getToken(): string {
  return process.env.INSTAGRAM_ACCESS_TOKEN || ""
}

export async function fetchAccountInfo() {
  const token = getToken()
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN not configured")

  const r = await fetch(
    `${BASE}/${IG_USER_ID}?fields=id,username,account_type,media_count,followers_count,follows_count,profile_picture_url&access_token=${token}`,
    { next: { revalidate: 300 } } // 5 minute cache
  )
  return r.json()
}

export async function fetchAccountInsights() {
  const token = getToken()
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN not configured")

  const r = await fetch(
    `${BASE}/${IG_USER_ID}/insights?metric=reach,follower_count,profile_views,accounts_engaged,total_interactions,views&period=day&access_token=${token}`,
    { next: { revalidate: 600 } }
  )
  const data = await r.json()
  return data
}

export async function fetchRecentMedia(limit = 20) {
  const token = getToken()
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN not configured")

  const r = await fetch(
    `${BASE}/${IG_USER_ID}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,insights.metric(impressions,reach,saved,likes,comments)&access_token=${token}&limit=${limit}`,
    { next: { revalidate: 120 } }
  )
  return r.json()
}

export async function publishPost(imageUrl: string, caption: string) {
  const token = getToken()
  const r1 = await fetch(`${BASE}/${IG_USER_ID}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  })
  const container = await r1.json()
  if (container.error) return container

  // Wait for image processing
  await new Promise((r) => setTimeout(r, 10000))
  const r2 = await fetch(`${BASE}/${IG_USER_ID}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  })
  return r2.json()
}

export async function uploadImageToHost(imageBase64: string, filename: string) {
  // Upload to catbox.moe — free, no API key
  const buffer = Buffer.from(imageBase64, "base64")
  const form = new FormData()
  form.append("reqtype", "fileupload")
  form.append("fileToUpload", new Blob([buffer]), filename)

  const r = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form })
  const url = await r.text()
  return url.trim()
}

export async function fetchPostInsights(mediaId: string) {
  const token = getToken()
  const r = await fetch(
    `${BASE}/${mediaId}/insights?metric=impressions,reach,saved,shares,profile_visits,follows&access_token=${token}`,
    { next: { revalidate: 300 } }
  )
  return r.json()
}
