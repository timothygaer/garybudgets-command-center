// API route: save selected Topic Scout topics as draft manifest entries
// Uses GitHub REST API so selections persist across Vercel deploys
// (Vercel's /tmp/ is ephemeral and not shared with the assistant)
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")
const SCOUT_DRAFTS_PATH = "/tmp/gb-scout-drafts-v2.json"

let postCounter = 0

function createPostId(): string {
  postCounter++
  return `scout-${Date.now()}-${postCounter}`
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)
}

function buildDiscoveryCopy(topic: any): { caption: string; hashtags: string } {
  const title = String(topic.topic || "").trim()
  const suggestion = String(topic.suggestion || "").trim()
  const lower = `${title} ${suggestion}`.toLowerCase()

  let hashtags = "#FilmFinance #LineProducer #IndieFilmProduction #FilmBudgeting #ProducerTips"
  let angle = "budgeting decision"
  let audience = "indie producers"
  let practicalLens = "cash flow, production risk, schedule pressure, crew planning, and the real cost of getting a film finished"

  if (lower.includes("tax") || lower.includes("incentive") || lower.includes("rebate") || lower.includes("credit")) {
    hashtags = "#FilmTaxIncentives #FilmFinance #LineProducer #IndieFilmProduction #FilmBudgeting"
    angle = "film tax incentive decision"
    practicalLens = "qualified spend, refundable versus transferable credits, annual caps, audit timing, local crew depth, payroll/fringe burden, and whether the headline percentage turns into usable cash"
  } else if (lower.includes("streaming") || lower.includes("residual") || lower.includes("distribution")) {
    hashtags = "#StreamingResiduals #FilmDistribution #FilmFinance #IndieFilmProducers #FilmBudgeting"
    angle = "streaming distribution decision"
    practicalLens = "license fees, residual exposure, data transparency, bonus triggers, reporting rights, delivery costs, and the long-term value of the deal"
  } else if (lower.includes("insurance") || lower.includes("e&o") || lower.includes("liability")) {
    hashtags = "#FilmInsurance #ProductionInsurance #FilmFinance #LineProducer #FilmBudgeting"
    angle = "production insurance decision"
    practicalLens = "general liability, workers comp, equipment coverage, E&O, location requirements, rental-house requirements, and the cost of one uncovered claim"
  } else if (lower.includes("festival")) {
    hashtags = "#FilmFestivalStrategy #IndieFilmMarketing #FilmDistribution #IndieFilmProducers #FilmBudgeting"
    angle = "festival strategy decision"
    practicalLens = "submission fees, premiere status, travel costs, deliverables, sales opportunities, publicity, and whether the festival spend supports distribution"
  } else if (lower.includes("virtual production") || lower.includes("ai") || lower.includes("pre-production")) {
    hashtags = "#FilmTech #PreProduction #VirtualProduction #FilmFinance #FilmBudgeting"
    angle = "production technology decision"
    practicalLens = "software costs, crew training, testing time, hardware rentals, workflow risk, and whether the tool saves enough time to justify the line item"
  }

  const context = suggestion || `This topic matters because ${title.toLowerCase()} can change the economics of an indie film before production starts.`
  const caption = `${title} is not just a headline — it is a ${angle} that can change how ${audience} plan, finance, and protect a production. ${context}\n\nBefore treating this as a trend, turn it into a budget question. What line items move? What paperwork is required? Who needs to approve it? What costs are hidden until prep, delivery, or distribution? The producers who win are not the ones who memorize buzzwords. They are the ones who translate industry changes into specific assumptions in the budget.\n\nUse this lens when you evaluate ${title.toLowerCase()}: ${practicalLens}. If those details are not written into the plan, the number on the top sheet is probably too optimistic.\n\nSave this for your next budget pass, and send it to the producer who needs to pressure-test the plan before money is committed.`

  return { caption, hashtags }
}

/** Find next available Mon-Sat slot (skipping Sundays, max 2 per day) */
function findNextSlot(existingSchedules: string[]): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  for (let days = 1; days <= 14; days++) {
    const check = new Date(tomorrow)
    check.setDate(check.getDate() + days - 1)
    const dayOfWeek = check.getDay()
    if (dayOfWeek === 0) continue // Skip Sunday

    const dateStr = `${dayNames[dayOfWeek]}, ${monthNames[check.getMonth()]} ${check.getDate()}`
    const dayPostCount = existingSchedules.filter((s) => s && s.startsWith(dateStr)).length
    if (dayPostCount < 2) {
      const hour = dayPostCount === 0 ? "9:00" : "12:00"
      return `${dateStr} · ${hour} AM PT`
    }
  }
  return `${dayNames[tomorrow.getDay()]}, ${monthNames[tomorrow.getMonth()]} ${tomorrow.getDate()} · 9:00 AM PT`
}

