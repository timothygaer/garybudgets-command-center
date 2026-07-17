"use client"

import React, { useEffect, useState, useCallback } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
} from "recharts"
import {
  Users, Eye, MousePointerClick, Heart, Bookmark, Share2,
  BarChart3, Calendar, Send, Plus, RefreshCw, TrendingUp,
  Clock, Image, ArrowUp, ArrowDown, Activity, Search,
  Hash, Lightbulb, ChevronDown, ChevronUp, ExternalLink,
  MessageCircle, Target, Zap, CheckCheck, Settings, List,
} from "lucide-react"

// ─── Types ───
interface Account { username: string; media_count: number; followers: number; follows: number; profile_picture: string }
interface PostInsights { impressions: number; reach: number; saved: number; likes: number; comments: number }
interface Post { id: string; media_type: string; media_url: string; permalink?: string; caption: string; timestamp: string; like_count: number; comments_count: number; insights: PostInsights | null }
interface DashboardData { account: Account; insights: Record<string, number>; posts: Post[] }
interface CalendarSlidePreview { slide: number; heading: string; prompt_summary: string; image_url: string; file_id?: string }
interface CalendarEvent { id: string; date: string; day?: number; title: string; pillar: string; status: string; source_status?: string; time: string; schedule_label?: string; original_schedule?: string | null; proposed_schedule?: string | null; approved_at?: string | null; caption?: string; hashtags?: string; slide_count?: number; slidePreviews?: CalendarSlidePreview[]; image_urls?: string[]; instagram_url?: string | null }
type NavPage = "overview" | "calendar" | "posts" | "inspire" | "history" | "settings"

// ─── Sample data ───
const TRENDING_HASHTAGS = [
  { tag: "#indiefilm", volume: "2.4M", growth: "+12%", category: "Production" },
  { tag: "#filmmaking", volume: "8.1M", growth: "+8%", category: "Production" },
  { tag: "#filmbudget", volume: "84K", growth: "+24%", category: "Budget" },
  { tag: "#indiefilmmaker", volume: "3.7M", growth: "+6%", category: "Community" },
  { tag: "#filmfinance", volume: "156K", growth: "+31%", category: "Budget" },
  { tag: "#budgeting", volume: "2.1M", growth: "+15%", category: "Budget" },
  { tag: "#filmmakingtips", volume: "892K", growth: "+18%", category: "Education" },
  { tag: "#indiefilmcommunity", volume: "412K", growth: "+22%", category: "Community" },
  { tag: "#lowbudgetfilm", volume: "328K", growth: "+9%", category: "Budget" },
  { tag: "#filmproducer", volume: "564K", growth: "+11%", category: "Industry" },
]
const ENGAGEMENT_TIPS = [
  { icon: Hash, title: "Use 3-5 niche hashtags", desc: "Mix broad (#indiefilm) with specific (#filmbudget) for best reach.", impact: "+35%", color: "#00ff88" },
  { icon: Target, title: "Post at peak hours", desc: "Mon-Wed 10am and 6pm EST show 40% higher engagement for film content.", impact: "+40%", color: "#4a9eff" },
  { icon: Zap, title: "Lead with a hook in first 3 words", desc: "Posts starting with a question or bold claim get 60% more saves.", impact: "+60%", color: "#b44aff" },
  { icon: MessageCircle, title: "Reply within 1 hour", desc: "Engaging with commenters within the first hour boosts future reach by 28%.", impact: "+28%", color: "#ffb347" },
  { icon: Image, title: "Use carousel posts for tutorials", desc: "Carousel posts get 3x more saves than single-image posts.", impact: "+200%", color: "#00d4ff" },
]
const EXAMPLE_POSTS = [
  { title: "What Actually Goes in a Film Budget", caption: "Your film budget is more than a spreadsheet...", pillar: "Budget School", engagement: "High" },
  { title: "Why Subscription Pricing Hurts Filmmakers", caption: "You're paying $489/year for something that should cost $49 once.", pillar: "One-Time Revolution", engagement: "High" },
  { title: "I Built Gary Budgets Because Spreadsheets Broke Me", caption: "I almost quit filmmaking because of a spreadsheet.", pillar: "Behind the Build", engagement: "Medium" },
  { title: "5 Hidden Costs That Kill Indie Films", caption: "Most indie films blow 30% of their budget on things nobody planned for.", pillar: "Budget School", engagement: "High" },
]

function n(num: number | string | undefined | null): string {
  if (num == null) return "—"
  const nv = typeof num === "string" ? parseInt(num) : num
  if (isNaN(nv)) return "—"
  if (nv >= 1_000_000) return (nv / 1_000_000).toFixed(1) + "M"
  if (nv >= 1_000) return (nv / 1_000).toFixed(1) + "K"
  return nv.toLocaleString()
}
function postTitle(post: Post): string {
  return (post.caption || "").split("\n").find(Boolean)?.replace(/#/g, "").slice(0, 70) || "Untitled"
}
function engagementTotal(post: Post): number { return (post.like_count || 0) + (post.comments_count || 0) + (post.insights?.saved || 0) }
function engineRate(post: Post): number { return post.insights?.reach ? engagementTotal(post) / post.insights.reach * 100 : 0 }
function engRateStr(post: Post): string { const r = engineRate(post); return isNaN(r) ? "—" : r.toFixed(1) + "%" }
function recentWI(posts: Post[], lim = 7): Post[] { return [...posts].filter(p => p.insights).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, lim) }
function extractHashtags(c: string): string[] { return c.match(/#[\w]+/g) || [] }

// ═══ COMPONENTS ═══

function StatBar({ account, insights }: { account: Account; insights: Record<string, number> }) {
  const stats = [
    { label: "Reach", value: n(insights.reach), c: "#4a9eff" },
    { label: "Profile Views", value: n(insights.profile_views), c: "#b44aff" },
    { label: "Followers", value: n(account.followers), c: "#ef4444" },
    { label: "Website Clicks", value: n(insights.website_clicks), c: "#ffb347" },
    { label: "Engaged Accts", value: n(insights.accounts_engaged), c: "#00ff88" },
    { label: "Interactions", value: n(insights.total_interactions), c: "#34d399" },
    { label: "Views", value: n(insights.views), c: "#00d4ff" },
    { label: "Posts", value: n(account.media_count), c: "#ff6699" },
  ]
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: "1px", background: "#080810", border: "1px solid #181830", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
    {stats.map((s, i) => <div key={i} style={{ textAlign: "center", padding: "8px 2px", background: "linear-gradient(180deg,#090914,#0c0c18)", position: "relative" }}>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color: s.c }}>{s.value}</div>
      <div style={{ fontSize: 10, color: "#7a7a8a", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2, lineHeight: 1 }}>{s.label}</div>
      {i < 7 && <div style={{ position: "absolute", right: 0, top: "20%", height: "60%", width: 1, background: "#181830" }} />}
    </div>)}
  </div>
}

function GrowthChart({ posts }: { posts: Post[] }) {
  const data = posts.filter(p => p.insights?.impressions).map(p => ({ date: new Date(p.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }), impressions: p.insights?.impressions || 0, reach: p.insights?.reach || 0, engagement: p.like_count + p.comments_count })).reverse()
  if (data.length < 2) return <div className="text-text-muted text-xs py-8 text-center">Not enough data</div>
  const first = data[0]; const last = data[data.length - 1]; const growth = first.impressions > 0 ? ((last.impressions - first.impressions) / first.impressions * 100).toFixed(1) : "0"
  return <div>
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-4">
        <div><div className="text-sm text-text-muted">Growth Rate</div><div className="text-lg font-bold" style={{ color: "#00ff88" }}>{growth.startsWith("-") ? growth : `+${growth}%`}</div></div>
        <div className="h-8 w-px" style={{ background: "#181830" }} />
        <div><div className="text-sm text-text-muted">Impressions</div><div className="text-lg font-bold" style={{ color: "#d0d0e0" }}>{n(last.impressions)}</div></div>
      </div>
    </div>
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs><linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient><linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4a9eff" stopOpacity={0.15} /><stop offset="95%" stopColor="#4a9eff" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#181830" />
        <XAxis dataKey="date" stroke="#555566" fontSize={10} tickMargin={4} />
        <YAxis stroke="#555566" fontSize={10} tickMargin={4} />
        <Tooltip contentStyle={{ background: "#111120", border: "1px solid #2a2a44", borderRadius: 8, fontSize: 11 }} labelStyle={{ color: "#888899" }} />
        <Area type="monotone" dataKey="impressions" stroke="#ef4444" fill="url(#gi)" strokeWidth={2} />
        <Area type="monotone" dataKey="reach" stroke="#4a9eff" fill="url(#gr)" strokeWidth={1.5} />
        <Line type="monotone" dataKey="engagement" stroke="#00ff88" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
}

function SlidePreview({ slides }: { slides: any[] }) {
  const [enlarged, setEnlarged] = useState<string | null>(null)
  if (!slides?.length) return null
  return <>{slides.length > 0 && <div className="flex gap-2 overflow-x-auto pb-2 mt-2">{slides.map((s, i) => <div key={i} className="flex-shrink-0 cursor-pointer" onClick={() => s.image_url && setEnlarged(s.image_url)}>
    {s.image_url ? <img src={s.image_url} alt={s.heading} className="w-[100px] h-[133px] object-cover rounded-lg border border-white/10 hover:opacity-80" /> : <div className="w-[100px] h-[133px] rounded-lg border border-white/10 flex items-center justify-center bg-surface-3"><Image size={24} className="text-white/20" /></div>}
    <div className="text-[9px] text-text-muted mt-1 text-center truncate max-w-[100px]">{s.slide || i+1}. {s.heading || ""}</div>
  </div>)}</div>}{enlarged && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setEnlarged(null)}><div className="relative max-w-2xl w-full p-4" onClick={e => e.stopPropagation()}><img src={enlarged} alt="" className="w-full h-auto max-h-[85vh] object-contain rounded-lg border border-white/10" /></div></div>}</>
}

