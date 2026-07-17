// API route: manage the build queue (Topic Scout selections)
// GET: returns all pending build items
// POST: adds topics to the build queue
// DELETE: removes a build item

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises"
import { join } from "path"

const SELECTIONS_DIR = "/tmp/gb-scout-selections"
const BUILD_QUEUE_FILE = "/tmp/gb-build-queue.json"

export async function GET() {
  try {
    // Try to read the build queue
    try {
      const content = await readFile(BUILD_QUEUE_FILE, "utf-8")
      const data = JSON.parse(content)
      return Response.json({ ok: true, items: data.items || [] })
    } catch {
      return Response.json({ ok: true, items: [] })
    }
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { topics } = body
    if (!topics || !Array.isArray(topics)) {
      return Response.json({ error: "topics array required" }, { status: 400 })
    }

    // Also save to selection file (existing behavior for local dev)
    await mkdir(SELECTIONS_DIR, { recursive: true })
    const filePath = join(SELECTIONS_DIR, `selection-${Date.now()}.json`)
    await writeFile(filePath, JSON.stringify({
      selected_at: new Date().toISOString(),
      topics
    }, null, 2))

    // Save to build queue
    let existing: { items: any[] } = { items: [] }
    try {
      const current = await readFile(BUILD_QUEUE_FILE, "utf-8")
      existing = JSON.parse(current)
    } catch { /* file doesn't exist yet */ }

    const now = new Date().toISOString()
    const newItems = topics.map((t: any, i: number) => ({
      id: `build-${Date.now()}-${i}`,
      topic: t.topic,
      source: t.source || "",
      confidence: t.confidence || 0,
      suggestion: t.suggestion || "",
      status: "pending",
      created_at: now,
    }))

    existing.items = [...existing.items, ...newItems]
    await writeFile(BUILD_QUEUE_FILE, JSON.stringify(existing, null, 2))

    return Response.json({ success: true, items: newItems, count: newItems.length })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { id } = body
    if (!id) {
      return Response.json({ error: "id required" }, { status: 400 })
    }

    try {
      const content = await readFile(BUILD_QUEUE_FILE, "utf-8")
      const data = JSON.parse(content)
      data.items = data.items.filter((i: any) => i.id !== id)
      await writeFile(BUILD_QUEUE_FILE, JSON.stringify(data, null, 2))
    } catch {
      return Response.json({ error: "no build queue" }, { status: 404 })
    }

    return Response.json({ success: true })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
