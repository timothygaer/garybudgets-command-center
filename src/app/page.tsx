"use client"

import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from "recharts"
import {
  Users, Eye, MousePointerClick, Heart, Bookmark, Share2,
  BarChart3, Calendar, Send, Plus, RefreshCw, TrendingUp,
  Clock, Image, ArrowUp, ArrowDown, Activity, Search,
} from "lucide-react"

// ---------- Types ----------
interface Account {
  username: string; media_count: number; followers: number; follows: number; profile_picture: string
}
interface PostInsights { impressions: number; reach: number; saved: number; likes: number; comments: number }
interface Post {
  id: string; media_type: string; media_url: string; permalink?: string
  caption: string; timestamp: string; like_count: number; comments_count: number
  insights: PostInsights | null
}
interface DashboardData {
  account: Account; insights: Record<string, number>; posts: Post[]
}

// ---------- Stat Card ----------
function StatCard({ icon: Icon, label, value, sub, color = "#ef4444" }: any) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="value" style={{ color }}>{value}</div>
          <div className="label">{label}</div>
          {sub && <div className="change" style={{ color: sub.startsWith("+") ? "#4ade80" : "#888" }}>{sub}</div>}
        </div>
        <div className="p-2 rounded-lg" style={{ background: `${color}15` }}>
          <Icon size={20} style={{ color }} />
        </div>
      </div>
    </div>
  )
}

