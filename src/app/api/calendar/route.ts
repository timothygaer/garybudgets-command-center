// API route: serves calendar data from the manifest
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { normalizeStatus } from "@/lib/manifest"

const SRC_PATH = join(process.cwd(), "manifest.json")
const GITHUB_MANIFEST_URL = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"

async function getManifest(): Promise<Manifest | null> {
  const token = process.env.GITHUB_TOKEN
  if (token) {
    const resp = await fetch(GITHUB_MANIFEST_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "garybudgets command-center",
      },
      cache: "no-store",
    })
    if (resp.ok) {
      const fileData = await resp.json()
      const content = Buffer.from(fileData.content, "base64").toString("utf-8")
      return JSON.parse(content) as Manifest
    }
  }

  if (!existsSync(SRC_PATH)) return null
  const content = await readFile(SRC_PATH, "utf-8")
  return JSON.parse(content) as Manifest
}

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
  stuck?: boolean
  skipped?: boolean
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
    const manifest = await getManifest()
    if (!manifest) return Response.json({ events: [] })

    const events = (manifest.posts || [])
      .map((post: ManifestPost) => {
        const normalizedStatus = normalizeStatus(post)
        const schedStr = post.proposed_schedule || post.original_schedule || ""
        let date: string | null = null
        let time = ""
        let calStatus: string

        if (normalizedStatus === "posted" && post.posted_at) {
          const d = new Date(post.posted_at)
          // Date the post by PACIFIC time (America/Los_Angeles), not UTC. A post made
          // at 6:36 PM PT on Aug 26 has a UTC timestamp of 2026-08-27T01:36Z — using
          // toISOString() (UTC) would wrongly place it on tomorrow's calendar. en-CA
          // yields YYYY-MM-DD for the LA-local date.
          date = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(d)
          time = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true,
          }).format(d) + " PT"
          calStatus = "posted"
        } else if (normalizedStatus === "approved") {
          const parsed = parseScheduleStr(schedStr)
          date = parsed.date
          time = parsed.time
          calStatus = "scheduled"
        } else if (normalizedStatus === "stuck" || post.stuck || post.skipped) {
          // Stopped/stuck post — show it (Red) so it can be fixed/skipped, regardless of schedule.
          const parsed = parseScheduleStr(schedStr)
          date = parsed.date || new Date().toISOString().split("T")[0]
          time = parsed.time || "—"
          calStatus = "stuck"
        } else {
          calStatus = "pending"
        }

        if (!date) return null

        // Only show posts that are actually scheduled-to-post or already posted.
        // Hide bare/unapproved drafts (even if they carry a placeholder schedule baked in
        // at creation). Past approved and past posted items stay visible so they can be
        // reviewed/fixed. Stuck posts always show (Red) so they can be fixed/skipped.
        if (calStatus === "pending") return null

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
          stuck: !!post.stuck,
        }
      })
      .filter(Boolean)

    return Response.json({ events })
  } catch {
    return Response.json({ events: [] })
  }
}
