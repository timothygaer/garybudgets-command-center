// Reports which sources the research agent is configured with.
//
// There are no user credentials to manage any more: the agent runs on free
// RSS / news-search endpoints, so every source is active without a key. This
// route reads the live agent config so the UI can never claim "55 sources"
// when the agent is actually pointed at something else.

import { readFile } from "fs/promises"
import { join } from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CONFIG = join(process.cwd(), "scripts", "research", "configs", "garybudgets.json")

export async function GET() {
  let cfg: any = null
  try {
    cfg = JSON.parse(await readFile(CONFIG, "utf-8"))
  } catch {
    return Response.json({ credentials: [], sources_total: 0, sources: [] })
  }

  const sources = (cfg.sources || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    url: s.url || "",
    kind: s.query ? "news-search" : "rss",
    category: s.category || "general",
    query: s.query || null,
    paced: !!s.paced,
    credentialKey: null,
    credentialUrl: null,
  }))

  return Response.json({
    credentials: sources.map((s: any) => ({
      key: s.id,
      label: s.name,
      configured: true,
      required: false,
      kind: s.kind,
      category: s.category,
    })),
    sources_total: sources.length,
    sources,
    agent_id: cfg.agent_id,
    domain: cfg.domain,
    window_days: cfg.window_days,
    max_topics: cfg.max_topics,
  })
}
