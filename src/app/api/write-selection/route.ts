// API route: save selected Topic Scout topics for the assistant to build
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"

const SELECTIONS_DIR = "/tmp/gb-scout-selections"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { topics } = body
    if (!topics || !Array.isArray(topics)) {
      return Response.json({ error: "topics array required" }, { status: 400 })
    }

    await mkdir(SELECTIONS_DIR, { recursive: true })
    const filePath = join(SELECTIONS_DIR, `selection-${Date.now()}.json`)
    await writeFile(filePath, JSON.stringify({
      selected_at: new Date().toISOString(),
      topics
    }, null, 2))

    return Response.json({ success: true, path: filePath, count: topics.length })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
