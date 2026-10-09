// Reads the published output of the standalone research agent.
//
// The research itself runs OUTSIDE this app (scripts/research/engine.py on the
// Oracle VM) and publishes topics.json. This app is only a consumer — it never
// crawls a source, so it can never time out a serverless function doing work
// it was not built for. Tuning sources/rubric touches the agent config and
// never requires an app redeploy.

import { readFile } from "fs/promises"
import { join } from "path"

const RAW_URL =
  "https://raw.githubusercontent.com/timothygaer/garybudgets-command-center/main/topics.json"
const LOCAL_PATH = join(process.cwd(), "topics.json")

export type ScoutResult = {
  id: string
  topic: string
  source: string
  category: string
  confidence: number
  suggestion: string
  hook?: string
  confidence_reason?: string
  duplicate_note?: string
  duplicate_status?: string
  evidence_url?: string
  finance_related?: boolean
  priority_angle?: boolean
  trending_sources?: number
  age_days?: number | null
  suggested_format?: string
}

export type ScoutPayload = {
  id: string
  generated_at: string | null
  domain: string
  stale: boolean
  queued: boolean
  run: {
    sources_scanned: number
    sources_total: number
    candidate_count: number
    corpus_titles: number
    topics_found: number
    window_days: number | null
    unavailable_sources: { id: string; name: string; reason: string }[]
  }
  results: ScoutResult[]
}

const EMPTY: ScoutPayload = {
  id: "scout-none",
  generated_at: null,
  domain: "",
  stale: true,
  queued: false,
  run: {
    sources_scanned: 0,
    sources_total: 0,
    candidate_count: 0,
    corpus_titles: 0,
    topics_found: 0,
    window_days: null,
    unavailable_sources: [],
  },
  results: [],
}

async function loadRaw(): Promise<any | null> {
  try {
    const resp = await fetch(RAW_URL, { cache: "no-store" })
    if (resp.ok) return await resp.json()
  } catch {
    /* fall through to the committed copy */
  }
  try {
    return JSON.parse(await readFile(LOCAL_PATH, "utf-8"))
  } catch {
    return null
  }
}

export async function getTopicScout(): Promise<ScoutPayload> {
  const data = await loadRaw()
  if (!data || !Array.isArray(data.topics)) return EMPTY

  const run = data.run || {}
  const generated = data.generated_at || null

  // Anything older than 24h is flagged stale so the UI can say so instead of
  // passing off week-old topics as current.
  let stale = true
  if (generated) {
    const ageHours = (Date.now() - new Date(generated).getTime()) / 36e5
    stale = !(ageHours >= 0 && ageHours < 24)
  }

  const results: ScoutResult[] = data.topics.map((t: any, i: number) => ({
    id: t.id || `scout-topic-${i}`,
    topic: t.topic || t.title || "",
    source: t.source || "Unknown",
    category: t.category || "Industry News",
    confidence: typeof t.confidence === "number" ? t.confidence : 0,
    suggestion: t.summary || t.hook || "",
    hook: t.hook,
    confidence_reason: t.confidence_reason,
    duplicate_note: t.duplicate_note,
    duplicate_status: t.duplicate_status,
    evidence_url: t.url,
    finance_related: t.finance_related,
    priority_angle: t.priority_angle,
    trending_sources: t.trending_sources,
    age_days: t.age_days ?? null,
    suggested_format: t.suggested_format,
  }))

  return {
    id: `scout-${generated || "unknown"}`,
    generated_at: generated,
    domain: data.domain || "",
    stale,
    queued: false,
    run: {
      sources_scanned: run.sources_ok || 0,
      sources_total: run.sources_total || 0,
      candidate_count: run.signals_seen || 0,
      corpus_titles: run.corpus_titles || 0,
      topics_found: run.topics_found || results.length,
      window_days: data.window_days ?? null,
      unavailable_sources: (run.sources_failed || []).map((f: any) => ({
        id: f.id,
        name: f.id,
        reason: f.reason,
      })),
    },
    results,
  }
}
