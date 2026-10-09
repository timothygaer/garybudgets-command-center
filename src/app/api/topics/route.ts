// Canonical read endpoint for the research agent's output. Any consumer
// (this app, a HUD widget, a future project) reads the same contract here.

import { getTopicScout } from "@/lib/topic-scout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const scout = await getTopicScout()
  return Response.json(scout, { headers: { "Cache-Control": "no-store" } })
}
