// Serves weekly insight history for trend charts
// Data is accumulated at /tmp/gb-insights-history.json each time
// the Instagram API is fetched.
import { readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"

const HISTORY_PATH = "/tmp/gb-insights-history.json"

export interface InsightSnapshot {
  date: string       // ISO date like "2026-07-16"
  week: string       // Monday of that week like "2026-07-13"
  reach: number
  followers: number
  saves: number
  likes: number
  comments: number
  profile_views: number
  interactions: number
}

export async function GET() {
  try {
    if (!existsSync(HISTORY_PATH)) {
      return Response.json({ weeks: [], daily: [] })
    }
    const content = await readFile(HISTORY_PATH, "utf-8")
    const data = JSON.parse(content)
    return Response.json(data)
  } catch {
    return Response.json({ weeks: [], daily: [] })
  }
}

// Called by /api/instagram after fetching live data
export async function POST(request: Request) {
  try {
    const snapshot: InsightSnapshot = await request.json()
    
    let history: { weeks: InsightSnapshot[]; daily: InsightSnapshot[] } = { weeks: [], daily: [] }
    if (existsSync(HISTORY_PATH)) {
      const content = await readFile(HISTORY_PATH, "utf-8")
      try { history = JSON.parse(content) } catch {}
    }

    // Keep daily history (last 90 days)
    history.daily = [...history.daily.filter((d: InsightSnapshot) => d.date !== snapshot.date), snapshot]
      .sort((a: InsightSnapshot, b: InsightSnapshot) => a.date.localeCompare(b.date))
      .slice(-90)

    // Aggregate by week
    const weekMap = new Map<string, InsightSnapshot>()
    for (const d of history.daily) {
      const existing = weekMap.get(d.week)
      if (existing) {
        existing.reach += d.reach
        existing.likes += d.likes
        existing.comments += d.comments
        existing.saves += d.saves
        existing.interactions += d.interactions
        existing.profile_views += d.profile_views
      } else {
        weekMap.set(d.week, { ...d })
      }
    }
    history.weeks = Array.from(weekMap.values())
      .sort((a: InsightSnapshot, b: InsightSnapshot) => a.week.localeCompare(b.week))

    await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2))
    return Response.json({ ok: true, daily: history.daily.length, weeks: history.weeks.length })
  } catch {
    return Response.json({ ok: false })
  }
}