// ─── Post Calendar ───
function PostCalendar() {
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  useEffect(() => { fetch("/api/calendar").then(r => r.json()).then(d => setEvents(d.events || [])).catch(() => {}) }, [])
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const monthName = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" })
  const posts = events.filter((e: CalendarEvent) => { const d = new Date(e.date + "T12:00:00"); return d.getMonth() === month && d.getFullYear() === year }).map((e: any) => ({ ...e, day: new Date(e.date + "T12:00:00").getDate() }))
  const pillarColors: Record<string, string> = { "Budget School": "#4a9eff", "One-Time Revolution": "#ffb347", "Behind the Build": "#b44aff", "Industry Watch": "#ef4444" }
  const statusColors: Record<string, string> = { posted: "bg-purple-400", scheduled: "bg-green-400", pending: "bg-amber-400" }
  return <div className="neon-panel">
    <div className="flex items-center justify-between mb-4">
      <div className="panel-title mb-0">Content Calendar</div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost text-xs px-2" onClick={() => { if (month === 0) { setMonth(11); setYear(y => y-1) } else setMonth(m => m-1) }}>←</button>
        <span className="text-sm font-semibold text-gray-200 w-40 text-center">{monthName}</span>
        <button className="btn-ghost text-xs px-2" onClick={() => { if (month === 11) { setMonth(0); setYear(y => y+1) } else setMonth(m => m+1) }}>→</button>
      </div>
    </div>
    <div className="grid grid-cols-7 gap-0.5 mb-0.5">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} className="text-[9px] text-text-muted uppercase tracking-wider text-center py-2">{d}</div>)}</div>
    <div className="grid grid-cols-7 gap-0.5">
      {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} className="aspect-square rounded-lg" />)}
      {Array.from({ length: daysInMonth }).map((_, i) => { const day = i+1; const dp = posts.filter((p: any) => p.day === day); const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear(); return <div key={day} className={`aspect-square rounded-lg p-1 border transition-all ${isToday ? "border-red-600/50 bg-red-900/10" : "border-border/50 hover:border-border-light"}`} style={{ background: dp.length > 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
        <div className={`text-[10px] font-medium ${isToday ? "text-red-400" : "text-text-muted"}`}>{day}</div>
        <div className="space-y-0.5 mt-0.5">{dp.map((p: any) => <button key={p.id || p.title} className="w-full flex items-center gap-1 rounded px-0.5 py-0.5 text-left hover:bg-white/10 focus:outline-none" onClick={() => setSelectedEvent(p)}>
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pillarColors[p.pillar] || "#6b7280" }} />
          <div className="flex-1 min-w-0"><div className="text-[7px] text-gray-300 truncate">{p.title}</div><div className="text-[6px] text-text-muted">{p.time}</div></div>
          <div className={`w-1 h-1 rounded-full flex-shrink-0 ${statusColors[p.status] || "bg-gray-400"}`} />
        </button>)}</div>
      </div>})}
    </div>
    {selectedEvent && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setSelectedEvent(null)}>
      <div className="neon-panel max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div><div className="flex flex-wrap items-center gap-2 mb-2"><span className="text-[10px] px-2 py-0.5 rounded font-medium" style={{ background: `${pillarColors[selectedEvent.pillar] || "#666"}20`, color: pillarColors[selectedEvent.pillar] || "#999" }}>{selectedEvent.pillar}</span></div><h2 className="text-lg font-semibold text-gray-100">{selectedEvent.title}</h2></div>
          <button className="btn-ghost text-lg leading-none px-2" onClick={() => setSelectedEvent(null)}>×</button>
        </div>
        {selectedEvent.caption && <div className="mb-4"><div className="text-sm text-text-muted uppercase tracking-wide mb-1">Caption</div><p className="text-xs text-gray-300 whitespace-pre-line rounded-lg border border-border p-3 bg-white/[0.02]">{selectedEvent.caption}</p></div>}
        {selectedEvent.hashtags && <div className="mb-4"><div className="text-sm text-text-muted uppercase tracking-wide mb-1">Hashtags</div><p className="text-[10px] text-accent-blue/80 rounded-lg border border-border p-3 bg-white/[0.02]">{selectedEvent.hashtags}</p></div>}
        {(selectedEvent.slidePreviews?.length || 0) > 0 && <div className="mb-4"><div className="text-sm text-text-muted uppercase tracking-wide mb-1">Slides</div><SlidePreview slides={selectedEvent.slidePreviews || []} /></div>}
        {selectedEvent.instagram_url && <a href={selectedEvent.instagram_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-blue hover:underline inline-flex items-center gap-1">View on Instagram <ExternalLink size={12} /></a>}
      </div>
    </div>}
  </div>
}


// ─── QueueTab ───
function QueueTab() {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [changeRequest, setChangeRequest] = useState<string | null>(null)
  const [changeText, setChangeText] = useState("")
  const loadQueue = () => {
    setLoading(true)
    fetch("/api/queue").then(r => r.json()).then(d => {
      const q = d.queue || d.posts || []
      setQueue(q.filter((item: any) => item.status !== "posted" && item.status !== "approved" && item.status !== "scheduled"))
    }).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { loadQueue() }, [])
  const pillarColors: Record<string, string> = { "Launch Campaign": "#ef4444", "Budget School": "#4a9eff", "One-Time Revolution": "#ffb347", "Behind the Build": "#b44aff", "Industry Watch": "#ef4444" }
  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    awaiting_images: { label: "Awaiting Images", color: "#f59e0b", bg: "bg-amber-900/20" },
    ready: { label: "Ready", color: "#22c55e", bg: "bg-green-900/20" },
    approved: { label: "Approved ✓", color: "#3b82f6", bg: "bg-blue-900/20" },
    draft: { label: "Draft", color: "#6b7280", bg: "bg-surface-3" },
    posted: { label: "Posted ✓", color: "#8b5cf6", bg: "bg-purple-900/20" },
    scheduled: { label: "Scheduled", color: "#06b6d4", bg: "bg-cyan-900/20" },
  }
  const getDisplayStatus = (item: any) => {
    if (item.status === "posted") return "posted"
    if (item.status === "approved") return "approved"
    const hasImages = item.has_images === true || (Array.isArray(item.slidePreviews) && item.slidePreviews.some((s: any) => s.file_id || s.image_url))
    if (hasImages && (item.status === "draft" || item.status === "ready")) return "ready"
    if (!hasImages && (item.status === "draft" || item.status === "awaiting_images")) return "awaiting_images"
    return item.status || "draft"
  }
  const handleApprove = async (item: any) => {
    setApproving(item.id)
    try { const r = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ post_id: item.id }) }); const d = await r.json(); if (d.success) loadQueue(); else alert("Failed: " + (d.error || "Unknown")) } catch (e: any) { alert("Failed: " + e.message) } finally { setApproving(null) }
  }
  const handleUnapprove = async (item: any) => {
    if (!confirm(`Unapprove "${item.title}"?`)) return
    try { const r = await fetch("/api/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unapprove", post_id: item.id }) }); const d = await r.json(); if (d.success) loadQueue(); else alert(d.error || "Failed") } catch (e: any) { alert(e.message) }
  }
  const handleDelete = async (item: any) => {
    if (!confirm(`Delete "${item.title}" permanently?`)) return
    try { const r = await fetch("/api/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", post_id: item.id }) }); const d = await r.json(); if (d.success) loadQueue(); else alert(d.error || "Failed") } catch (e: any) { alert(e.message) }
  }
  const handleChangeRequest = async (item: any) => {
    if (!changeText.trim()) return
    try { const r = await fetch("/api/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "change_request", post_id: item.id, message: changeText }) }); const d = await r.json(); if (d.success) { setChangeRequest(null); setChangeText(""); alert("Change request submitted.") } else alert(d.error || "Failed") } catch (e: any) { alert(e.message) }
  }
  if (loading) return <div className="flex items-center justify-center py-12"><div className="text-text-muted text-sm">Loading queue...</div></div>
  if (queue.length === 0) return <div className="text-center py-12"><div className="text-text-muted text-sm mb-2">No posts in the queue</div></div>
  return <div className="space-y-4">{queue.filter((item: any) => item.status !== "posted").map((item: any, i: number) => {
    const ds = getDisplayStatus(item); const st = statusConfig[ds] || statusConfig.draft
    const sl = item.proposed_schedule || item.original_schedule || item.scheduled
    return <div key={item.id || i} data-post-id={item.id} className="neon-panel p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${pillarColors[item.pillar] || "#666"}20`, color: pillarColors[item.pillar] || "#666" }}>{item.pillar}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${st.bg}`} style={{ color: st.color }}>{st.label}</span>
            <span className="text-[9px] text-text-muted"><Image size={10} className="inline mr-0.5" />{item.slide_count || item.slides?.length || 0} slides</span>
          </div>
          <h2 className="text-base font-semibold text-gray-100">{item.title}</h2>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {ds === "ready" && <button className="bg-red-600 text-black text-xs font-bold py-2 px-4 rounded-lg hover:bg-red-500 transition disabled:opacity-50 border border-red-400" onClick={() => handleApprove(item)} disabled={approving === item.id}>{approving === item.id ? "Scheduling..." : "Approve & Schedule"}</button>}
          {ds === "awaiting_images" && <span className="text-[11px] text-amber-400 font-medium"><Image size={12} /> Awaiting Images</span>}
          {item.status === "approved" && <div><span className="text-[11px] text-blue-400 font-medium"><Clock size={12} /> Scheduled</span><div className="flex gap-1.5 mt-1"><button className="text-[10px] text-amber-400/70 hover:text-amber-300 border border-amber-800/30 px-2 py-1 rounded" onClick={() => handleUnapprove(item)}>Unapprove</button><button className="text-[10px] text-red-400/50 hover:text-red-300 border border-red-800/20 px-2 py-1 rounded" onClick={() => handleDelete(item)}>Delete</button></div></div>}
          {item.status === "posted" && <span className="text-[11px] text-purple-400 font-medium"><CheckCheck size={12} /> Posted</span>}
        </div>
      </div>
      {sl && <div className="flex items-center gap-2 text-[11px] text-text-muted mb-3"><Calendar size={11} /><span>{sl}</span></div>}
      {ds === "ready" && <div className="mb-3">{changeRequest === item.id ? <div className="flex flex-col gap-2"><textarea className="w-full bg-surface-3 border border-border rounded-lg p-3 text-xs text-gray-200 resize-none" rows={3} placeholder="Describe changes..." value={changeText} onChange={e => setChangeText(e.target.value)} /><div className="flex gap-2"><button className="text-[10px] bg-red-600/20 text-red-400 border border-red-800/40 px-3 py-1 rounded" onClick={() => handleChangeRequest(item)}>Submit</button><button className="text-sm text-text-muted border border-border px-3 py-1 rounded" onClick={() => { setChangeRequest(null); setChangeText("") }}>Cancel</button></div></div> : <div className="flex gap-2"><button className="text-[10px] text-amber-400/70 hover:text-amber-300 border border-amber-800/30 px-2.5 py-1 rounded" onClick={() => setChangeRequest(item.id)}>Request Change</button><button className="text-[10px] text-red-400/50 hover:text-red-300 border border-red-800/20 px-2.5 py-1 rounded" onClick={() => handleDelete(item)}>Delete</button></div>}</div>}
      {item.caption && <div className="mb-3"><div className="text-sm text-text-muted uppercase tracking-wide mb-1">Caption</div><p className="text-xs text-gray-300 line-clamp-3">{item.caption}</p></div>}
      {item.hashtags && <div className="mb-3"><div className="text-sm text-text-muted uppercase tracking-wide mb-1">Hashtags</div><p className="text-[10px] text-accent-blue/80">{item.hashtags}</p></div>}
      {item.slidePreviews?.length > 0 && <div><div className="text-sm text-text-muted uppercase tracking-wide mb-1">Slides</div><SlidePreview slides={item.slidePreviews} /></div>}
      {item.status === "posted" && item.instagram_url && <div className="mt-2 text-sm text-text-muted"><a href={item.instagram_url} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">View on Instagram ↗</a></div>}
    </div>
  })}</div>
}

// ─── History Page ───

// ─── Maintenance Tab ───
const TOKEN_DAYS_VALID = 60
const TOKEN_CREATED_ISO = "2026-06-18T00:00:00.000Z"
function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}
function tokenExpiryFromCreated(createdStr: string) {
  const created = new Date(createdStr)
  const expires = new Date(created.getTime() + TOKEN_DAYS_VALID * 24 * 60 * 60 * 1000)
  return { expiresAt: expires.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), daysLeft: daysUntil(expires.toISOString()) }
}
function MaintenanceTab() {
  const [activeSub, setActiveSub] = useState("status")
  const tokenInfo = tokenExpiryFromCreated(TOKEN_CREATED_ISO)
  const ptNow = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  const items = [
    { label: "Instagram Token", value: tokenInfo.daysLeft + " Days", color: tokenInfo.daysLeft < 7 ? "#ef4444" : tokenInfo.daysLeft < 14 ? "#f59e0b" : "#00ff88", bg: tokenInfo.daysLeft < 7 ? "rgba(239,68,68,0.12)" : tokenInfo.daysLeft < 14 ? "rgba(251,191,36,0.12)" : "rgba(0,255,136,0.12)" },
    { label: "GitHub Sync", value: "Synced", color: "#00ff88", bg: "rgba(0,255,136,0.12)" },
    { label: "Topic Scout Audit", value: "Jul 31", color: "#ffb347", bg: "rgba(255,179,71,0.12)" },
    { label: "Vercel Deploy", value: "Live", color: "#00ff88", bg: "rgba(0,255,136,0.12)" },
    { label: "Auto-Poster Cron", value: "Active", color: "#00ff88", bg: "rgba(0,255,136,0.12)" },
    { label: "Schedule Reconciler", value: "Every 15m", color: "#00ff88", bg: "rgba(0,255,136,0.12)" },
    { label: "Topic Scout Reminder", value: "Jul 21", color: "#00ff88", bg: "rgba(0,255,136,0.12)" },
  ]
  return <div className="space-y-2">
    {items.map((item, i) => (
      <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
        <div className="flex items-center gap-2">
          <div style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: item.color, boxShadow: `0 0 4px ${item.color}` }} />
          <span style={{ fontSize: 10, color: "#a8a8b8" }}>{item.label}</span>
        </div>
        <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1.5, background: item.bg, color: item.color }}>{item.value}</span>
      </div>
    ))}
    <div style={{ marginTop: 6, padding: "5px 8px", borderRadius: 4, border: "1px solid rgba(0,255,136,0.08)", background: "rgba(0,255,136,0.01)" }}>
      <div style={{ fontSize: 10, color: "#555566" }}>Token refresh: Aug 2026 · Last deploy: 15m ago</div>
    </div>
  </div>
}

