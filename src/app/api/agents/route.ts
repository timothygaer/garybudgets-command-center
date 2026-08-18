import { readFile } from "fs/promises"
import { join } from "path"

// Serves the agent-workflow state (state.json written by scripts/gb_agents/orchestrator.py).
// The Overview's Agent Activity panel polls this endpoint for real-time status.
export async function GET() {
  try {
    const p = join(process.cwd(), "scripts", "gb_agents", "state.json")
    const content = await readFile(p, "utf-8")
    return Response.json(JSON.parse(content))
  } catch {
    // No state yet = no builds run. Return an empty, well-formed response.
    return Response.json({ jobs: [], agents: {}, note: "No agent builds yet." })
  }
}
