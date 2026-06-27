// API route: serves calendar data from the manifest
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = "/tmp/gb-manifest.json"
const FALLBACK_PATH = join(process.cwd(), "manifest.json")

type ManifestSlide = {
  slide: number
  heading: string
  prompt_summary: string
}

type ManifestPost = {
  id: string
  title: string
  pillar: string
  status: string
  proposed_schedule?: string
  original_schedule?: string
  posted_at?: string
  approved_at?: string
  caption?: string
  hashtags?: string
  slides?: ManifestSlide[]
  slide_count?: number
  image_urls?: string[]
  instagram_url?: string
}

type Manifest = {
  posts?: ManifestPost[]
}

/** Parse a schedule string like "Mon, Jun 22 · 4:00 PM PT" into {date, time} */
function parseScheduleStr(schedStr: string): { date: string | null; time: string } {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }
  // Match: "Mon, Jun 22 · 4:00 PM PT" or "Mon, Jun 22 · 4:00 PM ET"
  const match = schedStr.match(/(\w+), (\w+) (\d+) · (\d+):(\d+) (AM|PM)/)
  if (!match) return { date: null, time: "" }
  const month = months[match[2]]
  if (month === undefined) return { date: null, time: "" }
  const day = parseInt(match[3])
  const year = new Date().getFullYear()
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const time = `${match[4]}:${match[5]} ${match[6]} PT`
  return { date, time }
}

export async function GET() {
  try {
    let manifestPath = SRC_PATH
    if (!existsSync(manifestPath)) {
      manifestPath = FALLBACK_PATH
    }
    if (!existsSync(manifestPath)) {
      return Response.json({ events: [] })
    }

    const content = await readFile(manifestPath, "utf-8")
    const manifest = JSON.parse(content) as Manifest

    const events = (manifest.posts || [])
      .map((post: ManifestPost) => {
        const schedStr = post.proposed_schedule || post.original_schedule || ""
        let date: string | null = null
        let time = ""
        let calStatus: string

        if (post.status === "posted" && post.posted_at) {
          const d = new Date(post.posted_at)
          date = d.toISOString().split("T")[0]
          // Extract time from posted_at timestamp
          const hours = d.getUTCHours()
          const mins = d.getUTCMinutes().toString().padStart(2, "0")
          const ampm = hours >= 12 ? "PM" : "AM"
          const hour12 = hours % 12 || 12
          time = `${hour12}:${mins} ${ampm} UTC`
          calStatus = "posted"
        } else if (post.status === "approved") {
          // Approved posts: show as scheduled, parse their schedule
          const parsed = parseScheduleStr(schedStr)
          date = parsed.date
          time = parsed.time
          calStatus = "scheduled"
        } else if (post.status === "draft" && schedStr) {
          // Draft posts: show as pending if they have a schedule
          const parsed = parseScheduleStr(schedStr)
          date = parsed.date
          time = parsed.time
          calStatus = "pending"
        } else {
          calStatus = "pending"
        }

        if (!date) return null

        const today = new Date(new Date().toDateString())
        const eventDate = new Date(date + "T12:00:00")
        const isFuture = eventDate >= today

        // Don't hide past approved posts — they need to be visible so they can be fixed
        // Only filter out genuine past pending/draft posts
        if (isFuture === false && calStatus === "pending") return null

        const imageUrls = post.image_urls || []
        const slidePreviews = (post.slides || []).map((slide: ManifestSlide, i: number) => ({
          slide: slide.slide,
          heading: slide.heading,
          prompt_summary: slide.prompt_summary,
          image_url: imageUrls[i] || "",
        }))

        return {
          id: post.id,
          date,
          title: post.title,
          pillar: post.pillar,
          status: calStatus,
          source_status: post.status,
          time,
          schedule_label: schedStr,
          original_schedule: post.original_schedule || null,
          proposed_schedule: post.proposed_schedule || null,
          approved_at: post.approved_at || null,
          caption: post.caption || "",
          hashtags: post.hashtags || "",
          slides: post.slides || [],
          slidePreviews,
          slide_count: post.slide_count || (post.slides || []).length,
          image_urls: imageUrls,
          instagram_url: post.instagram_url || null,
        }
      })
      .filter(Boolean)

    return Response.json({ events })
  } catch {
    return Response.json({ events: [] })
  }
}
