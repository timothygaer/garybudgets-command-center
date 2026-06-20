// Serve the manifest file as the queue
import { readFile } from "fs/promises"
import { existsSync } from "fs"

export async function GET() {
  const manifestPath = "/tmp/gb-posts/manifest.json"

  if (!existsSync(manifestPath)) {
    return Response.json({
      queue: [],
      message: "No manifest found. Run weekly content generation first.",
    })
  }

  try {
    const content = await readFile(manifestPath, "utf-8")
    const manifest = JSON.parse(content)
    return Response.json({
      queue: manifest.posts || [],
      week: manifest.week_start,
    })
  } catch {
    return Response.json({ queue: [], message: "Could not parse manifest" })
  }
}
