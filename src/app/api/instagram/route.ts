// API route to fetch Instagram data
import { fetchAccountInfo, fetchAccountInsights, fetchRecentMedia } from "@/lib/instagram"

export async function GET() {
  try {
    const [accountInfo, insights, media] = await Promise.all([
      fetchAccountInfo(),
      fetchAccountInsights(),
      fetchRecentMedia(20),
    ])

    // Parse insights
    const parsed = {
      reach: 0,
      follower_count: 0,
      profile_views: 0,
      accounts_engaged: 0,
      total_interactions: 0,
      views: 0,
    }
    if (insights.data) {
      for (const item of insights.data) {
        const vals = item.values.map((v: any) => v.value).filter((v: number) => v > 0)
        const total = vals.reduce((a: number, b: number) => a + b, 0)
        if (item.name === "reach") parsed.reach = total
        if (item.name === "follower_count") parsed.follower_count = total
        if (item.name === "profile_views") parsed.profile_views = total
        if (item.name === "accounts_engaged") parsed.accounts_engaged = total
        if (item.name === "total_interactions") parsed.total_interactions = total
        if (item.name === "views") parsed.views = total
      }
    }

    // Parse media with insights
    const posts = (media.data || []).map((p: any) => ({
      id: p.id,
      media_type: p.media_type,
      media_url: p.media_url,
      permalink: p.permalink,
      caption: p.caption || "",
      timestamp: p.timestamp,
      like_count: p.like_count || 0,
      comments_count: p.comments_count || 0,
      insights: p.insights?.data
        ? Object.fromEntries(
            p.insights.data.map((i: any) => [i.name, i.values[0]?.value || 0])
          )
        : null,
    }))

    // Fire-and-forget: save today's snapshot to trend history
    try {
      const today = new Date()
      const monday = new Date(today)
      monday.setDate(today.getDate() - today.getDay() + 1)
      const snapshot = {
        date: today.toISOString().split("T")[0],
        week: monday.toISOString().split("T")[0],
        reach: parsed.reach || 0,
        followers: accountInfo.followers_count || 0,
        saves: 0,
        likes: 0,
        comments: 0,
        profile_views: parsed.profile_views || 0,
        interactions: parsed.total_interactions || 0,
      }
      fetch(`http://localhost:${process.env.PORT || 3000}/api/insights-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      }).catch(() => {})
    } catch {}

    return Response.json({
      account: {
        id: accountInfo.id,
        username: accountInfo.username,
        account_type: accountInfo.account_type,
        media_count: accountInfo.media_count,
        followers: accountInfo.followers_count || 0,
        follows: accountInfo.follows_count || 0,
        profile_picture: accountInfo.profile_picture_url,
      },
      insights: parsed,
      posts,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
