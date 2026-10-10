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
/**
 * A brief noun phrase for the story, used where pasting the whole headline again
 * would read like a stutter ("the GuadaLAjara programme announcement").
 */
function shortSubject(title: string): string {
  const t = cleanTitle(String(title || "").trim())
  const head = t.split(/[:—–]/)[0].trim()
  const base = head.split(" ").length >= 3 ? head : t
  const words = base.split(" ")
  const cut = words.length > 8 ? words.slice(0, 8).join(" ") : base
  return cut.length > 64 ? cut.slice(0, 64).replace(/\s+\S*$/, "") : cut
}

/**
 * The 6-slide plan. Each slide carries THIS story's content, so the slide copy and
 * the artwork it drives can only ever describe this story. The previous version
 * passed six bare headings ("Deepen the topic") with no story attached at all.
 */
function buildSlidePrompts(title: string, topic: any) {
  const clean = cleanTitle(String(title || "").trim())
  const subject = shortSubject(clean)
  const hook = String(topic.hook || clean).trim()
  const story = String(topic.why_now || topic.summary || topic.suggestion || "").trim()
  const category = String(topic.category || "").trim().toLowerCase()
  const angle =
    {
      "box-office": "what the numbers say about the market for films like this",
      trade: "what this deal, casting or festival news signals for the industry",
      finance: "what the money behind this story means for working filmmakers",
      awards: "what this means for the awards race and the films in it",
    }[category] || "what this signals for people who make films"

  return [
    { slide: 1, heading: "Hook", prompt_summary: `Hook slide — the story in one line: "${hook}". Large, plain, instantly readable on a phone.` },
    { slide: 2, heading: "What happened", prompt_summary: `Report the news in two or three plain sentences${story ? `: ${story}` : `: ${clean}.`} Cover who, what and when. No speculation.` },
    { slide: 3, heading: "The detail", prompt_summary: `Zoom in on the specifics of ${subject}: the names, numbers, dates or terms a film professional would actually want.` },
    { slide: 4, heading: "Why it matters", prompt_summary: `Explain ${angle}, using ${subject} as the example. Concrete, not abstract — name the practical consequence.` },
    { slide: 5, heading: "What to watch", prompt_summary: `Say what happens next with ${subject} and what to keep an eye on. Forward-looking and specific.` },
    { slide: 6, heading: "CTA", prompt_summary: "Close with the Gary Budgets call to action: follow @garyfilmbudgets for daily film industry news." },
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
    // bundled with this deployment — the bundle lags GitHub (the Oracle VM commits
    // manifest updates) and writing it back silently drops those updates.
    //
    // Read it from the GitHub API, NOT raw.githubusercontent.com: raw is CDN-cached
    // for minutes, so it can hand back the revision from BEFORE a delete while the
    // sha fetched separately is current. The PUT then succeeds and resurrects
    // deleted posts while dropping everything added since. One authoritative read,
    // and keep the exact sha of the revision it returned.
    const ghToken = process.env.GITHUB_TOKEN
    let manifest: any = null
    let baseSha: string | undefined
    if (ghToken) {
      try {
        const ghResp = await fetch(
          "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json",
          {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": "garybudgets command center" },
            cache: "no-store",
          }
        )
        if (ghResp.ok) {
          const fileData = await ghResp.json()
          const parsed = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf-8"))
          if (Array.isArray(parsed.posts)) { manifest = parsed; baseSha = fileData.sha }
        }
      } catch { /* fall through to the bundled copy */ }
    }
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
      // Use the clean headline — the raw feed title carries a " - Publisher"
      // syndication suffix that was leaking into the queue title, the slug and the
      // slide prompts that drive the artwork. Keep the raw one for traceability.
      const title = cleanTitle(String(topic.topic || "").trim())
      const rawTitle = String(topic.topic || "").trim()
      // Skip if already in the manifest. Check the clean headline AND the raw feed
      // title: existing posts were stored either way, so matching only one form let
      // duplicates through (or skipped stories that were never actually posted).
      if (existingTitles.has(title.toLowerCase()) || existingTitles.has(rawTitle.toLowerCase())) {
        skipped.push(title)
        continue
      }

      const postId = createPostId()
      const discoveryCopy = buildDiscoveryCopy(topic)

      const draftPost: any = {
        id: postId,
        title,
        source_title: rawTitle || title,
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
        // Deliberately empty until the carousel is actually built. Pre-seeded placeholder
        // paths here made unbuilt drafts report has_images=true and render broken slides.
        image_urls: [],
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

    // Persist to GitHub so it survives Vercel cold-starts. baseSha is the exact
    // revision this manifest was built on: if the live manifest moved under us,
    // GitHub refuses the PUT instead of letting us overwrite whatever landed in
    // the meantime (the clobber that kept eating VM and delete updates).
    let githubPersisted = false
    if (ghToken && baseSha) {
      const url = "https://api.github.com/repos/timothygaer/garybudgets-command-center/contents/manifest.json"
      const headers: Record<string, string> = {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "garybudgets command center",
      }
      try {
        const newContent = JSON.stringify(manifest, null, 2) + "\n"
        const putResp = await fetch(url, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `topic scout: ${addedDrafts.map(d => d.title).join(", ")} (${addedDrafts.length} drafts)`,
            content: Buffer.from(newContent).toString("base64"),
            sha: baseSha,
          }),
        })
        githubPersisted = putResp.ok
        if (!putResp.ok) {
          console.log(`write-selection: manifest PUT rejected (${putResp.status}) - stale sha or bad token`)
        }
      } catch (err: any) {
        console.log(`write-selection: manifest PUT threw - ${err.message}`)
      }
    }

    // Never report success for posts that exist only in this response: the UI shows
    // them as queued, and the user then finds nothing in the queue. A declined sha
    // (someone else wrote first) needs a human-visible failure, not a silent drop.
    if (addedDrafts.length > 0 && !githubPersisted) {
      return Response.json(
        { error: "The build queue could not be saved, so nothing was added. Please retry." },
        { status: 502 }
      )
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