// ---------- Post Card ----------
function PostCard({ post }: { post: Post }) {
  const [showInsights, setShowInsights] = useState(false)
  const ins = post.insights
  const isCarousel = post.media_type === "CAROUSEL_ALBUM"
  const isReel = post.media_type === "VIDEO" || post.media_url?.includes(".mp4")

  return (
    <div className="card cursor-pointer" onClick={() => setShowInsights(!showInsights)}>
      <div className="flex gap-4">
        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-surface-2">
          {post.media_url && (
            <img src={post.media_url} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-text-muted">
              {new Date(post.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            {isCarousel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">CAROUSEL</span>}
            {isReel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">REEL</span>}
          </div>
          <p className="text-sm text-gray-300 line-clamp-2">{post.caption || "No caption"}</p>
          <div className="flex gap-4 mt-2 text-xs text-text-muted">
            <span className="flex items-center gap-1"><Heart size={12} /> {post.like_count}</span>
            <span className="flex items-center gap-1"><Activity size={12} /> {post.comments_count}</span>
          </div>
        </div>
      </div>

      {showInsights && ins && (
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
          {ins.impressions > 0 && (
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-200">{ins.impressions.toLocaleString()}</div>
              <div className="text-[10px] text-text-muted">Impressions</div>
            </div>
          )}
          {ins.reach > 0 && (
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-200">{ins.reach.toLocaleString()}</div>
              <div className="text-[10px] text-text-muted">Reach</div>
            </div>
          )}
          {ins.saved > 0 && (
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-200">{ins.saved}</div>
              <div className="text-[10px] text-text-muted">Saves</div>
            </div>
          )}
          {ins.likes > 0 && (
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-200">{ins.likes}</div>
              <div className="text-[10px] text-text-muted">Likes</div>
            </div>
          )}
          {ins.comments > 0 && (
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-200">{ins.comments}</div>
              <div className="text-[10px] text-text-muted">Comments</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Post Composer ----------
function PostComposer({ onClose, onPublish }: { onClose: () => void; onPublish: (caption: string, file: File | null) => void }) {
  const [caption, setCaption] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setPreview(URL.createObjectURL(f))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="card w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">New Post</h2>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-2">Image</label>
          {preview ? (
            <div className="relative">
              <img src={preview} alt="" className="w-full h-48 object-cover rounded-lg" />
              <button className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 text-xs"
                onClick={() => { setFile(null); setPreview(null) }}>✕</button>
            </div>
          ) : (
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-red-600 transition-colors">
              <Image size={32} className="mx-auto mb-2 text-text-muted" />
              <div className="text-sm text-text-muted">Drop an image or click to browse</div>
              <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </label>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-muted mb-2">Caption</label>
          <textarea
            className="input-field h-32 resize-none"
            placeholder="Write your caption..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <div className="text-right text-xs text-text-muted mt-1">{caption.length} / 2200</div>
        </div>

        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!file} onClick={() => onPublish(caption, file)}>
            <Send size={14} className="inline mr-1" /> Publish
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Inspiration Panel ----------
const EXAMPLE_POSTS = [
  {
    title: "What Actually Goes in a Film Budget",
    caption: "Your film budget is more than a spreadsheet. Above the Line: story, producer, director, cast. Below the Line: crew, camera, lighting, locations.",
    pillar: "Budget School",
    engagement: "High",
  },
  {
    title: "Why Subscription Pricing Hurts Filmmakers",
    caption: "You're paying $489/year for something that should cost $49 once. Gary Budgets: $49. One time. Forever.",
    pillar: "One-Time Revolution",
    engagement: "High",
  },
  {
    title: "I Built Gary Budgets Because Spreadsheets Broke Me",
    caption: "I almost quit filmmaking because of a spreadsheet. So I built a budgeting tool that feels like a film set, not a CPA office.",
    pillar: "Behind the Build",
    engagement: "Medium",
  },
  {
    title: "5 Hidden Costs That Kill Indie Films",
    caption: "Most indie films blow 30% of their budget on things nobody planned for. Here's what to watch for.",
    pillar: "Budget School",
    engagement: "High",
  },
]

// ---------- Main Dashboard ----------
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("overview")
  const [showComposer, setShowComposer] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/instagram")
      if (!r.ok) {
        const e = await r.json()
        throw new Error(e.error || "Failed to fetch")
      }
      setData(await r.json())
      setError(null)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const handlePublish = async (caption: string, file: File | null) => {
    if (!file) return
    // Convert to base64 for upload
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = (e.target?.result as string).split(",")[1]
      try {
        const r = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption, image_base64: base64, filename: file.name }),
        })
        const result = await r.json()
        if (result.error) throw new Error(result.error)
        setShowComposer(false)
        fetchData()
      } catch (err: any) {
        alert("Publish failed: " + err.message)
      }
    }
    reader.readAsDataURL(file)
  }

  // Chart data
  const chartData = data?.posts
    .filter((p) => p.insights?.impressions)
    .map((p) => ({
      date: new Date(p.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      impressions: p.insights?.impressions || 0,
      reach: p.insights?.reach || 0,
      engagement: ((p.like_count + p.comments_count) / (p.insights?.reach || 1) * 100).toFixed(1),
    }))
    .reverse() || []

  const response = (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Top Bar */}
      <header className="border-b border-border bg-surface sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-xs font-bold">GB</div>
            <h1 className="text-lg font-bold">Command Center</h1>
          </div>
          <div className="flex items-center gap-4">
            {data && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Users size={14} />
                <span>{data.account.followers}</span>
              </div>
            )}
            <button onClick={fetchData} className="btn-secondary p-2" title="Refresh">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Tab Navigation */}
        <div className="tab-list mb-6 inline-flex">
          {["overview", "posts", "compose", "queue", "inspire"].map((tab) => {
            const labels: Record<string, string> = {
              overview: "Overview", posts: "Post History", compose: "Compose",
              queue: "Queue", inspire: "Inspiration",
            }
            return (
              <button key={tab} className={`tab-trigger ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}>
                {labels[tab]}
              </button>
            )
          })}
        </div>

        {/* Loading State */}
        {loading && !data && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="shimmer h-28" />
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="card text-center py-12">
            <div className="text-red-400 text-lg font-semibold mb-2">Connection Error</div>
            <p className="text-text-muted text-sm mb-4">{error}</p>
            <p className="text-text-muted text-xs mb-4">Make sure INSTAGRAM_ACCESS_TOKEN is configured in the environment.</p>
            <button className="btn-primary" onClick={fetchData}>Retry</button>
          </div>
        )}

        {/* ====== OVERVIEW TAB ====== */}
        {activeTab === "overview" && data && (
          <>
            {/* Account Header */}
            <div className="card mb-6">
              <div className="flex items-center gap-4">
                <img src={data.account.profile_picture} alt="" className="w-14 h-14 rounded-full border-2 border-red-600" />
                <div>
                  <h2 className="text-xl font-bold">@{data.account.username}</h2>
                  <p className="text-sm text-text-muted">
                    {data.account.media_count} posts · {data.account.followers} followers · {data.account.follows} following
                  </p>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard icon={Eye} label="Reach (7d)" value={data.insights.reach?.toLocaleString() || "0"} color="#60a5fa" />
              <StatCard icon={BarChart3} label="Profile Views" value={data.insights.profile_views?.toLocaleString() || "0"} color="#a78bfa" />
              <StatCard icon={Users} label="Followers" value={data.account.followers.toLocaleString()} color="#ef4444" />
              <StatCard icon={MousePointerClick} label="Website Clicks" value={data.insights.website_clicks?.toLocaleString() || "0"} color="#fbbf24" />
              <StatCard icon={Activity} label="Engaged Accounts" value={data.insights.accounts_engaged?.toLocaleString() || "0"} color="#4ade80" />
              <StatCard icon={Share2} label="Total Interactions" value={data.insights.total_interactions?.toLocaleString() || "0"} color="#34d399" />
              <StatCard icon={TrendingUp} label="Views" value={data.insights.views?.toLocaleString() || "0"} color="#38bdf8" />
              <StatCard icon={Image} label="Total Posts" value={data.account.media_count.toString()} color="#f472b6" />
            </div>

            {/* Performance Chart */}
            {chartData.length > 1 && (
              <div className="card mb-6">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">Post Performance</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="reachGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="date" stroke="#555" fontSize={11} />
                    <YAxis stroke="#555" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#888" }}
                    />
                    <Area type="monotone" dataKey="impressions" stroke="#ef4444" fill="url(#reachGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="reach" stroke="#60a5fa" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Recent Posts */}
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-200 mb-4">Recent Posts</h3>
              {data.posts.length === 0 ? (
                <p className="text-text-muted text-sm">No posts yet. Start creating!</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {data.posts.map((p) => <PostCard key={p.id} post={p} />)}
                </div>
              )}
            </div>
          </>
        )}

        {/* ====== POST HISTORY TAB ====== */}
        {activeTab === "posts" && data && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">All Posts</h3>
            {data.posts.length === 0 ? (
              <p className="text-text-muted text-sm">No posts yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.posts.map((p) => <PostCard key={p.id} post={p} />)}
              </div>
            )}
            {chartData.length > 1 && (
              <div className="mt-6">
                <h4 className="text-xs font-semibold text-gray-300 mb-3">Performance Trend</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="date" stroke="#555" fontSize={11} />
                    <YAxis stroke="#555" fontSize={11} />
                    <Tooltip contentStyle={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="impressions" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="engagement" stroke="#4ade80" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ====== COMPOSE TAB ====== */}
        {activeTab === "compose" && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Compose New Post</h3>
            <PostComposerFull onPublish={handlePublish} />
          </div>
        )}

        {/* ====== QUEUE TAB ====== */}
        {activeTab === "queue" && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-200">Post Queue</h3>
              <button className="btn-primary text-xs" onClick={() => setActiveTab("compose")}>
                <Plus size={14} className="inline mr-1" /> New Post
              </button>
            </div>

            {/* Queue from manifest */}
            <QueueView />
          </div>
        )}

        {/* ====== INSPIRATION TAB ====== */}
        {activeTab === "inspire" && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Inspiration & Examples</h3>
            <p className="text-xs text-text-muted mb-6">
              Example post structures from the Gary Budgets content pipeline. Click any to load it into the composer.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {EXAMPLE_POSTS.map((ex, i) => (
                <div key={i} className="border border-border rounded-lg p-4 hover:border-red-800 transition-colors cursor-pointer"
                  onClick={() => {
                    setActiveTab("compose")
                    // The PostComposerFull will pick this up
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded ${
                      ex.pillar === "Budget School" ? "bg-blue-900/30 text-blue-400" :
                      ex.pillar === "One-Time Revolution" ? "bg-amber-900/30 text-amber-400" :
                      "bg-purple-900/30 text-purple-400"
                    }`}>{ex.pillar}</span>
                    <span className="text-[10px] text-text-muted">{ex.engagement} engagement</span>
                  </div>
                  <h4 className="text-sm font-semibold text-gray-200 mb-1">{ex.title}</h4>
                  <p className="text-xs text-text-muted line-clamp-2">{ex.caption}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Global Composer Modal */}
      {showComposer && (
        <PostComposer onClose={() => setShowComposer(false)} onPublish={handlePublish} />
      )}
    </div>
  )

  return response as any
}

// ---------- Queue View ----------
function QueueView() {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/queue")
      .then((r) => r.json())
      .then((d) => setQueue(d.posts || d.queue || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="shimmer h-32" />

  if (queue.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock size={40} className="mx-auto text-text-muted mb-3" />
        <p className="text-text-muted text-sm">Queue is empty</p>
        <p className="text-text-muted text-xs mt-1">Run weekly content generation to populate</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {queue.map((item: any, i: number) => (
        <div key={item.id || i} className="queue-item">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-gray-200">{item.title || item.caption?.slice(0, 50)}</h4>
              <span className={`badge badge-${item.status === "ready" ? "ready" : item.posted ? "posted" : "draft"}`}>
                {item.posted ? "Posted" : item.status || "Draft"}
              </span>
            </div>
            <p className="text-xs text-text-muted line-clamp-1">{item.caption?.slice(0, 100)}</p>
            {item.posted_at && <p className="text-[10px] text-text-muted mt-1">Posted {new Date(item.posted_at).toLocaleDateString()}</p>}
          </div>
          {!item.posted && (
            <button className="btn-primary text-xs py-1.5 px-3">
              <Send size={12} className="inline mr-1" /> Publish
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------- Inline Composer ----------
function PostComposerFull({ onPublish }: { onPublish: (caption: string, file: File | null) => void }) {
  const [caption, setCaption] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setFile(f); setPreview(URL.createObjectURL(f)) }
  }

  const handlePublish = async () => {
    if (!file) return
    setPublishing(true)
    await onPublish(caption, file)
    setPublishing(false)
  }

  return (
    <div>
      <div className="mb-4">
        <label className="block text-xs text-text-muted mb-2">Image</label>
        {preview ? (
          <div className="relative inline-block">
            <img src={preview} alt="" className="h-48 rounded-lg" />
            <button className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-6 h-6 text-xs"
              onClick={() => { setFile(null); setPreview(null) }}>✕</button>
          </div>
        ) : (
          <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-red-600 transition-colors max-w-md">
            <Image size={28} className="mx-auto mb-2 text-text-muted" />
            <div className="text-sm text-text-muted">Drop image or click to browse</div>
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
        )}
      </div>

      <div className="mb-4 max-w-2xl">
        <label className="block text-xs text-text-muted mb-2">Caption</label>
        <textarea className="input-field h-40 resize-none" placeholder="Write your caption..."
          value={caption} onChange={(e) => setCaption(e.target.value)} />
        <div className="flex justify-between text-xs text-text-muted mt-1">
          <span>{caption.length} / 2200</span>
          <span>~{(caption.split(" ").filter(Boolean).length)} words</span>
        </div>
      </div>

      <button className="btn-primary" disabled={!file || publishing} onClick={handlePublish}>
        {publishing ? "Publishing..." : <><Send size={14} className="inline mr-1" /> Publish to Instagram</>}
      </button>
    </div>
  )
}
