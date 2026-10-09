// Manual "refresh now": queues a research run for the standalone agent and
// immediately returns the topics it published last, so the UI is never
// blocked waiting on a crawl it does not control.

import { getTopicScout } from "@/lib/topic-scout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const REPO = "timothygaer/garybudgets-command-center"
const REQUEST_PATH = "research-request.json"

async function enqueueRefresh(): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return false

  const api = `https://api.github.com/repos/${REPO}/contents/${REQUEST_PATH}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "garybudgets command center",
  }

  let sha: string | undefined
  try {
    const cur = await fetch(api, { headers, cache: "no-store" })
    if (cur.ok) sha = (await cur.json()).sha
  } catch {
    /* no existing request file */
  }

  const payload = JSON.stringify({
    requested_at: new Date().toISOString(),
    agent_id: "garybudgets-topics",
    requested_by: "command-center",
  })

  try {
    const put = await fetch(api, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "chore(research): request topic refresh",
        content: Buffer.from(payload).toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    })
    return put.ok
  } catch {
    return false
  }
}

export async function POST() {
  const queued = await enqueueRefresh()
  const scout = await getTopicScout()

  return Response.json(
    {
      ...scout,
      queued,
      message: queued
        ? "Refresh queued — the research agent picks it up on its next cycle (within ~5 minutes)."
        : "Could not queue a refresh (no GitHub token); showing the most recent published research.",
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