/** Fetch the latest manifest from GitHub and extract scout drafts */
async function getScoutDraftsFromGitHub(): Promise<{ drafts: any[]; used_topics?: string[]; error?: string }> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return { drafts: [], error: "no token" }
  try {
    const resp = await fetch("https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "garybudgets command-center",
      },
    })
    if (!resp.ok) return { drafts: [], error: `GitHub API: ${resp.status}` }
    const fileData = await resp.json()
    const content = Buffer.from(fileData.content, "base64").toString()
    const manifest = JSON.parse(content)
    const drafts = (manifest.posts || []).filter(
      (p: any) => p.source === "Topic Scout" && !p.has_images
    )
    const used_topics = (manifest.posts || [])
      .map((p: any) => p.title)
      .filter((title: any) => typeof title === "string" && title.trim().length > 0)
    return { drafts, used_topics }
  } catch (err: any) {
    return { drafts: [], error: err.message }
  }
}

export async function GET() {
  const result = await getScoutDraftsFromGitHub()
  return Response.json(result)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { topics } = body
    if (!topics || !Array.isArray(topics)) {
      return Response.json({ error: "topics array required" }, { status: 400 })
    }

    // Read current manifest to check for already-built topics
    if (!existsSync(SRC_PATH)) {
      return Response.json({ error: "manifest not found" }, { status: 500 })
    }
    const manifestContent = await readFile(SRC_PATH, "utf-8")
    const manifest = JSON.parse(manifestContent)

    // Get existing schedules for slot assignment
    const existingSchedules = (manifest.posts || [])
      .filter((p: any) => p.proposed_schedule || p.original_schedule)
      .map((p: any) => p.proposed_schedule || p.original_schedule)

    // Get existing titles to avoid duplicates
    const existingTitles = new Set((manifest.posts || []).map((p: any) => p.title.toLowerCase()))

    const addedDrafts: any[] = []
    const skipped: string[] = []

    for (const topic of topics) {
      const title = topic.topic
      // Skip if already in manifest (exact title match)
      if (existingTitles.has(title.toLowerCase())) {
        skipped.push(title)
        continue
      }

      const postId = createPostId()
      const schedule = findNextSlot(existingSchedules)
      const discoveryCopy = buildDiscoveryCopy(topic)

      const draftPost: any = {
        id: postId,
        title,
        pillar: topic.topic.toLowerCase().includes("budget") || topic.topic.toLowerCase().includes("cost") || topic.topic.toLowerCase().includes("money") ? "Budget School" : "Industry Watch",
        slug: `Post_${slugify(title)}`,
        slide_count: 6,
        original_schedule: schedule,
        proposed_schedule: schedule,
        caption: discoveryCopy.caption,
        hashtags: discoveryCopy.hashtags,
        slides: [
          { slide: 1, heading: "Hook", prompt_summary: "Attention-grabbing hook related to: " + title },
          { slide: 2, heading: "Educational 1", prompt_summary: "Deepen the topic" },
          { slide: 3, heading: "Educational 2", prompt_summary: "More specifics" },
          { slide: 4, heading: "Educational 3", prompt_summary: "Pitfalls and watch-outs" },
          { slide: 5, heading: "Educational 4", prompt_summary: "Actionable advice" },
          { slide: 6, heading: "CTA", prompt_summary: "Gary Budgets call to action" },
        ],
        status: "ready",
        has_images: false,
        image_file_names: ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"],
        image_urls: [
          `/images/${postId}/1.png`,
          `/images/${postId}/2.png`,
          `/images/${postId}/3.png`,
          `/images/${postId}/4.png`,
          `/images/${postId}/5.png`,
          `/images/${postId}/6.png`,
        ],
        created_at: new Date().toISOString(),
        source: "Topic Scout",
        suggestion: topic.suggestion || "",
        source_name: topic.source || "",
      }

      manifest.posts.push(draftPost)
      existingSchedules.push(schedule)
      existingTitles.add(title.toLowerCase())
      addedDrafts.push({ id: postId, title, schedule })
    }

    // Persist to GitHub so it survives Vercel cold-starts
    const token = process.env.GITHUB_TOKEN
    let githubPersisted = false
    if (token) {
      const url = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "garybudgets command-center",
      }
      try {
        const getResp = await fetch(url, { headers })
        if (getResp.ok) {
          const fileData = await getResp.json()
          const newContent = JSON.stringify(manifest, null, 2) + "\n"
          const putResp = await fetch(url, {
            method: "PUT",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `topic scout: ${addedDrafts.map(d => d.title).join(", ")} (${addedDrafts.length} drafts)`,
              content: Buffer.from(newContent).toString("base64"),
              sha: fileData.sha,
            }),
          })
          githubPersisted = putResp.ok
        }
      } catch {
        // Fallback — just save locally
      }
    }

    return Response.json({
      success: true,
      drafts: addedDrafts,
      skipped,
      count: addedDrafts.length,
      github_persisted: githubPersisted,
    })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
