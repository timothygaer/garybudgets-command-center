// Returns the latest published research run. The heavy work happens out of
// process (standalone agent on the Oracle VM), so this route only reads JSON.

import { getTopicScout } from "@/lib/topic-scout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const scout = await getTopicScout()
  return Response.json(scout, { headers: { "Cache-Control": "no-store" } })
}
