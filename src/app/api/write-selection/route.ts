// API route: save selected Topic Scout topics as draft manifest entries
// Uses GitHub REST API so selections persist across Vercel deploys
// (Vercel's /tmp/ is ephemeral and not shared with the assistant)
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

const SRC_PATH = join(process.cwd(), "manifest.json")

function createPostId(): string {
  return `scout-${Date.now()}`
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)
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

      const draftPost: any = {
        id: postId,
        title,
        pillar: topic.topic.toLowerCase().includes("budget") || topic.topic.toLowerCase().includes("cost") || topic.topic.toLowerCase().includes("money") ? "Budget School" : "Industry Watch",
        slug: `Post_${slugify(title)}`,
        slide_count: 6,
        original_schedule: schedule,
        proposed_schedule: schedule,
        caption: topic.suggestion || "",
        hashtags: "#filmbudget #indiefilm #filmproduction #GaryBudgets",
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