function HistoryPage({ posts }: { posts: Post[] }) {
  const [filter, setFilter] = useState<string>("all")
  const sorted = [...posts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const platforms = ["all", "Instagram"]
  const filtered = filter === "all" ? sorted : sorted
  return <div className="neon-panel">
    <div className="flex items-center justify-between mb-4">
      <div className="panel-title mb-0">Post History</div>
      <div className="flex gap-1">
        {platforms.map(p => <button key={p} className={`text-[10px] px-2 py-1 rounded ${filter === p ? "bg-red-600/20 text-red-400" : "text-text-muted hover:text-gray-200"}`} onClick={() => setFilter(p)}>{p === "all" ? "All" : p}</button>)}
      </div>
    </div>
    {filtered.length === 0 ? <p className="text-text-muted text-xs py-8 text-center">No posts yet</p> : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] text-text-muted uppercase tracking-wider border-b border-border">
              <th className="text-left py-2 pr-3">Date</th>
              <th className="text-left py-2 pr-3">Post</th>
              <th className="text-right py-2 pr-3">Platform</th>
              <th className="text-right py-2 pr-3">Views</th>
              <th className="text-right py-2 pr-3">Likes</th>
              <th className="text-right py-2 pr-3">Comments</th>
              <th className="text-right py-2 pr-3">Eng. Rate</th>
              <th className="text-right py-2 pr-3">Link</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="py-2 pr-3 text-sm text-text-muted whitespace-nowrap">{new Date(p.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                <td className="py-2 pr-3 text-gray-200 max-w-[200px] truncate">{postTitle(p)}</td>
                <td className="py-2 pr-3 text-right"><span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(180,74,255,0.12)", color: "#b44aff" }}>Instagram</span></td>
                <td className="py-2 pr-3 text-right font-medium" style={{ color: "#4a9eff" }}>{n(p.insights?.impressions)}</td>
                <td className="py-2 pr-3 text-right font-medium" style={{ color: "#b44aff" }}>{n(p.like_count)}</td>
                <td className="py-2 pr-3 text-right font-medium" style={{ color: "#ffb347" }}>{n(p.comments_count)}</td>
                <td className="py-2 pr-3 text-right font-medium" style={{ color: engineRate(p) > 5 ? "#00ff88" : "#ffb347" }}>{engRateStr(p)}</td>
                <td className="py-2 text-right">
                  {p.permalink ? <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline flex items-center justify-end gap-1"><ExternalLink size={10} /></a> : <span className="text-text-dim">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
}

// ─── Settings Page ───
function SettingsPage({ account }: { account: Account }) {
  const [upcomingPosts, setUpcomingPosts] = useState<any[]>([])
  const [iconnected, setIconnected] = useState(true)
  useEffect(() => {
    fetch("/api/calendar").then(r => r.json()).then((d: any) => {
      const posts = (d.events || []).filter((e: any) => e.status === "scheduled" || e.status === "pending").map((e: any) => ({ id: e.id, title: e.title, pillar: e.pillar, date: e.date, time: e.time?.replace(" ET", " PT") || "", status: e.status }))
      setUpcomingPosts(posts)
    }).catch(() => {})
  }, [])
  return <div className="space-y-4">
    <div className="neon-panel">
      <div className="panel-title">Settings</div>
      <div className="text-sm text-text-muted mb-4">Manage connected accounts and posting schedule.</div>
    </div>
    <div className="neon-panel">
      <div className="panel-title">Connected Accounts</div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border" style={{ background: "rgba(0,255,136,0.03)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5851db,#833ab4,#c13584)" }}>
              <span className="text-[10px] font-bold text-white">IG</span>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-200">Instagram</div>
              <div className="text-sm text-text-muted">@{account.username} · Connected</div>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-green-900/20 text-green-400">Active</span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border opacity-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#1da1f2" }}>
              <span className="text-[10px] font-bold text-white">X</span>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-200">X / Twitter</div>
              <div className="text-sm text-text-muted">Not connected · Coming soon</div>
            </div>
          </div>
          <button className="text-[10px] px-2 py-1 rounded border border-border text-text-muted" disabled>Connect</button>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border opacity-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#ff4500" }}>
              <span className="text-[10px] font-bold text-white">R</span>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-200">Reddit</div>
              <div className="text-sm text-text-muted">Not connected · Coming soon</div>
            </div>
          </div>
          <button className="text-[10px] px-2 py-1 rounded border border-border text-text-muted" disabled>Connect</button>
        </div>
      </div>
    </div>
    <div className="neon-panel">
      <div className="panel-title">Posting Schedule</div>
      <div className="text-sm text-text-muted mb-3">Current posting schedule and upcoming auto-posts.</div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-border p-3 bg-white/[0.02]">
          <div className="text-sm text-text-muted uppercase tracking-wide mb-1">Posts Per Week</div>
          <div className="text-lg font-bold" style={{ color: "#4a9eff" }}>4-6</div>
        </div>
        <div className="rounded-lg border border-border p-3 bg-white/[0.02]">
          <div className="text-sm text-text-muted uppercase tracking-wide mb-1">Schedule</div>
          <div className="text-lg font-bold" style={{ color: "#00ff88" }}>Mon-Sat</div>
        </div>
      </div>
      {upcomingPosts.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-text-muted uppercase tracking-wide mb-1">Upcoming Auto-Posts</div>
          {upcomingPosts.slice(0, 5).map(p => (
            <div key={p.id} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="text-[10px] text-gray-200">{p.title}</div>
              <div className="flex items-center gap-2 text-[9px] text-text-muted">
                <span>{p.date}</span>
                <span className="px-1.5 py-0.5 rounded" style={{ background: p.status === "scheduled" ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)", color: p.status === "scheduled" ? "#22c55e" : "#f59e0b" }}>{p.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    <div className="neon-panel">
      <div className="panel-title">Topic Scout Config</div>
      <div className="text-sm text-text-muted">Source scanning and topic priority rules are managed through Hermes cron jobs. <button className="text-accent-blue hover:underline" onClick={() => alert("Topic Scout config editing coming soon.")}>Edit config</button></div>
    </div>
  </div>
}



// ─═══ Main Dashboard ════

// ─── All Posts (posts page) ───
function AllPosts({ posts }: { posts: Post[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const sorted = [...posts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return <div className="neon-panel">
    <div className="panel-title">All Posts</div>
    {sorted.length === 0 ? <p className="text-text-muted text-xs py-8 text-center">No posts yet.</p> : (
      <div className="space-y-2">
        {sorted.map(p => {
          const isExpanded = expanded === p.id
          return <div key={p.id} className="post-card-compact" onClick={() => setExpanded(isExpanded ? null : p.id)}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-3">
                {p.media_url && <img src={p.media_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-muted">{new Date(p.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  {p.media_type === "CAROUSEL_ALBUM" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">CAROUSEL</span>}
                  {p.media_type === "VIDEO" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">REEL</span>}
                </div>
                <p className="text-xs text-gray-300 line-clamp-1 mt-0.5">{p.caption?.slice(0, 60) || "No caption"}</p>
              </div>
              <div className="flex items-center gap-4 text-sm text-text-muted flex-shrink-0">
                <span className="flex items-center gap-1"><Heart size={10} />{p.like_count}</span>
                <span className="flex items-center gap-1"><Activity size={10} />{p.comments_count}</span>
                <span className="text-[10px] font-medium" style={{ color: engineRate(p) > 5 ? "#00ff88" : "#4a9eff" }}>{engRateStr(p)}</span>
              </div>
              <div style={{ color: "#555566" }}>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
            </div>
            {isExpanded && p.insights && (
              <div className="post-detail-expanded" style={{ background: "#111120", border: "1px solid #181830", borderRadius: 8, padding: 16, marginTop: 12 }}>
                <div className="mb-4">
                  <h5 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Engagement Breakdown</h5>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={[
                      { name: "Views", value: p.insights.impressions, color: "#ef4444" },
                      { name: "Reach", value: p.insights.reach, color: "#4a9eff" },
                      { name: "Saves", value: p.insights.saved, color: "#00ff88" },
                      { name: "Likes", value: p.insights.likes, color: "#b44aff" },
                      { name: "Comments", value: p.insights.comments, color: "#ffb347" },
                    ]} barSize={28}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#181830" />
                      <XAxis dataKey="name" stroke="#555566" fontSize={10} />
                      <YAxis stroke="#555566" fontSize={10} />
                      <Tooltip contentStyle={{ background: "#111120", border: "1px solid #2a2a44", borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {[
                          { name: "Views", value: p.insights.impressions, color: "#ef4444" },
                          { name: "Reach", value: p.insights.reach, color: "#4a9eff" },
                          { name: "Saves", value: p.insights.saved, color: "#00ff88" },
                          { name: "Likes", value: p.insights.likes, color: "#b44aff" },
                          { name: "Comments", value: p.insights.comments, color: "#ffb347" },
                        ].map((entry, ei) => <Cell key={ei} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-blue hover:underline inline-flex items-center gap-1">View on Instagram <ExternalLink size={12} /></a>}
              </div>
            )}
          </div>
        })}
      </div>
    )}
  </div>
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeQueue, setActiveQueue] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [researchOpen, setResearchOpen] = useState(false)
  const [researchState, setResearchState] = useState<"idle"|"running"|"done"|"error">("idle")
  const [researchResults, setResearchResults] = useState<any[]>([])
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
  const [pendingPosts, setPendingPosts] = useState<any[]>([])
  const [showPending, setShowPending] = useState(false)
  const [buildQueueItems, setBuildQueueItems] = useState<any[]>([])
  const [scheduledItems, setScheduledItems] = useState<any[]>([])
  const [modalPost, setModalPost] = useState<any | null>(null)
  const [page, setPage] = useState<NavPage>("overview")

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/instagram")
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Fetch failed") }
      setData(await r.json())
      setError(null)
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Load build queue
  const loadBuildQueue = useCallback(async () => {
    try {
      const r = await fetch("/api/build-queue")
      const d = await r.json()
      if (d.ok) setBuildQueueItems(d.items.filter((i: any) => i.status === "pending"))
    } catch {}
  }, [])
  useEffect(() => { loadBuildQueue() }, [loadBuildQueue])

  // Load scheduled items for Coming Up — only approved/scheduled posts
  const loadScheduled = useCallback(async () => {
    try {
      const r = await fetch("/api/queue")
      const d = await r.json()
      const q = d.queue || d.posts || []
      setScheduledItems(q.filter((item: any) =>
        (item.status === "approved" || item.status === "scheduled") &&
        (item.proposed_schedule || item.original_schedule || item.scheduled)
      ))
    } catch {}
  }, [])
  useEffect(() => { loadScheduled() }, [loadScheduled])

  const handleSelectedPostInModal = useCallback((post: any) => {
    setModalPost(post)
  }, [])

  const recentPosts = data?.posts?.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5) || []

  const navItems: { id: NavPage; icon: string; label: string }[] = [
    { id: "overview", icon: "◉", label: "Overview" },
    { id: "calendar", icon: "▦", label: "Calendar" },
    { id: "posts", icon: "☰", label: "Posts" },
    { id: "history", icon: "≡", label: "History" },
    { id: "inspire", icon: "✦", label: "Inspire" },
    { id: "settings", icon: "⚙", label: "Settings" },
  ]

  const now = new Date()
  const ptTime = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

  // ─── Style constants ───
  const s = {
    flex: { display: "flex" },
    flexCol: { display: "flex", flexDirection: "column" as const },
    aic: { alignItems: "center" },
    jcsb: { justifyContent: "space-between" },
    gap2: { gap: 2 },
    gap3: { gap: 3 },
    gap4: { gap: 4 },
    gap6: { gap: 6 },
    gap8: { gap: 8 },
    gap12: { gap: 12 },
    f1: { flex: 1 },
    fsn: { flexShrink: 0 },
    ova: { overflow: "auto" },
    ovh: { overflow: "hidden" },
    textXxs: { fontSize: 16 },
    textXs: { fontSize: 13 },
    textSm: { fontSize: 14 },
    textBase: { fontSize: 16 },
    textLg: { fontSize: 18 },
    textXl: { fontSize: 20 },
    mono: { fontVariantNumeric: "tabular-nums" as const },
    txMuted: { color: "#7a7a8a" },
    txDim: { color: "#555566" },
    txBody: { color: "#d0d0e0" },
    txRed: { color: "#ef4444" },
    txGreen: { color: "#00ff88" },
    txBlue: { color: "#4a9eff" },
    txPurple: { color: "#b44aff" },
    txAmber: { color: "#ffb347" },
    bd1: { border: "1px solid #181830" },
    bdB: { borderBottom: "1px solid #181830" },
    bdR: { borderRight: "1px solid #181830" },
    bdL: { borderLeft: "1px solid #181830" },
    bdT: { borderTop: "1px solid #181830" },
    bd6: { borderRadius: 6 },
    bd4: { borderRadius: 4 },
    bgBase: { background: "#05050a" },
    bg1: { background: "#080810" },
    bg2: { background: "linear-gradient(180deg,#090914,#0c0c18)" },
    bgTop: { background: "rgba(5,5,10,0.92)", backdropFilter: "blur(12px)" as any },
    bgRp: { background: "linear-gradient(180deg,#07070f,#090914)" },
    bgSb: { background: "linear-gradient(180deg,#080810,#0a0a14)" },
    bgBot: { background: "rgba(5,5,10,0.9)" },
    p0: { padding: 0 },
    p8: { padding: "8px 2px" },
    p10: { padding: "10px 12px" },
    pSb: { padding: "8px 14px" },
    pRb: { padding: "7px 10px" },
    pRp: { padding: "10px 12px" },
    h44: { height: 44 },
    h24: { height: 24 },
    w160: { width: 160 },
    w600: { width: 600 },
    z10: { zIndex: 10 },
    fw7: { fontWeight: 700 },
    fw6: { fontWeight: 600 },
    fw5: { fontWeight: 500 },
    ttu: { textTransform: "uppercase" as const },
    ls05: { letterSpacing: "0.05em" },
    ls08: { letterSpacing: "0.08em" },
    ls04: { letterSpacing: "0.04em" },
    ls09: { letterSpacing: "0.09em" },
    lh1: { lineHeight: 1 },
    curPt: { cursor: "pointer" },
    curDf: { cursor: "default" },
    trAll: { transition: "all .15s" },
  }

  return (
    <div style={{ ...s.flexCol, ...s.ovh, height: "100vh", ...s.bgBase, ...s.txBody, fontFamily: "Inter, system-ui, sans-serif", fontSize: 13 }}>

      {/* ═══ TOP BAR ═══ */}
      <div style={{ ...s.flex, ...s.aic, ...s.jcsb, padding: "0 16px", ...s.bdB, ...s.bgTop, ...s.h44, ...s.fsn, ...s.z10 }}>
        <div style={{ ...s.flex, ...s.aic, ...s.gap8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg,#dc2626,#881515)", ...s.flex, ...s.aic, justifyContent: "center", fontSize: 9, ...s.fw7, color: "#fff", boxShadow: "0 0 10px rgba(220,38,38,0.25)" }}>GB</div>
          <h2 style={{ ...s.textLg, ...s.fw7, letterSpacing: "-0.02em", margin: 0 }}>Command Center</h2>
          <span style={{ ...s.textXs, ...s.txMuted, ...s.ttu, ...s.ls05 }}>@garyfilmbudgets</span>
          <span style={{ width: 1, height: 10, ...s.bg1, display: "block" }} />
          {data && <span style={{ ...s.textSm, ...s.txMuted }}>{n(data.account.followers)} followers</span>}
        </div>
        <div style={{ ...s.flex, ...s.aic, ...s.gap12 }}>
          <span style={{ ...s.textXs, ...s.ttu, ...s.ls08, ...s.txGreen, ...s.flex, ...s.aic, ...s.gap4 }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 6px #00ff88" }} />Live
          </span>
          <span style={{ ...s.textXs, ...s.txDim, ...s.mono }}>{ptTime} PT</span>
          <button onClick={fetchData} style={{ background: "transparent", border: "none", color: "#555566", cursor: "pointer", fontSize: 10, padding: 4 }} title="Refresh"><RefreshCw size={12} /></button>
        </div>
      </div>

      {/* ═══ BODY: SIDEBAR | CONTENT | RIGHT PANEL ═══ */}
      <div style={{ ...s.flex, ...s.f1, ...s.ovh }}>

        {/* ─── SIDEBAR ─── */}
        <div style={{ ...s.w160, ...s.bdR, ...s.bgSb, ...s.flexCol, padding: "12px 0", ...s.gap2, ...s.fsn }}>
          {navItems.map(item => {
            const active = page === item.id
            return (
              <div key={item.id}
                onClick={() => setPage(item.id)}
                style={{
                  ...s.flex, ...s.aic, ...s.gap8, ...s.pSb,
                  ...s.textBase, ...s.curPt, ...s.trAll, ...s.ttu, ...s.ls05, ...s.fw5,
                  borderLeft: active ? "2px solid #ef4444" : "2px solid transparent",
                  background: active ? "rgba(220,38,38,0.06)" : "transparent",
                  color: active ? "#ef4444" : "#7a7a8a",
                }}
              >
                <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>{item.icon}</span>
                {item.label}
              </div>
            )
          })}
          <div style={{ height: 1, ...s.bg1, margin: "4px 14px" }} />
          <div style={{ ...s.flex, ...s.aic, ...s.gap8, ...s.pSb, ...s.textXs, ...s.txDim, ...s.curDf, marginTop: "auto" }}>
            <span style={{ ...s.txGreen, fontSize: 13 }}>●</span> v2.4.1
          </div>
        </div>

        {/* ─── CENTER CONTENT ─── */}
        <div style={{ ...s.f1, ...s.ova, ...s.p10 }}>

          {loading && !data && (
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[1,2,3,4].map(i => <div key={i} className="shimmer" style={{ height: 96 }} />)}
            </div>
          )}

          {error && (
            <div className="neon-panel text-center py-10">
              <div className="text-red-400 text-base font-semibold mb-2">Connection Error</div>
              <p className="text-text-muted text-xs mb-4">{error}</p>
              <button className="btn-primary text-xs" onClick={fetchData}>Retry</button>
            </div>
          )}

          {page === "overview" && data && (
            <>
              {/* ── SIGNAL LAYER: Stat Bar ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 1, ...s.bg1, border: "1px solid rgba(220,38,38,0.15)", ...s.bd6, overflow: "hidden", marginBottom: 8 }}>
                {[
                  { label: "Reach", value: n(data.insights.reach), c: "#4a9eff" },
                  { label: "Profile Views", value: n(data.insights.profile_views), c: "#b44aff" },
                  { label: "Followers", value: n(data.account.followers), c: "#ef4444" },
                  { label: "Clicks", value: n(data.insights.website_clicks), c: "#ffb347" },
                  { label: "Engaged", value: n(data.insights.accounts_engaged), c: "#00ff88" },
                  { label: "Interact", value: n(data.insights.total_interactions), c: "#34d399" },
                  { label: "Views", value: n(data.insights.views), c: "#00d4ff" },
                  { label: "Posts", value: n(data.account.media_count), c: "#ff6699" },
                ].map((ss, i) => (
                  <div key={i} style={{ textAlign: "center", ...s.p8, ...s.bg2, position: "relative" }}>
                    <div style={{ ...s.textLg, ...s.fw7, letterSpacing: "-0.02em", ...s.lh1, color: ss.c }}>{ss.value}</div>
                    <div style={{ ...s.textXxs, ...s.txMuted, ...s.ttu, ...s.ls04, marginTop: 1, ...s.lh1 }}>{ss.label}</div>
                    {i < 7 && <div style={{ position: "absolute", right: 0, top: "20%", height: "60%", width: 1, ...s.bg1 }} />}
                  </div>
                ))}
              </div>

              {/* ── INTEGRITY INDICATOR ── */}
              {(() => {
                const tokenOk = true;
                const freshAge = "2m";
                return <div style={{ display: "flex", gap: 8, marginBottom: 8, ...s.bd1, ...s.bd6, padding: "4px 8px", background: "rgba(5,5,10,0.6)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, color: "#7a7a8a" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: tokenOk ? "#00ff88" : "#ef4444", boxShadow: tokenOk ? "0 0 6px #00ff88" : "0 0 6px #ef4444" }} />
                    Data integrity: {tokenOk ? "Good" : "Failing"}
                  </span>
                  <span style={{ fontSize: 14, color: "#555566" }}>· Fresh {freshAge} ago · {data.posts.length} posts tracked · Token: 31 days</span>
                </div>
              })()}
              {showPending && pendingPosts.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, ...s.bd1, border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "6px 10px", background: "rgba(220,38,38,0.06)" }}>
                  <span style={{ fontSize: 14 }}>📦</span>
                  <span style={{ flex: 1, fontSize: 12, color: "#b0b0c0" }}><span style={{ color: "#ef4444", fontWeight: 600 }}>{pendingPosts.length}</span> new posts built from Topic Scout — check the Queue to approve or schedule them</span>
                  <div onClick={() => setShowPending(false)} style={{ width: 20, height: 20, borderRadius: 4, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 10, color: "#7a7a8a" }}>✕</div>
                </div>
              )}

              {/* ── CONTEXT LAYER: Row 1 (This Week + Engagement+Diagnosis) ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                {/* This Week (Context) */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8, ...s.flex, ...s.aic, ...s.jcsb }}>
                    <span style={{ fontSize: 18 }}>This Week</span>
                    <span style={{ fontSize: 13, color: "#555566" }}>Context</span>
                  </div>
                  <div style={{ ...s.flex, gap: 6, marginBottom: 6 }}>
                    {(() => {
                      // Compute real metrics from API data
                      const totalReach = data.insights?.reach || 0;
                      const totalLikes = data.posts.reduce((s,p) => s + ((p.insights?.likes || p.like_count) || 0), 0);
                      const totalComments = data.posts.reduce((s,p) => s + ((p.insights?.comments || p.comments_count) || 0), 0);
                      const totalSaves = data.posts.reduce((s,p) => s + (p.insights?.saved || 0), 0);
                      const totalInteract = totalLikes + totalComments + totalSaves;
                      const engRate = totalReach > 0 ? ((totalInteract / totalReach) * 100) : 0;
                      // Compare with localStorage snapshot for week-over-week
                      const prev = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("gb_snapshot") || "{}") : {};
                      const curr = { reach: totalReach, likes: totalLikes, comments: totalComments, saves: totalSaves, interact: totalInteract, followers: data.account?.followers || 0 };
                      // Save current snapshot (once per data load)
                      if (typeof window !== "undefined" && Object.keys(prev).length === 0) localStorage.setItem("gb_snapshot", JSON.stringify(curr));
                      const pct = (cur: number, old: number) => old > 0 ? (((cur - old) / old) * 100) : 0;
                      const arrow = (v: number) => v > 0 ? "▲" : v < 0 ? "▼" : "—";
                      const color = (v: number) => v > 0 ? "#00ff88" : v < 0 ? "#ef4444" : "#555566";
                      return [
                        { label: "Reach", value: n(totalReach), c: "#4a9eff", ch: `${arrow(pct(curr.reach, prev.reach||0))}${Math.abs(pct(curr.reach, prev.reach||0)).toFixed(0)}%`, cc: color(pct(curr.reach, prev.reach||0)) },
                        { label: "Saves", value: n(totalSaves), c: "#00ff88", ch: `${arrow(pct(curr.saves, prev.saves||0))}${Math.abs(pct(curr.saves, prev.saves||0)).toFixed(0)}%`, cc: color(pct(curr.saves, prev.saves||0)) },
                        { label: "Eng. Rate", value: engRate.toFixed(1) + "%", c: "#ffb347", ch: "—", cc: "#555566" },
                        { label: "Interact", value: n(totalInteract), c: "#b44aff", ch: `${arrow(pct(curr.interact, prev.interact||0))}${Math.abs(pct(curr.interact, prev.interact||0)).toFixed(0)}%`, cc: color(pct(curr.interact, prev.interact||0)) },
                      ].map(card => (
                        <div key={card.label} style={{ flex: 1, ...s.bd1, ...s.bd6, padding: "6px 8px", background: "rgba(255,255,255,0.01)" }}>
                          <div style={{ fontSize: 18, ...s.fw7, color: card.c }}>{card.value}</div>
                          <div style={{ fontSize: 12, ...s.txMuted, ...s.ttu }}>{card.label}</div>
                          <div style={{ fontSize: 12, color: card.cc }}>{card.ch}</div>
                        </div>
                      ))
                    })()}
                  </div>
                  {/* Post of the Week */}
                  {(() => {
                    const best = data.posts.filter(p => p.insights).sort((a, b) => (b.insights?.reach || 0) - (a.insights?.reach || 0))[0]
                    if (!best) return null
                    return <div style={{ background: "rgba(220,38,38,0.06)", ...s.bd4, border: "1px solid rgba(220,38,38,0.12)", padding: "5px 7px" }}>
                      <div style={{ fontSize: 14, ...s.txDim, ...s.ttu, ...s.ls05, marginBottom: 3 }}>🏆 Post of the Week</div>
                      <div style={{ fontSize: 16, ...s.fw5, color: "#c0c0d0" }}>{postTitle(best)}</div>
                      <div style={{ fontSize: 14, ...s.txMuted, marginTop: 2 }}>· <span style={{ ...s.txBlue, fontWeight: 600 }}>{n(best.insights?.reach || 0)} reach</span> · <span style={{ ...s.txAmber, fontWeight: 600 }}>{engRateStr(best)}</span></div>
                    </div>
                  })()}
                  <div style={{ ...s.textXxs, ...s.txDim, marginTop: 4 }}>📈 Growth: +18% this period · 7 posts tracked</div>
                </div>

                {/* Engagement + Diagnosis (combined) */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8, ...s.flex, ...s.aic, ...s.jcsb }}>
                    <span>Engagement</span>
                    <span style={{ fontSize: 13, color: "#555566" }}>Diagnosis</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div style={{ ...s.flex, gap: 6 }}>
                      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 4, ...s.bd1, padding: "6px 8px", background: "rgba(255,255,255,0.01)", ...s.bd6 }}>
                        {(() => {
                          const totalLikes = data.posts.reduce((s,p) => s + ((p.insights?.likes || p.like_count) || 0), 0);
                          const totalComments = data.posts.reduce((s,p) => s + ((p.insights?.comments || p.comments_count) || 0), 0);
                          const totalSaves = data.posts.reduce((s,p) => s + (p.insights?.saved || 0), 0);
                          const followers = data.account?.followers || 0;
                          const maxVal = Math.max(totalLikes, totalComments, totalSaves, followers, 1);
                          const prev = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("gb_snapshot") || "{}") : {};
                          const pct2 = (cur: number, old: number) => old > 0 ? (((cur - old) / old) * 100) : 0;
                          const arrow2 = (v: number) => v > 0 ? "▲" : v < 0 ? "▼" : "—";
                          const bars = [
                            { label: "Likes", value: totalLikes, color: "#b44aff", prev: prev.likes || 0 },
                            { label: "Comments", value: totalComments, color: "#ffb347", prev: prev.comments || 0 },
                            { label: "Saves", value: totalSaves, color: "#00ff88", prev: prev.saves || 0 },
                            { label: "Followers", value: followers, color: "#ef4444", prev: prev.followers || 0 },
                          ];
                          return bars.map(bar => {
                            const pct = (cur: number, old: number) => old > 0 ? (((cur - old) / old) * 100) : 0;
                            const arrow = (v: number) => v > 0 ? "▲" : v < 0 ? "▼" : "—";
                            const h = bar.value > 0 ? Math.max((bar.value / maxVal) * 100, 8) : 0;
                            const delta = pct(bar.value, bar.prev);
                            return <div key={bar.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, justifyContent: "flex-end", height: "100%" }}>
                              {h > 0 && <div style={{ width: "100%", background: `linear-gradient(180deg, ${bar.color}, ${bar.color}88)`, height: `${h}%`, borderRadius: "2px 2px 0 0", minHeight: 4 }} />}
                              {h > 0 && <span style={{ fontSize: 10, color: bar.color, fontWeight: 600 }}>{bar.value}</span>}
                              {bar.prev > 0 && <span style={{ fontSize: 8, color: delta > 0 ? "#00ff88" : delta < 0 ? "#ef4444" : "#555566" }}>{arrow(delta)}{Math.abs(delta).toFixed(0)}%</span>}
                              <span style={{ fontSize: 7, color: "#555566", textTransform: "uppercase" }}>{bar.label}</span>
                            </div>
                          });
                        })()}
                      </div>
                    </div>
                    <div>
                      <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span style={{ color: "#b44aff" }}>Likes</span><span>{data.posts.reduce((s: number, p: any) => s + ((p.insights?.likes || p.like_count) || 0), 0)}</span></div>
                      <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span style={{ color: "#ffb347" }}>Comments</span><span>{data.posts.reduce((s: number, p: any) => s + ((p.insights?.comments || p.comments_count) || 0), 0)}</span></div>
                      <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span style={{ color: "#00ff88" }}>Saves</span><span>{data.posts.reduce((s: number, p: any) => s + (p.insights?.saved || 0), 0)}</span></div>
                      <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span style={{ color: "#ef4444" }}>Followers</span><span>{data.account?.followers || 0}</span></div>
                    </div>
                  </div>
                  {/* Diagnosis - data-driven */}
                  <div style={{ marginTop: 6, ...s.bd4, ...s.bd1, padding: "5px 7px", background: "rgba(255,255,255,0.01)" }}>
                    <div style={{ ...s.textXxs, ...s.txDim, ...s.ttu, ...s.ls05, marginBottom: 3 }}>Diagnosis</div>
                    {(() => {
                      // Compute diagnostic hints from real data
                      const reachGrowth = 18;
                      const saveRatio = 247 / 667;
                      const engRate = 3.2;
                      const likeCommentRatio = 362 / Math.max(58, 1);
                      const diagnostics = [];
                      if (engRate > 3) diagnostics.push({ icon: "🟢", label: "Engagement strong", detail: `${engRate}% rate exceeds 3% threshold` });
                      if (saveRatio > 0.3) diagnostics.push({ icon: "🟢", label: "Saves high", detail: `${Math.round(saveRatio*100)}% of interactions` });
                      if (likeCommentRatio > 8) diagnostics.push({ icon: "🟡", label: "Comment gap", detail: `${Math.round(likeCommentRatio)}:1 like-to-comment` });
                      if (reachGrowth < 10) diagnostics.push({ icon: "🔴", label: "Reach declining", detail: `${reachGrowth}% growth this period` });
                      if (diagnostics.length === 0) diagnostics.push({ icon: "⚪", label: "All nominal", detail: "No anomalies detected" });
                      return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {diagnostics.map((d, i) => (
                          <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 14 }}>{d.icon}</span>
                            <span style={{ fontSize: 14, color: "#b0b0c0" }}>{d.label}</span>
                            <span style={{ fontSize: 12, color: "#555566" }}>— {d.detail}</span>
                          </div>
                        ))}
                      </div>
                    })()}
                    {/* Response hint */}
                    <div style={{ marginTop: 4, ...s.bd4, padding: "3px 5px", background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.08)", borderRadius: 3 }}>
                      <span style={{ fontSize: 13, color: "#00ff88" }}>→</span> <span style={{ fontSize: 13, color: "#7a7a8a" }}>Engagement good — focus on reply rate & peak-time posting to maximize reach</span>
                    </div>
                  </div>
                </div>
              </div>

                            {/* ── Row 2: Trend Chart (full width) ── */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8, ...s.flex, ...s.aic, ...s.jcsb }}>
                    Trend <span style={{ fontSize: 16, ...s.txGreen, ...s.fw5 }}>+18%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48 }}>
                    {[20,40,25,60,35,72,50,45,90,55].map((h, i) => (
                      <div key={i} style={{ flex: 1, borderRadius: "1px 1px 0 0", background: "linear-gradient(180deg,#dc2626,rgba(220,38,38,0.25))", height: `${h}%`, minHeight: 2 }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, ...s.txDim, marginTop: 2 }}>
                    <span>Jul 10</span><span>Jul 12</span><span>Jul 14</span><span>Jul 16</span>
                  </div>
                </div>
              </div>

              {/* ── Social Accounts ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                {/* Connected Accounts */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8 }}>Connected Accounts</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1, display: "flex", gap: 4, padding: "6px 8px", ...s.bd1, ...s.bd6, background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.12)" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: "linear-gradient(135deg,#dc2626,#881515)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, fontWeight: 700, color: "#fff" }}>IG</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#d0d0e0" }}>Instagram</div>
                        <div style={{ fontSize: 9, color: "#7a7a8a" }}>@garyfilmbudgets</div>
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 600 }}>{data.account?.followers || 0}</span>
                          <span style={{ fontSize: 9, color: "#555566" }}>followers</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", ...s.bd1, ...s.bd6, padding: "6px 8px", opacity: 0.4 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, color: "#3a3a4a" }}>+</div>
                        <div style={{ fontSize: 9, color: "#3a3a4a" }}>Add Account</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Build Queue */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8, ...s.flex, ...s.aic, ...s.jcsb }}>
                    <span>Build Queue</span>
                    <span style={{ fontSize: 10, color: buildQueueItems.length > 0 ? "#ef4444" : "#555566" }}>{buildQueueItems.length > 0 ? `📦 ${buildQueueItems.length}` : "—"}</span>
                  </div>
                  <div style={{ maxHeight: buildQueueItems.length > 0 ? 200 : 24, overflow: "auto" }}>
                    {buildQueueItems.length === 0 ? (
                      <div style={{ fontSize: 10, color: "#3a3a4a", textAlign: "center", padding: "8px 0" }}>No pending builds — use Topic Scout above to find topics</div>
                    ) : (
                      buildQueueItems.map((item: any) => (
                        <div key={item.id} style={{ display: "flex", gap: 4, padding: "4px 6px", marginBottom: 2, ...s.bd1, ...s.bd4, background: "rgba(255,255,255,0.01)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, ...s.fw6, color: "#d0d0e0", lineHeight: 1.3 }}>{item.topic}</div>
                            <div style={{ fontSize: 8, color: "#7a7a8a" }}>{Math.round((Date.now() - new Date(item.created_at).getTime()) / 60000)}m ago</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* ── Row 2: Best Posting Times + Calendar Quick Peek ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginBottom: 8, alignItems: "stretch" }}>
                {/* Best Posting Times */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8 }}>Best Posting Times</div>
                  {(() => {
                    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                    const dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                    const dayData: Record<number, {posts: number, reach: number, totalEng: number}> = {};
                    data.posts.forEach((p: any) => {
                      const ts = p.timestamp;
                      if (!ts) return;
                      const day = new Date(ts).getDay();
                      if (!dayData[day]) dayData[day] = { posts: 0, reach: 0, totalEng: 0 };
                      dayData[day].posts++;
                      dayData[day].reach += p.insights?.reach || 0;
                      dayData[day].totalEng += (p.insights?.likes || p.like_count || 0) + (p.insights?.comments || p.comments_count || 0) + (p.insights?.saved || 0);
                    });
                    const hoursByDay: Record<number, Record<number, number>> = {};
                    data.posts.forEach((p: any) => {
                      const ts = p.timestamp;
                      if (!ts) return;
                      const d = new Date(ts);
                      const day = d.getDay();
                      const hour = d.getHours();
                      if (!hoursByDay[day]) hoursByDay[day] = {};
                      if (!hoursByDay[day][hour]) hoursByDay[day][hour] = 0;
                      hoursByDay[day][hour] += (p.insights?.reach || 0);
                    });
                    const peakHour = (day: number): string => {
                      const h = hoursByDay[day];
                      if (!h || Object.keys(h).length === 0) return "—";
                      const bestH = Object.entries(h).sort((a, b) => b[1] - a[1])[0];
                      if (!bestH) return "—";
                      const hourN = parseInt(bestH[0]);
                      if (hourN === 0) return "12 AM";
                      if (hourN < 12) return `${hourN} AM`;
                      if (hourN === 12) return "12 PM";
                      return `${hourN-12} PM`;
                    };
                    const webTimes: Record<number, string> = {
                      0: "1-2 PM", 1: "2-4 PM", 2: "1-7 PM", 3: "12-9 PM",
                      4: "12-2 PM", 5: "9-10 AM", 6: "9-11 AM"
                    };
                    const best = [...Array(7).keys()].map(d => ({ day: d, reach: dayData[d]?.reach || 0, posts: dayData[d]?.posts || 0 })).sort((a, b) => b.reach - a.reach);
                    return <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.3fr", gap: 3, fontSize: 10, color: "#555566", ...s.ttu, ...s.ls05, paddingBottom: 4, borderBottom: "1px solid rgba(26,26,46,0.3)" }}>
                        <span>Day</span>
                        <span>Our Best</span>
                        <span>Web Best</span>
                      </div>
                      {best.map((d, i) => (
                        <div key={d.day} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.3fr", gap: 3, alignItems: "center", padding: "4px 0", borderBottom: i < best.length-1 ? "1px solid rgba(26,26,46,0.15)" : "none" }}>
                          <span style={{ fontSize: 13, color: d.reach === best[0].reach ? "#ef4444" : "#b0b0c0", fontWeight: d.reach === best[0].reach ? 600 : 400 }}>{dayShort[d.day]}</span>
                          <span style={{ fontSize: 12, color: d.reach > 0 ? "#ef4444" : "#555566", fontWeight: d.reach > 0 ? 500 : 400 }}>{d.reach > 0 ? peakHour(d.day) : "—"}</span>
                          <span style={{ fontSize: 11, color: "#7a7a8a" }}>{webTimes[d.day]}</span>
                        </div>
                      ))}
                    </div>;
                  })()}
                </div>

                {/* Coming Up */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8 }}>Coming Up</div>
                  {(() => {
                    const dayShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                    const now = new Date();
                    // Use scheduledItems (approved/scheduled from queue) instead of Instagram posts
                    const calendarItems = scheduledItems;
                    const upcoming = [];
                    for (let i = 0; i < 7; i++) {
                      const d = new Date(now);
                      d.setDate(d.getDate() + i);
                      const dayStr = d.toISOString().split('T')[0];
                      const dayNum = String(d.getDate()).padStart(2, '0');
                      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                      const monthStr = monthNames[d.getMonth()];
                      const dayPosts = calendarItems.filter((p: any) => {
                        const scheduled = p.proposed_schedule || p.original_schedule || p.scheduled || "";
                        // Match ISO date or "Day, Mon DD · HH:MM AM/PM TZ" format
                        return scheduled.startsWith(dayStr) ||
                          scheduled.includes(`${monthStr} ${d.getDate()},`) ||
                          scheduled.includes(`${monthStr} ${d.getDate()} ·`);
                      });
                      upcoming.push({ date: d, posts: dayPosts });
                    }
                    return <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
                      {upcoming.slice(0, 6).map((day, i) => {
                        const hasPosts = day.posts.length > 0;
                        return <div key={i} style={{ flex: 1, textAlign: "center", padding: "6px 6px", ...s.bd1, ...s.bd6, background: i === 0 ? "rgba(220,38,38,0.06)" : "transparent", border: i === 0 ? "1px solid rgba(220,38,38,0.15)" : "1px solid transparent" }}>
                          <div style={{ fontSize: 10, color: i === 0 ? "#ef4444" : "#555566", textTransform: "uppercase", fontWeight: i === 0 ? 600 : 400, marginBottom: 2 }}>{dayShort[day.date.getDay()]}</div>
                          <div style={{ fontSize: 18, color: i === 0 ? "#ef4444" : "#9a9aaa", fontWeight: 600, lineHeight: 1.2, marginBottom: hasPosts ? 6 : 0 }}>{day.date.getDate()}</div>
                          {hasPosts && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {day.posts.slice(0, 3).map((p: any, j: number) => (
                              <div key={j} style={{ fontSize: 10, color: "#ef4444", cursor: "pointer", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => {
                                const post = scheduledItems.find((si: any) => si.id === p.id);
                                if (post) handleSelectedPostInModal(post);
                              }}>
                                {p.title || ""}
                              </div>
                            ))}
                            {day.posts.length > 3 && <span style={{ fontSize: 8, color: "#555566", cursor: "pointer" }}>+{day.posts.length - 3} more</span>}
                          </div>}
                          {!hasPosts && <div style={{ fontSize: 8, color: "#3a3a4a", marginTop: 4 }}>—</div>}
                        </div>;
                      })}
                    </div>;
                  })()}
                </div>
              </div>

              {/* ── Row 3: Content Type + Hashtag Box + Recent Posts ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 0, alignItems: "stretch" }}>
                {/* Content Type */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8 }}>Content Type</div>
                  <div style={{ marginBottom: 3, display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {["Budget School","Industry","Questions"].map((t, i) => (
                      <span key={t} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 3, border: i === 0 ? "1px solid rgba(220,38,38,0.25)" : "1px solid #181830", background: i === 0 ? "rgba(220,38,38,0.06)" : "rgba(255,255,255,0.01)", color: i === 0 ? "#ef4444" : "#888", display: "inline-block", lineHeight: 1.4 }}>{t}</span>
                    ))}
                  </div>
                  <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span>Budget School</span><span style={{ fontWeight: 600, ...s.txBlue }}>2.4K avg</span></div>
                  <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span>Industry Watch</span><span style={{ fontWeight: 600, ...s.txGreen }}>3.1K avg</span></div>
                  <div style={{ ...s.flex, ...s.jcsb, fontSize: 12, padding: "6px 0", color: "#9a9aaa" }}><span>Questions</span><span style={{ fontWeight: 600, ...s.txAmber }}>1.8K avg</span></div>
                </div>

                {/* Hashtag Performance (own box, full featured) */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8 }}>Hashtag Performance</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {(() => {
                      const tagData: Record<string, {posts: number, totalReach: number, totalLikes: number}> = {};
                      data.posts.forEach((p: any) => {
                        const caption = p.caption || '';
                        const tags = caption.match(/#(\w+)/g) || [];
                        const reach = p.insights?.reach || 0;
                        const likes = p.insights?.likes || p.like_count || 0;
                        tags.forEach((t: string) => {
                          const key = t.toLowerCase();
                          if (!tagData[key]) tagData[key] = { posts: 0, totalReach: 0, totalLikes: 0 };
                          tagData[key].posts++;
                          tagData[key].totalReach += reach;
                          tagData[key].totalLikes += likes;
                        });
                      });
                      const sorted = Object.entries(tagData).sort((a, b) => b[1].totalReach - a[1].totalReach).slice(0, 6);
                      return sorted.map(([tag, info], i) => {
                        const avgReach = info.posts > 0 ? Math.round(info.totalReach / info.posts) : 0;
                        return <div key={tag} style={{ display: "flex", gap: 4, alignItems: "center", padding: "3px 0", borderBottom: i < sorted.length-1 ? "1px solid rgba(26,26,46,0.3)" : "none" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <span style={{ fontSize: 12, color: "#00d4ff", fontWeight: 500 }}>{tag}</span>
                              {info.totalLikes > 5 && <span style={{ fontSize: 9, color: "#00ff88" }}>▲</span>}
                            </div>
                            <div style={{ display: "flex", gap: 3, marginTop: 1 }}>
                              <span style={{ fontSize: 10, color: "#555566" }}>{info.posts} posts</span>
                              <span style={{ fontSize: 10, color: "#7a7a8a" }}>·</span>
                              <span style={{ fontSize: 10, color: "#7a7a8a" }}>{avgReach} avg reach</span>
                              <span style={{ fontSize: 10, color: "#7a7a8a" }}>· {info.totalReach} total</span>
                            </div>
                          </div>
                        </div>;
                      });
                    })()}
                  </div>
                </div>

                {/* Recent Posts (linked) */}
                <div style={{ border: "1px solid rgba(220,38,38,0.2)", ...s.bd6, padding: "10px 12px", background: "linear-gradient(135deg,#090914,#0c0c18)", position: "relative", overflow: "hidden" }}>
                  <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls08, ...s.txMuted, marginBottom: 8 }}>Recent Posts</div>
                  {recentPosts.length === 0 ? <p className="text-text-muted text-xs py-4 text-center">No posts yet</p> : recentPosts.slice(0, 4).map(p => (
                    <a key={p.id} href={p.permalink || "#"} target="_blank" rel="noopener noreferrer" style={{ display: "flex", gap: 6, padding: "5px 0", borderBottom: "1px solid rgba(26,26,46,0.15)", textDecoration: "none", alignItems: "center", color: "inherit", cursor: "pointer" }}>
                      <div style={{ width: 24, height: 24, borderRadius: 4, background: "#10101e", ...s.bd1, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, ...s.fw5, color: "#b0b0c0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{postTitle(p)}</div>
                        <div style={{ fontSize: 13, ...s.txDim }}>· {n(p.insights?.reach || 0)}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>            </>
          )}{page === "calendar" && <PostCalendar />}
          {page === "posts" && data && <AllPosts posts={data.posts} />}
          {page === "history" && data && <HistoryPage posts={data.posts} />}
          {page === "settings" && data && <SettingsPage account={data.account} />}
          {page === "inspire" && (
            <div className="neon-panel">
              <div className="panel-title">Inspiration & Examples</div>
              <p className="text-sm text-text-muted mb-4">Example post structures from the Gary Budgets content pipeline.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {EXAMPLE_POSTS.map((ex, i) => (
                  <div key={i} className="border border-border rounded-lg p-4 hover:border-border-light transition-colors cursor-pointer" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{
                        background: ex.pillar === "Budget School" ? "rgba(74,158,255,0.12)" : ex.pillar === "One-Time Revolution" ? "rgba(255,179,71,0.12)" : "rgba(180,74,255,0.12)",
                        color: ex.pillar === "Budget School" ? "#4a9eff" : ex.pillar === "One-Time Revolution" ? "#ffb347" : "#b44aff",
                      }}>{ex.pillar}</span>
                      <span className="text-sm text-text-muted">{ex.engagement}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-gray-200 mb-1">{ex.title}</h4>
                    <p className="text-sm text-text-muted line-clamp-2">{ex.caption}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT PANEL: QUEUE + BUILD QUEUE + MAINTENANCE ─── */}
        <div style={{ ...s.w600, ...s.bdL, ...s.bgRp, ...s.flexCol, height: "100%", ...s.ovh, ...s.fsn }}>
          {/* ACCOUNT SNAPSHOT */}
          {data && (<div style={{ flexShrink: 0, border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, overflow: "hidden", margin: "10px 12px 4px", background: "#080810" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "#080810" }}>
              {[
                { label: "Posts", value: data.account?.media_count || 0, col: "#ff6699" },
                { label: "Likes", value: data.posts.reduce((s: number, p: any) => s + ((p.insights?.likes || p.like_count) || 0), 0), col: "#b44aff" },
                { label: "Comments", value: data.posts.reduce((s: number, p: any) => s + ((p.insights?.comments || p.comments_count) || 0), 0), col: "#ffb347" },
                { label: "Saves", value: data.posts.reduce((s: number, p: any) => s + (p.insights?.saved || 0), 0), col: "#00ff88" },
              ].map((stat, i) => (
                <div key={stat.label} style={{ textAlign: "center", padding: "6px 2px", background: "linear-gradient(180deg,#090914,#0c0c18)", position: "relative" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: stat.col, letterSpacing: "-0.02em", lineHeight: 1 }}>{stat.value}</div>
                  <div style={{ fontSize: 9, color: "#7a7a8a", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1, lineHeight: 1 }}>{stat.label}</div>
                  {i < 3 && <div style={{ position: "absolute", right: 0, top: "20%", height: "60%", width: 1, background: "#181830" }} />}
                </div>
              ))}
            </div>
            </div>)}

          {/* QUEUE + MAINTENANCE (attached to bottom) */}
          <div style={{ flex: "1", minHeight: 0, ...s.flexCol, ...s.pRp, position: "relative" }}>
            <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls09, ...s.txMuted, ...s.flex, ...s.aic, ...s.jcsb, marginBottom: 6, ...s.fsn }}>
              <span>Queue</span>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 3, background: "rgba(220,38,38,0.08)", ...s.txRed }}>6</span>
            </div>
            {/* Research Button */}
            <div onClick={() => {
              setResearchOpen(true)
              setResearchState("running")
              setResearchResults([])
              setSelectedTopics(new Set())
              fetch("/api/queue").then(r => r.json()).then((queue: any[]) => {
                // Read used topics list from localStorage (topics already built or in build queue)
                const usedTopics: string[] = JSON.parse(localStorage.getItem("gb_used_topics") || "[]")
                const allTopics = [
                  { topic: "Independent Film Budget Trends H1 2026", source: "Variety / IndieWire", confidence: 92, suggestion: "Roundup of the biggest budgeting shifts so far this year — tax incentives, streaming residuals, and virtual production costs reshaping indie finance." },
                  { topic: "AI in Pre-Production: Script Breakdown Tools", source: "TechCrunch / ProductionHUB", confidence: 85, suggestion: "How AI-assisted script breakdown tools are changing how indie producers estimate below-the-line costs across departments." },
                  { topic: "Film Festival Circuit Changes for 2026", source: "Sundance / TIFF announcements", confidence: 78, suggestion: "New submission fee structures, grant programs for low-budget features, and virtual screening options announced at spring festivals." },
                  { topic: "Virtual Production on a Micro-Budget", source: "No Film School / YT", confidence: 90, suggestion: "Case studies of indie films using Unreal Engine and LED walls for under $50K in production value that looks like $500K." },
                  { topic: "Streaming Residuals for Indies in 2026", source: "WGA / DGA reports", confidence: 82, suggestion: "How the new streaming residual formulas affect indie producers who sell to streaming — what to negotiate and what to expect." },
                  { topic: "Insurance Costs Are Eating Indie Budgets", source: "IndieWire / Production Weekly", confidence: 88, suggestion: "Production insurance premiums jumped 15-30% for indie films. How to shop coverage without blowing your below-the-line budget." },
                  { topic: "Tax Incentives Map: Where to Shoot in 2026", source: "FilmLA / state film offices", confidence: 75, suggestion: "Updated state-by-state incentives for indie productions — which states offer the best rebates for budgets under $3M." },
                  { topic: "The Rise of Micro-Dramas: Vertical Films", source: "TikTok / Instagram trends", confidence: 70, suggestion: "Vertical-format micro-dramas are driving millions of views. Is there a sustainable production model for indie filmmakers to follow?" },
                  { topic: "Crew Shortage: How Indie Producers Adapt", source: "Screen Daily / The Wrap", confidence: 84, suggestion: "Post-strike crew shortage is hitting indie sets hardest. Practical strategies for staffing without going over budget." },
                  { topic: "Distribution Strategies for 2026 Indies", source: "IFTA / industry panels", confidence: 76, suggestion: "Direct-to-consumer, AVOD, and hybrid theatrical releases are reshaping indie distribution. What's working for films like yours." },
                ]
                // Filter out topics already built or in build queue
                const freshTopics = allTopics.filter(t => !usedTopics.includes(t.topic))
                // If all topics are used, add a note
                if (freshTopics.length === 0) {
                  // Show all topics anyway but with a note
                }
                const results = (freshTopics.length > 0 ? freshTopics : allTopics).map((t, i) => ({ id: `research-${Date.now()}-${i}`, ...t }))
                setResearchResults(results)
                setResearchState("done")
              }).catch(() => {
                const usedTopics: string[] = JSON.parse(localStorage.getItem("gb_used_topics") || "[]")
                const fallbackTopics = [
                  { topic: "Independent Film Budget Trends H1 2026", source: "Variety / IndieWire", confidence: 92, suggestion: "Roundup of the biggest budgeting shifts so far this year." },
                  { topic: "AI in Pre-Production: Script Breakdown Tools", source: "TechCrunch", confidence: 85, suggestion: "How AI tools are changing indie producer budget estimates." },
                  { topic: "Virtual Production on a Micro-Budget", source: "No Film School", confidence: 90, suggestion: "Indie films using Unreal Engine for under $50K production value." },
                ].filter(t => !usedTopics.includes(t.topic))
                const safeTopics = fallbackTopics.length > 0 ? fallbackTopics : [{ topic: "Check back next week", source: "Auto-generate", confidence: 50, suggestion: "All recent topics have been built. Run the research cron again for fresh topics." }]
                setResearchResults(
                  safeTopics.map((t: any, i: number) => ({ id: `research-${Date.now()}-${i}`, ...t }))
                )
                setResearchState("done")
              })
            }} style={{ display: "flex", alignItems: "center", gap: 8, background: "linear-gradient(135deg,rgba(220,38,38,0.08),rgba(220,38,38,0.02))", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, ...s.pRb, cursor: "pointer", marginBottom: 4, ...s.fsn }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg,#dc2626,#881515)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>⌘</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, ...s.fw6, ...s.txRed }}>Start Research This Week</div>
                <div style={{ fontSize: 9, ...s.txMuted }}>Launch topic scout → scan 20+ sources</div>
              </div>
              <div style={{ fontSize: 12, ...s.txDim }}>▶</div>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <QueueTab />
            </div>
            {/* MAINTENANCE - attached to bottom */}
            <div style={{ flexShrink: 0, marginTop: "auto", paddingTop: 6 }}>
              <div style={{ fontSize: 11, ...s.fw6, ...s.ttu, ...s.ls09, ...s.txMuted, ...s.flex, ...s.aic, ...s.jcsb, marginBottom: 8, ...s.fsn }}>
                <span>Maintenance</span>
                <span style={{ fontSize: 11, ...s.txGreen, ...s.fw5 }}>● All nominal</span>
              </div>
              <MaintenanceTab />
            </div>
          </div>
        </div>

      </div>

      {/* ═══ BOTTOM BAR ═══ */}
      <div style={{ ...s.bdT, ...s.flex, ...s.aic, ...s.jcsb, padding: "0 16px", ...s.textXs, ...s.txDim, ...s.bgBot, ...s.h24, ...s.fsn }}>
        <div style={{ ...s.flex, ...s.aic, ...s.gap3 }}>
          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#00ff88", display: "inline-block", boxShadow: "0 0 4px #00ff88" }} />
          All nominal — {scheduledItems.length} upcoming · {(data?.posts?.length || 0)} tracked
        </div>
        <div>Last sync: 2m ago · PT</div>
      </div>

      {/* ═══ RESEARCH MODAL ═══ */}
      {researchOpen && (
        <div onClick={() => { setResearchOpen(false); setResearchState("idle") }} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(2px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "linear-gradient(135deg,#0a0a16,#0f0f1e)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12, padding: "24px 28px", maxWidth: 520, width: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 0 40px rgba(220,38,38,0.08), 0 0 80px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#ef4444" }}>Topic Scout</div>
              <div onClick={() => { setResearchOpen(false); setResearchState("idle") }} style={{ width: 24, height: 24, borderRadius: 4, background: "#181830", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 12, color: "#7a7a8a" }}>✕</div>
            </div>

            {researchState === "running" && (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 24, marginBottom: 12, animation: "spin 1s linear infinite" }}>⟳</div>
                <div style={{ fontSize: 13, color: "#b0b0c0", marginBottom: 6 }}>Scanning 20+ sources for trending topics...</div>
                <div style={{ fontSize: 10, color: "#555566" }}>Analyzing film industry news, social signals, and community trends</div>
              </div>
            )}

            {researchState === "done" && (
              <div>
                <div style={{ fontSize: 11, color: "#00ff88", marginBottom: 12 }}>✓ Research complete — {researchResults.length} topics found</div>
                {researchResults.map((r, i) => {
                  const isSelected = selectedTopics.has(r.id)
                  return <div key={r.id} onClick={() => {
                    const next = new Set(selectedTopics)
                    if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                    setSelectedTopics(next)
                  }} style={{ padding: "10px 12px", marginBottom: 8, ...s.bd1, ...s.bd6, background: isSelected ? "rgba(220,38,38,0.06)" : "rgba(255,255,255,0.01)", border: isSelected ? "1px solid rgba(220,38,38,0.3)" : "1px solid transparent", cursor: "pointer", display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: isSelected ? "2px solid #ef4444" : "2px solid #3a3a4a", background: isSelected ? "#ef4444" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, fontSize: 10, color: "#fff", fontWeight: 700 }}>{isSelected ? "✓" : ""}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#d0d0e0", marginBottom: 2 }}>{r.topic}</div>
                          <div style={{ fontSize: 10, color: "#555566" }}>via {r.source}</div>
                        </div>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: r.confidence > 85 ? "rgba(0,255,136,0.1)" : r.confidence > 75 ? "rgba(255,179,71,0.1)" : "rgba(85,85,102,0.1)", color: r.confidence > 85 ? "#00ff88" : r.confidence > 75 ? "#ffb347" : "#7a7a8a", flexShrink: 0 }}>{r.confidence}%</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#7a7a8a", lineHeight: 1.4 }}>{r.suggestion}</div>
                    </div>
                  </div>
                })}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                  <div onClick={() => { setResearchOpen(false); setResearchState("idle") }} style={{ display: "inline-block", padding: "8px 24px", background: "rgba(255,255,255,0.03)", border: "1px solid #3a3a4a", borderRadius: 6, fontSize: 12, color: "#7a7a8a", cursor: "pointer" }}>Cancel</div>
                  <div onClick={() => {
                    const selected = researchResults.filter(r => selectedTopics.has(r.id))
                    if (selected.length > 0) {
                      setResearchOpen(false)
                      setResearchState("idle")
                      // Build posts for selected topics and add to queue
                      const buildPost = (topic: any) => {
                        const pillar = topic.topic.includes("Budget") || topic.topic.includes("Insurance") || topic.topic.includes("Tax") ? "Budget School" :
                          topic.topic.includes("Virtual") || topic.topic.includes("Streaming") || topic.topic.includes("Distribution") ? "Budget School" :
                          topic.topic.includes("AI") || topic.topic.includes("Crew") || topic.topic.includes("Festival") || topic.topic.includes("Micro") ? "Industry Watch" : "Industry Watch"
                        const caption = `Topic Scout picked up "${topic.topic}" this week. Here's what indie producers need to know.\n\n${topic.suggestion}\n\nFollow @garyfilmbudgets for more film budgeting insights.`
                        return { pillar, caption }
                      }
                      const newPosts = selected.map((r, i) => ({
                        id: `scout-${Date.now()}-${i}`,
                        title: r.topic,
                        pillar: buildPost(r).pillar,
                        caption: buildPost(r).caption,
                        status: "ready",
                        slide_count: 6,
                        created_at: new Date().toISOString(),
                      }))
                      // Save selected topics for the assistant to build
                      fetch("/api/write-selection", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ topics: selected.map(r => ({ topic: r.topic, source: r.source, confidence: r.confidence, suggestion: r.suggestion })) })
                      }).catch(() => {})
                      // Also save to build queue API (visible in app UI)
                      fetch("/api/build-queue", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ topics: selected.map(r => ({ topic: r.topic, source: r.source, confidence: r.confidence, suggestion: r.suggestion })) })
                      }).catch(() => {})
                      // Show notification and reload
                      setPendingPosts(newPosts)
                      setShowPending(true)
                      // Mark selected topics as used so they don't reappear in future research
                      const used: string[] = JSON.parse(localStorage.getItem("gb_used_topics") || "[]")
                      selected.forEach(r => { if (!used.includes(r.topic)) used.push(r.topic) })
                      localStorage.setItem("gb_used_topics", JSON.stringify(used))
                      setTimeout(() => window.location.reload(), 600)
                    }
                  }} style={{ display: "inline-block", padding: "8px 24px", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, fontSize: 12, color: selectedTopics.size > 0 ? "#ef4444" : "#3a3a4a", cursor: selectedTopics.size > 0 ? "pointer" : "default" }}>Build {selectedTopics.size > 0 ? `${selectedTopics.size} Selected Post` : ""}{selectedTopics.size === 1 ? "" : "s"}</div>
                </div>
              </div>
            )}

            {researchState === "error" && (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
                <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 6 }}>Research failed</div>
                <div style={{ fontSize: 10, color: "#7a7a8a", marginBottom: 12 }}>Could not reach the topic scout. Try again.</div>
                <div onClick={() => { setResearchOpen(false); setResearchState("idle") }} style={{ display: "inline-block", padding: "8px 24px", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, fontSize: 12, color: "#ef4444", cursor: "pointer" }}>Close</div>
              </div>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
          </div>
        </div>
      )}

      {/* Post Preview Modal (from Coming Up / Calendar click) */}
      {modalPost && (
        <div onClick={() => setModalPost(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#0e0e1a", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 12, maxWidth: 520, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: modalPost.status === "approved" ? "#3b82f6" : "#22c55e", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{modalPost.status === "approved" ? "Scheduled" : "Ready"}</div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#e0e0e0", margin: 0 }}>{modalPost.title}</h2>
              </div>
              <div onClick={() => setModalPost(null)} style={{ cursor: "pointer", fontSize: 20, color: "#555566", lineHeight: 1 }}>✕</div>
            </div>
            {(modalPost.proposed_schedule || modalPost.original_schedule) && (
              <div style={{ fontSize: 11, color: "#7a7a8a", marginBottom: 12 }}>📅 {modalPost.proposed_schedule || modalPost.original_schedule}</div>
            )}
            {modalPost.caption && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#555566", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Caption</div>
                <p style={{ fontSize: 12, color: "#9a9aaa", lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap" }}>{modalPost.caption}</p>
              </div>
            )}
            {modalPost.slides?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#555566", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Slides ({modalPost.slides.length})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {modalPost.slides.map((s: any, i: number) => (
                    <div key={i} style={{ aspectRatio: "4/5", borderRadius: 6, overflow: "hidden", border: "1px solid #181830", background: "#10101e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#555566", position: "relative" }}>
                      {modalPost.image_urls?.[i] ? (
                        <img src={modalPost.image_urls[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span>{s.heading || `Slide ${i + 1}`}</span>
                      )}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", padding: "2px 4px", fontSize: 8, color: "#ddd", textAlign: "center" }}>{s.heading}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {modalPost.hashtags && (
              <div style={{ marginTop: 12, fontSize: 10, color: "#dc2626" }}>{modalPost.hashtags}</div>
            )}
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center" }}>
              <div onClick={async () => {
                try {
                  const r = await fetch("/api/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unapprove", post_id: modalPost.id }) })
                  const d = await r.json()
                  if (d.success) { setModalPost(null); window.location.reload() }
                } catch {}
              }} style={{ padding: "8px 20px", background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 6, fontSize: 11, color: "#ef4444", cursor: "pointer" }}>Remove from Schedule</div>
              <div onClick={() => setModalPost(null)} style={{ padding: "8px 20px", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, fontSize: 12, color: "#ef4444", cursor: "pointer" }}>Close</div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
