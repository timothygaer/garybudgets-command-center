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

function cleanTitle(title: string): string {
  const t = String(title || "").replace(/\s+/g, " ").trim()
  const stripped = t.replace(/\s+[-–—|]\s+[A-Z0-9][A-Za-z0-9&.'’ ]{2,28}$/, "").trim()
  return stripped || t
}

/**
 * Story-specific caption.
 *
 * Every line must be true OF THIS STORY. The previous version pasted one
 * boilerplate "turn it into a budget question" paragraph onto every post, which
 * is why the copy read budget-heavy next to non-budget headlines. We now lead
 * with the story's own hook and opening line, add a category-appropriate
 * "filmmaker's read" line, and keep the sourcing note. No claim is ever invented.
 */
function buildDiscoveryCopy(topic: any): { caption: string; hashtags: string } {
  const title = cleanTitle(String(topic.topic || "").trim())
  const hook = String(topic.hook || title).trim()
  const whyNow = String(topic.why_now || "").trim()
  const summary = String(topic.summary || topic.suggestion || "").trim()
  const confidenceReason = String(topic.confidence_reason || "").trim()
  const lower = `${title} ${summary}`.toLowerCase()

  // Category lens: describes the KIND of story, so it cannot contradict it.
  let lens = "what this means for the people who make films"
  let hashtags = "#FilmNews #Filmmaking #IndieFilm #FilmIndustry #MovieNews"
  if (/trailer|teaser|first look/.test(lower)) {
    lens = "what this first look tells us about the finished film"
    hashtags = "#FilmNews #Trailer #MovieNews #Filmmaking #FilmIndustry"
  } else if (/casting|stars in|to star|\bcast\b|joins the/.test(lower)) {
    lens = "what this casting means for the production"
    hashtags = "#FilmNews #Casting #MovieNews #Filmmaking #FilmIndustry"
  } else if (/festival|award|prize|\bwins\b/.test(lower)) {
    lens = "what the festival run signals for the film"
    hashtags = "#FilmFestival #FilmNews #IndieFilm #Filmmaking #FilmIndustry"
  } else if (/box office|opening weekend|grosses|grossing/.test(lower)) {
    lens = "what the numbers say about the market right now"
    hashtags = "#BoxOffice #FilmNews #FilmIndustry #MovieNews #Filmmaking"
  } else if (/acqui|merger|\bdeal\b|rights|studio|paramount|warner|disney|netflix|apple|amazon/.test(lower)) {
    lens = "what this deal means for the people making films"
    hashtags = "#FilmIndustry #FilmNews #StudioNews #MovieNews #Filmmaking"
  } else if (/release date|premiere|will release|to release|in theaters/.test(lower)) {
    lens = "what the release plan tells us"
    hashtags = "#FilmNews #ReleaseDate #MovieNews #FilmIndustry #Filmmaking"
  } else if (/documentary|\bdoc\b/.test(lower)) {
    lens = "what this documentary brings to audiences"
    hashtags = "#Documentary #FilmNews #IndieFilm #Filmmaking #FilmIndustry"
  } else if (/animat|anime|cartoon/.test(lower)) {
    lens = "what this means for animation"
    hashtags = "#Animation #FilmNews #MovieNews #Filmmaking #FilmIndustry"
  } else if (/budget|cost|tax|incentive|rebate|insurance|payroll|financ/.test(lower)) {
    lens = "what it means for the money side of the business"
    hashtags = "#FilmFinance #FilmNews #IndieFilm #FilmBudgeting #FilmIndustry"
  }

  // Prefer the story's own opening line, then the summary. Never invent details.
  const storyLine = whyNow || summary
  const parts = [hook]
  if (storyLine && storyLine.toLowerCase() !== hook.toLowerCase()) parts.push(storyLine)
  parts.push(`The filmmaker's read: ${lens}.`)
  if (confidenceReason) parts.push(`Why it's on the list: ${confidenceReason}`)
  parts.push("What's your take — does this change anything for the films you're working on? Drop it in the comments.")
  parts.push("Follow @garyfilmbudgets for daily film industry news.")

  return { caption: parts.join("\n\n"), hashtags }
}

/**
 * Slide plan for the builder.
 *
 * These prompts are what the build agent expands into the burned-in slide text,
 * so they carry the actual story: the hook, what happened, and why it matters.
 * The old plan was six bare headings ("Deepen the topic"), which produced
 * generic slides that never told the story. 6-slide structure is enforced by the
 * carousel build workflow: hook → education → education → education → education → CTA.
 */
function buildSlidePrompts(title: string, topic: any) {
  const hook = String(topic.hook || title).trim()
  const story = String(topic.why_now || topic.summary || topic.suggestion || "").trim()
  return [
    { slide: 1, heading: "Hook", prompt_summary: `Open with this hook: "${hook}". One short arresting line making the story's importance obvious.` },
    { slide: 2, heading: "What happened", prompt_summary: `State the news plainly: ${story || title}. Include who, what and when — no speculation.` },
    { slide: 3, heading: "The detail", prompt_summary: `The specifics behind "${title}" — names, numbers, dates or terms a film professional would care about.` },
    { slide: 4, heading: "Why it matters", prompt_summary: `What "${title}" means for people who make films: production, distribution, marketing or the industry business.` },
    { slide: 5, heading: "What to watch", prompt_summary: `What happens next with "${title}" and what to keep an eye on. Concrete and forward-looking.` },
    { slide: 6, heading: "CTA", prompt_summary: "Close with a Gary Budgets call to action: follow @garyfilmbudgets for daily film industry news." },
  ]
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
    const { topics, build_type = "carousel" } = body
    if (!topics || !Array.isArray(topics)) {
      return Response.json({ error: "topics array required" }, { status: 400 })
    }
    if (!["carousel", "reel", "both"].includes(build_type)) {
      return Response.json({ error: "build_type must be carousel, reel, or both" }, { status: 400 })
    }

    // Base the new manifest on the LATEST published manifest, not on the copy
    // bundled with this deployment. The bundle lags GitHub (the Oracle VM commits
    // manifest updates that later trigger a rebuild), so writing the stale bundled
    // copy back would silently drop those updates — the same clobber failure that
    // kept eating VM changes. GitHub is the source of truth; local is the fallback.
    let manifest: any = null
    try {
      const raw = await fetch(
        "https://raw.githubusercontent.com/timothygaer/garybudgets-command-center/main/manifest.json",
        { cache: "no-store" }
      )
      if (raw.ok) manifest = await raw.json()
    } catch { /* fall through to the bundled copy */ }
    if (!manifest || !Array.isArray(manifest.posts)) {
      if (!existsSync(SRC_PATH)) {
        return Response.json({ error: "manifest not found" }, { status: 500 })
      }
      manifest = JSON.parse(await readFile(SRC_PATH, "utf-8"))
    }

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
      const discoveryCopy = buildDiscoveryCopy(topic)

      const draftPost: any = {
        id: postId,
        title,
        pillar: topic.topic.toLowerCase().includes("budget") || topic.topic.toLowerCase().includes("cost") || topic.topic.toLowerCase().includes("money") ? "Budget School" : "Industry Watch",
        slug: `Post_${slugify(title)}`,
        slide_count: 6,
        build_type,
        // NO schedule is baked in at creation. The day/time is assigned only when the
        // user approves the post (approve route assigns the next free slot in the order
        // posts are approved).
        original_schedule: null,
        proposed_schedule: null,
        caption: discoveryCopy.caption,
        hashtags: discoveryCopy.hashtags,
        slides: buildSlidePrompts(title, topic),
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
        hook: topic.hook || "",
        confidence_reason: topic.confidence_reason || "",
        evidence_url: topic.evidence_url || "",
        duplicate_note: topic.duplicate_note || "",
      }

      manifest.posts.push(draftPost)
      existingTitles.add(title.toLowerCase())
      addedDrafts.push({ id: postId, title })

      // build_type "both": also create a separate REEL draft (also unscheduled —
      // assigned a slot when the user approves it).
      if (build_type === "both") {
        const reelPost: any = {
          ...draftPost,
          id: postId + "-reel",
          title: title + " (Reel)",
          slug: `Reel_${slugify(title)}`,
          build_type: "reel",
          original_schedule: null,
          proposed_schedule: null,
          caption: "REEL: " + draftPost.caption,
          status: "ready",
          has_images: false,
          video_url: null,
          cover_url: null,
        }
        delete reelPost.image_urls
        manifest.posts.push(reelPost)
        addedDrafts.push({ id: reelPost.id, title: reelPost.title })
      }
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
