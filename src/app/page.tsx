"use client"

import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
} from "recharts"
import {
  Users, Eye, MousePointerClick, Heart, Bookmark, Share2,
  BarChart3, Calendar, Send, Plus, RefreshCw, TrendingUp,
  Clock, Image, ArrowUp, ArrowDown, Activity, Search,
  Hash, Lightbulb, ChevronDown, ChevronUp, ExternalLink,
  MessageCircle, Target, Zap, CheckCheck,
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
interface CalendarSlidePreview {
  slide: number; heading: string; prompt_summary: string; image_url: string
}
interface CalendarEvent {
  id: string; date: string; day?: number; title: string; pillar: string; status: string; source_status?: string
  time: string; schedule_label?: string; original_schedule?: string | null; proposed_schedule?: string | null
  approved_at?: string | null; caption?: string; hashtags?: string; slide_count?: number
  slidePreviews?: CalendarSlidePreview[]; image_urls?: string[]; instagram_url?: string | null
}

// ---------- Sample hashtag data for demo (will be API-driven in future) ----------
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
  { icon: Image, title: "Use carousel posts for tutorials", desc: "Carousel posts get 3x more saves than single-image posts in the Education niche.", impact: "+200%", color: "#00d4ff" },
]

// ---------- Helpers ----------
function n(num: number | string | undefined | null): string {
  if (num == null) return "—"
  const n = typeof num === "string" ? parseInt(num) : num
  if (isNaN(n)) return "—"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toLocaleString()
}

function trendClass(val: string | undefined | null): string {
  if (!val) return "metric-flat"
  if (val.startsWith("+")) return "metric-up"
  if (val.startsWith("-")) return "metric-down"
  return "metric-flat"
}

function trendArrow(val: string | undefined | null) {
  if (!val) return null
  if (val.startsWith("+")) return <ArrowUp size={10} className="inline metric-up" />
  if (val.startsWith("-")) return <ArrowDown size={10} className="inline metric-down" />
  return null
}

// Extract hashtags from caption
function extractHashtags(caption: string): string[] {
  return caption.match(/#[\w]+/g) || []
}

// ---------- Stat Bar (compact, 8 metrics) ----------
function StatBar({ account, insights }: { account: Account; insights: Record<string, number> }) {
  const stats = [
    { label: "Reach", value: n(insights.reach), change: "+8%", color: "#4a9eff", icon: Eye },
    { label: "Profile Views", value: n(insights.profile_views), change: "+5%", color: "#b44aff", icon: BarChart3 },
    { label: "Followers", value: n(account.followers), change: "+3%", color: "#ef4444", icon: Users },
    { label: "Website Clicks", value: n(insights.website_clicks), change: "+12%", color: "#ffb347", icon: MousePointerClick },
    { label: "Engaged Accts", value: n(insights.accounts_engaged), change: "+7%", color: "#00ff88", icon: Activity },
    { label: "Interactions", value: n(insights.total_interactions), change: "+9%", color: "#34d399", icon: Share2 },
    { label: "Views", value: n(insights.views), change: "+6%", color: "#00d4ff", icon: TrendingUp },
    { label: "Posts", value: n(account.media_count), change: "—", color: "#ff6699", icon: Image },
  ]

  return (
    <div className="stat-bar">
      {stats.map((s, i) => (
        <div key={i} className="stat-bar-item group">
          <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
          <div className="stat-label">{s.label}</div>
          {s.change !== "—" && (
            <div className="stat-change flex items-center justify-center gap-1">
              {trendArrow(s.change)}
              <span className={trendClass(s.change)}>{s.change}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------- Growth Chart ----------
function GrowthChart({ posts }: { posts: Post[] }) {
  // Build mock growth data from post timeline
  const data = posts
    .filter(p => p.insights?.impressions)
    .map(p => ({
      date: new Date(p.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      impressions: p.insights?.impressions || 0,
      reach: p.insights?.reach || 0,
      engagement: p.like_count + p.comments_count,
      rate: p.insights?.reach ? ((p.like_count + p.comments_count) / p.insights.reach * 100).toFixed(1) : "0",
    }))
    .reverse()

  if (data.length < 2) return <div className="text-text-muted text-xs py-8 text-center">Not enough data for growth chart</div>

  // Calculate overall growth
  const first = data[0]
  const last = data[data.length - 1]
  const growth = first.impressions > 0 ? ((last.impressions - first.impressions) / first.impressions * 100).toFixed(1) : "0"

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-text-muted">Growth Rate</div>
            <div className="text-lg font-bold metric-up">{growth.startsWith("-") ? growth : `+${growth}%`}</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-xs text-text-muted">Total Impressions</div>
            <div className="text-lg font-bold text-gray-200">{n(last.impressions)}</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-xs text-text-muted">Avg Engagement</div>
            <div className="text-lg font-bold text-gray-200">{data.reduce((s, d) => s + parseFloat(d.rate as string), 0) / data.length}%</div>
          </div>
        </div>
        <div className="flex gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} /> Impressions</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: "#4a9eff" }} /> Reach</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: "#00ff88" }} /> Engagement</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="grow-imp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grow-reach" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4a9eff" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#4a9eff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#181830" />
          <XAxis dataKey="date" stroke="#555566" fontSize={10} tickMargin={4} />
          <YAxis stroke="#555566" fontSize={10} tickMargin={4} />
          <Tooltip
            contentStyle={{ background: "#111120", border: "1px solid #2a2a44", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#888899" }}
          />
          <Area type="monotone" dataKey="impressions" stroke="#ef4444" fill="url(#grow-imp)" strokeWidth={2} />
          <Area type="monotone" dataKey="reach" stroke="#4a9eff" fill="url(#grow-reach)" strokeWidth={1.5} />
          <Line type="monotone" dataKey="engagement" stroke="#00ff88" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------- Hashtag Analysis ----------
function HashtagAnalysis() {
  const [tab, setTab] = useState<"trending" | "analysis">("trending")

  const ourTags = ["#filmbudget", "#indiefilm", "#garybudgets", "#filmfinance", "#indiefilmmaking"]
  const tagPerformances = [
    { tag: "#filmbudget", posts: 12, avgLikes: 84, avgReach: 3400, topPerformer: true },
    { tag: "#indiefilm", posts: 10, avgLikes: 62, avgReach: 2800, topPerformer: false },
    { tag: "#garybudgets", posts: 8, avgLikes: 45, avgReach: 1900, topPerformer: false },
    { tag: "#filmfinance", posts: 5, avgLikes: 92, avgReach: 4100, topPerformer: true },
    { tag: "#indiefilmmaking", posts: 7, avgLikes: 55, avgReach: 2200, topPerformer: false },
  ]

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          className={`btn-ghost text-xs ${tab === "trending" ? "text-red-400 bg-surface-3" : ""}`}
          onClick={() => setTab("trending")}
        >Trending</button>
        <button
          className={`btn-ghost text-xs ${tab === "analysis" ? "text-red-400 bg-surface-3" : ""}`}
          onClick={() => setTab("analysis")}
        >Our Performance</button>
      </div>

      {tab === "trending" ? (
        <div className="space-y-2">
          {TRENDING_HASHTAGS.slice(0, 8).map((h, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-200">{h.tag}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                  background: h.category === "Budget" ? "rgba(255,179,71,0.1)" :
                    h.category === "Production" ? "rgba(74,158,255,0.1)" :
                    h.category === "Education" ? "rgba(0,255,136,0.1)" :
                    "rgba(180,74,255,0.1)",
                  color: h.category === "Budget" ? "#ffb347" :
                    h.category === "Production" ? "#4a9eff" :
                    h.category === "Education" ? "#00ff88" :
                    "#b44aff",
                }}>{h.category}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-muted">{h.volume}</span>
                <span className="text-xs font-medium" style={{ color: h.growth.startsWith("+") ? "#00ff88" : "#ff4444" }}>{h.growth}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {tagPerformances.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-200">{t.tag}</span>
                {t.topPerformer && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400">Top</span>}
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-text-muted">{t.posts} posts</span>
                <span className="text-xs" style={{ color: "#4a9eff" }}>{t.avgReach.toLocaleString()} avg</span>
                <div className="w-16 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${(t.avgReach / 4100) * 100}%`,
                    background: "linear-gradient(90deg, #ef4444, #dc2626)",
                  }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Engagement Tips ----------
function EngagementTips() {
  return (
    <div className="space-y-3">
      {ENGAGEMENT_TIPS.map((tip, i) => (
        <div key={i} className="flex gap-3 p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-border)" }}>
          <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${tip.color}10` }}>
            <tip.icon size={14} style={{ color: tip.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-gray-200">{tip.title}</h4>
              <span className="text-xs font-bold" style={{ color: tip.color }}>{tip.impact}</span>
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">{tip.desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- Upcoming Posts ----------
function UpcomingPosts() {
  const upcoming = [
    { title: "Your $50K Film Is Not a $50K Film", date: "Mon, Jun 22", time: "7:00 PM ET", status: "draft", pillar: "Budget School" },
    { title: "5 Budget Lines Indie Producers Forget", date: "Tue, Jun 23", time: "7:00 PM ET", status: "draft", pillar: "Budget School" },
    { title: "Above-the-Line vs Below-the-Line", date: "Wed, Jun 24", time: "12:00 PM ET", status: "draft", pillar: "Budget School" },
    { title: "Tax Incentives Are Budget Strategy", date: "Thu, Jun 25", time: "9:00 AM ET", status: "draft", pillar: "Industry Watch" },
  ]

  return (
    <div className="space-y-2">
      {upcoming.map((item, i) => (
        <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
              style={{
                background: item.pillar === "Budget School" ? "rgba(74,158,255,0.12)" :
                  item.pillar === "One-Time Revolution" ? "rgba(255,179,71,0.12)" :
                  "rgba(180,74,255,0.12)",
                color: item.pillar === "Budget School" ? "#4a9eff" :
                  item.pillar === "One-Time Revolution" ? "#ffb347" :
                  "#b44aff",
              }}
            >{item.pillar === "Budget School" ? "BS" : item.pillar === "One-Time Revolution" ? "OT" : "BB"}</div>
            <div>
              <h4 className="text-xs font-medium text-gray-200">{item.title}</h4>
              <div className="flex items-center gap-2 text-[10px] text-text-muted mt-0.5">
                <Calendar size={10} /> {item.date} at {item.time}
              </div>
            </div>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded font-medium ${
            item.status === "ready" ? "bg-green-900/30 text-green-400" : "bg-surface-3 text-text-muted"
          }`}>
            {item.status === "ready" ? "Ready" : "Draft"}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------- Recent Post Card (click to expand) ----------
function RecentPostCard({ post, index }: { post: Post; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const ins = post.insights
  const isCarousel = post.media_type === "CAROUSEL_ALBUM"
  const isReel = post.media_type === "VIDEO" || post.media_url?.includes(".mp4")
  const tags = extractHashtags(post.caption || "")

  // Engagement chart data for expanded view
  const engData = ins ? [
    { name: "Views", value: ins.impressions, color: "#ef4444" },
    { name: "Reach", value: ins.reach, color: "#4a9eff" },
    { name: "Saves", value: ins.saved, color: "#00ff88" },
    { name: "Likes", value: ins.likes, color: "#b44aff" },
    { name: "Comments", value: ins.comments, color: "#ffb347" },
  ] : []

  const engagementRate = ins?.reach ? ((post.like_count + post.comments_count) / ins.reach * 100).toFixed(1) : "—"

  return (
    <div className="post-card-compact" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-3">
          {post.media_url && (
            <img src={post.media_url} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">
              {new Date(post.timestamp).toLocaleDateString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
              })}
            </span>
            {isCarousel && <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">CAROUSEL</span>}
            {isReel && <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted">REEL</span>}
          </div>
          <p className="text-xs text-gray-300 line-clamp-1 mt-0.5">{post.caption?.slice(0, 60) || "No caption"}</p>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-text-muted flex-shrink-0">
          <span className="flex items-center gap-1"><Heart size={10} />{post.like_count}</span>
          <span className="flex items-center gap-1"><Activity size={10} />{post.comments_count}</span>
          <span className="text-[10px] font-medium" style={{ color: "#4a9eff" }}>{engagementRate}%</span>
        </div>
        <div className="text-text-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {expanded && (
        <div className="post-detail-expanded" onClick={(e) => e.stopPropagation()}>
          {ins && (
            <>
              {/* Engagement chart */}
              <div className="mb-4">
                <h5 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Engagement Breakdown</h5>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={engData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#181830" />
                    <XAxis dataKey="name" stroke="#555566" fontSize={10} />
                    <YAxis stroke="#555566" fontSize={10} />
                    <Tooltip
                      contentStyle={{ background: "#111120", border: "1px solid #2a2a44", borderRadius: 8, fontSize: 11 }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {engData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Hashtags used */}
              <div className="mb-4">
                <h5 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Hashtags Used</h5>
                <div className="flex flex-wrap gap-1.5">
                  {tags.length > 0 ? tags.map((tag, i) => (
                    <span key={i} className="data-tag">{tag}</span>
                  )) : (
                    <span className="text-[10px] text-text-muted">No hashtags in this post</span>
                  )}
                </div>
              </div>

              {/* Recommendations */}
              <div>
                <h5 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Recommendations</h5>
                <div className="space-y-1.5">
                  {tags.length < 3 && (
                    <div className="flex items-start gap-2 text-[10px]">
                      <span className="text-neon-amber flex-shrink-0">→</span>
                      <span className="text-text-muted">Add 3-5 niche hashtags like <span className="text-neon-blue">#filmbudget</span> and <span className="text-neon-green">#indiefinance</span> for better reach</span>
                    </div>
                  )}
                  {post.comments_count < 5 && (
                    <div className="flex items-start gap-2 text-[10px]">
                      <span className="text-neon-amber flex-shrink-0">→</span>
                      <span className="text-text-muted">End with a question to boost comments — try asking about their biggest budget challenge</span>
                    </div>
                  )}
                  {!isReel && (
                    <div className="flex items-start gap-2 text-[10px]">
                      <span className="text-neon-amber flex-shrink-0">→</span>
                      <span className="text-text-muted">Reels get 2x more reach than static posts — consider a Reel version</span>
                    </div>
                  )}
                  {engagementRate !== "—" && parseFloat(engagementRate as string) < 5 && (
                    <div className="flex items-start gap-2 text-[10px]">
                      <span className="text-neon-amber flex-shrink-0">→</span>
                      <span className="text-text-muted">Engagement rate ({engagementRate}%) is below average — try a more direct CTA in the first line</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Post Calendar (monthly grid view) ----------
function PostCalendar() {
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  useEffect(() => {
    fetch("/api/calendar")
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .catch(() => {})
  }, [])

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const monthName = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" })

  // Filter events for current month, keeping full queue details for click-through.
  const posts = events
    .filter((e: CalendarEvent) => {
      const d = new Date(e.date + "T12:00:00")
      return d.getMonth() === month && d.getFullYear() === year
    })
    .map((e: any) => ({
      ...e,
      day: new Date(e.date + "T12:00:00").getDate(),
    }))

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const pillars = ["Budget School", "Industry Watch"]
  const pillarColors: Record<string, string> = {
    "Budget School": "#4a9eff",
    "One-Time Revolution": "#ffb347",
    "Behind the Build": "#b44aff",
    "Industry Watch": "#ef4444",
  }
  const statusColors: Record<string, string> = {
    posted: "bg-purple-400",
    scheduled: "bg-green-400",
    pending: "bg-amber-400",
  }
  const statusLabels: Record<string, string> = {
    posted: "Posted",
    scheduled: "Approved & Scheduled",
    pending: "Pending Approval",
  }

  return (
    <div className="neon-panel relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="panel-title mb-0">Content Calendar</div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-xs px-2" onClick={prevMonth}>←</button>
          <span className="text-sm font-semibold text-gray-200 w-40 text-center">{monthName}</span>
          <button className="btn-ghost text-xs px-2" onClick={nextMonth}>→</button>
        </div>
      </div>

      {/* Pillar legend */}
      <div className="flex gap-4 mb-4 text-[10px] text-text-muted">
        {pillars.map(p => (
          <span key={p} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded" style={{ background: pillarColors[p] }} />
            {p}
          </span>
        ))}
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-0.5">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="text-[9px] text-text-muted uppercase tracking-wider text-center py-2">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square rounded-lg" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const dayPosts = posts.filter(p => p.day === day)
          const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear()

          return (
            <div key={day} className={`aspect-square rounded-lg p-1 border transition-all ${
              isToday ? "border-red-600/50 bg-red-900/10" : "border-border/50 hover:border-border-light"
            }`} style={{ background: dayPosts.length > 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
              <div className={`text-[10px] font-medium ${isToday ? "text-red-400" : "text-text-muted"}`}>{day}</div>
              <div className="space-y-0.5 mt-0.5">
                {dayPosts.map((p) => (
                  <button
                    key={p.id || `${p.title}-${p.date}`}
                    type="button"
                    className="w-full flex items-center gap-1 rounded px-0.5 py-0.5 text-left hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-red-500/70 transition"
                    title={`Open details for ${p.title}`}
                    onClick={() => setSelectedEvent(p)}
                  >
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pillarColors[p.pillar] || "#6b7280" }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[7px] text-gray-300 truncate">{p.title}</div>
                      <div className="text-[6px] text-text-muted">{p.time}</div>
                    </div>
                    <div className={`w-1 h-1 rounded-full flex-shrink-0 ${statusColors[p.status] || "bg-gray-400"}`} />
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 text-[10px] text-text-muted">
        <span className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400" /> Posted
        </span>
        <span className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" /> Approved & Scheduled
        </span>
        <span className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Pending Approval
        </span>
        <span className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded border border-red-600/50 bg-red-900/10" /> Today
        </span>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setSelectedEvent(null)}>
          <div className="neon-panel max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded font-medium" style={{ background: `${pillarColors[selectedEvent.pillar] || "#666"}20`, color: pillarColors[selectedEvent.pillar] || "#999" }}>
                    {selectedEvent.pillar || "Post"}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-green-900/20 text-green-400 font-medium">
                    {statusLabels[selectedEvent.status] || selectedEvent.status}
                  </span>
                </div>
                <h2 className="text-lg font-semibold text-gray-100">{selectedEvent.title}</h2>
              </div>
              <button className="btn-ghost text-lg leading-none px-2" onClick={() => setSelectedEvent(null)} aria-label="Close post details">×</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs">
              <div className="rounded-lg border border-border p-3 bg-white/[0.02]">
                <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Posts On</div>
                <div className="text-gray-200 font-medium">{selectedEvent.schedule_label || `${selectedEvent.date} ${selectedEvent.time || ""}`}</div>
              </div>
              <div className="rounded-lg border border-border p-3 bg-white/[0.02]">
                <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Slides</div>
                <div className="text-gray-200 font-medium">{selectedEvent.slide_count || selectedEvent.slidePreviews?.length || 0}</div>
              </div>
              <div className="rounded-lg border border-border p-3 bg-white/[0.02]">
                <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Post ID</div>
                <div className="text-gray-200 font-medium truncate">{selectedEvent.id}</div>
              </div>
            </div>

            {selectedEvent.caption && (
              <div className="mb-4">
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wide mb-1">Approved Caption</div>
                <p className="text-xs text-gray-300 whitespace-pre-line leading-relaxed rounded-lg border border-border p-3 bg-white/[0.02]">{selectedEvent.caption}</p>
              </div>
            )}

            {selectedEvent.hashtags && (
              <div className="mb-4">
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wide mb-1">Approved Hashtags</div>
                <p className="text-[10px] text-accent-blue/80 rounded-lg border border-border p-3 bg-white/[0.02]">{selectedEvent.hashtags}</p>
              </div>
            )}

            {selectedEvent.slidePreviews && selectedEvent.slidePreviews.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wide mb-1">Approved Slides</div>
                <SlidePreview slides={selectedEvent.slidePreviews} />
              </div>
            )}

            {selectedEvent.instagram_url && (
              <a href={selectedEvent.instagram_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-blue hover:underline inline-flex items-center gap-1">
                View on Instagram <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Launch Post — 6 Images Carousel ----------
const LAUNCH_POST = {
  title: "Why Your Indie Film Needs a Budget",
  caption: `You don't need a Hollywood budget to make a great film. You need a plan.

🎬 The director's chair looks good. But the real story? It starts with the numbers.

Here's what most indie filmmakers don't think about:

1️⃣ GEAR is obvious. Everyone budgets for the camera.
But gear isn't what eats your budget.

2️⃣ FOOD. Feeding a crew of 20 for 12 days? That's not craft services — that's a line item.

3️⃣ PETTY CASH. Coffee runs, parking, tape, batteries, last-minute props.
It adds up faster than you think.

4️⃣ THE SCHEDULE. A good shoot plan = a good budget plan.
Every hour of overtime costs money.

The truth? Most indie films blow 30% of their budget on things nobody planned for.

Gary Budgets makes it simple.
One price. One tool. No surprises.

Sign up for the waitlist → garybudgets.com`,
  images: [
    { src: "https://files.catbox.moe/2oz5f9.png", label: "The Hook" },
    { src: "https://files.catbox.moe/u0c1fk.png", label: "Gear isn't the problem" },
    { src: "https://files.catbox.moe/9vgr1x.png", label: "Feeding the crew" },
    { src: "https://files.catbox.moe/l7ap5l.png", label: "Small costs add up" },
    { src: "https://files.catbox.moe/g33cws.png", label: "Plan your budget" },
    { src: "https://files.catbox.moe/doxzyd.png", label: "Join the waitlist" },
  ],
  hashtags: "#indiefilm #filmbudget #garybudgets #filmfinance #indiefilmmaking #filmmakingtips #lowbudgetfilm #filmproducer #indiefilmcommunity #budgeting",
  scheduledFor: "Mon, Jun 22 · 10:00 AM",
  pillar: "Launch Campaign",
}

function ComposeTab({ onPublish }: { onPublish: (caption: string, file: File | null) => void }) {
  const [selectedImage, setSelectedImage] = useState(0)
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "approved" | "rejected">("pending")

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Left: Image carousel preview */}
      <div className="lg:col-span-3 neon-panel">
        <div className="panel-title">Post Preview — {LAUNCH_POST.title}</div>

        {/* Main image */}
        <div className="relative mb-3 rounded-lg overflow-hidden border border-border" style={{ background: "#000", aspectRatio: "9/16", maxHeight: 500 }}>
          <img
            src={LAUNCH_POST.images[selectedImage].src}
            alt=""
            className="w-full h-full object-contain"
            style={{ background: "#0a0a0a" }}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
            <div className="text-xs font-medium text-white">{selectedImage + 1} / {LAUNCH_POST.images.length}</div>
            <div className="text-[10px] text-gray-300">{LAUNCH_POST.images[selectedImage].label}</div>
          </div>
        </div>

        {/* Thumbnail strip */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {LAUNCH_POST.images.map((img, i) => (
            <button
              key={i}
              onClick={() => setSelectedImage(i)}
              className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                selectedImage === i ? "border-red-500" : "border-border hover:border-border-light"
              }`}
            >
              <img src={img.src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>

        {/* Caption preview */}
        <div className="mt-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Caption</div>
          <div className="text-xs text-gray-300 whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto">{LAUNCH_POST.caption}</div>
        </div>
      </div>

      {/* Right: Details & Approval */}
      <div className="lg:col-span-2 space-y-3">
        <div className="neon-panel">
          <div className="panel-title">Post Details</div>
          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Campaign</div>
              <div className="text-xs font-medium text-gray-200">{LAUNCH_POST.pillar}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Scheduled</div>
              <div className="text-xs font-medium text-gray-200">{LAUNCH_POST.scheduledFor}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Format</div>
              <div className="text-xs font-medium text-gray-200">Carousel — 6 slides</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Hashtags</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {LAUNCH_POST.hashtags.split(" ").map((tag, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(74,158,255,0.08)", color: "#4a9eff" }}>{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="neon-panel">
          <div className="panel-title">Approval</div>
          <div className="space-y-3">
            <div className={`flex items-center gap-2 p-3 rounded-lg text-xs ${
              approvalStatus === "approved" ? "bg-green-900/20 text-green-400" :
              approvalStatus === "rejected" ? "bg-red-900/20 text-red-400" :
              "bg-amber-900/20 text-amber-400"
            }`}>
              {approvalStatus === "approved" ? "✅ Approved" :
               approvalStatus === "rejected" ? "❌ Changes Requested" :
               "⏳ Awaiting Approval"}
            </div>

            <button className="btn-primary w-full text-xs py-2"
              onClick={() => setApprovalStatus("approved")}>
              Approve & Publish
            </button>
            <button className="btn-secondary w-full text-xs py-2"
              onClick={() => setApprovalStatus("rejected")}>
              Request Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Slide Preview (all 6 images, always visible, larger) ----------
function SlidePreview({ slides }: { slides: any[] }) {
  if (!slides || slides.length === 0) return null

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 mt-2">
      {slides.map((slide: any, i: number) => (
        <div key={i} className="flex-shrink-0">
          {slide.image_url ? (
            <img
              src={slide.image_url}
              alt={slide.heading}
              className="w-[140px] h-[187px] object-cover rounded-lg border border-white/10"
              loading="lazy"
              onError={(e) => {
                // Fallback if image fails to load
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          {/* Fallback placeholder, hidden by default */}
          <div className="w-[140px] h-[187px] rounded-lg border border-white/10 flex items-center justify-center bg-surface-3 hidden">
            <Image size={30} className="text-text-muted/40" />
          </div>
          <span className="text-[10px] text-text-muted block mt-1 text-center max-w-[140px] truncate">
            {slide.slide}. {slide.heading}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------- Queue Tab ----------
function QueueTab({ onPublish }: { onPublish: (caption: string, file: File | null) => void }) {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)

  const loadQueue = () => {
    setLoading(true)
    fetch("/api/queue")
      .then((r) => r.json())
      .then((d) => {
        const q = d.queue || d.posts || []
        setQueue(q)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadQueue()
  }, [])

  const pillarColors: Record<string, string> = {
    "Launch Campaign": "#ef4444",
    "Budget School": "#4a9eff",
    "One-Time Revolution": "#ffb347",
    "Behind the Build": "#b44aff",
    "Industry Watch": "#ef4444",
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    "awaiting_images": { label: "Awaiting Images", color: "#f59e0b", bg: "bg-amber-900/20" },
    "awaiting_image": { label: "Awaiting Images", color: "#f59e0b", bg: "bg-amber-900/20" },
    "ready": { label: "Ready", color: "#22c55e", bg: "bg-green-900/20" },
    "approved": { label: "Approved ✓", color: "#3b82f6", bg: "bg-blue-900/20" },
    "draft": { label: "Draft", color: "#6b7280", bg: "bg-surface-3" },
    "posted": { label: "Posted ✓", color: "#8b5cf6", bg: "bg-purple-900/20" },
    "scheduled": { label: "Scheduled", color: "#06b6d4", bg: "bg-cyan-900/20" },
  }

  const getStatus = (status: string) => statusConfig[status] || statusConfig.draft

  const handleApprove = async (item: any) => {
    setApproving(item.id)
    try {
      const r = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: item.id }),
      })
      const data = await r.json()
      if (data.success) {
        loadQueue()
      } else {
        alert("Failed to approve: " + (data.error || "Unknown error"))
      }
    } catch (err: any) {
      alert("Failed to approve: " + err.message)
    } finally {
      setApproving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-muted text-sm">Loading queue...</div>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-text-muted text-sm mb-2">No posts in the queue</div>
        <div className="text-xs text-text-muted/60">Generate weekly content to see posts here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {queue.filter((item: any) => item.status !== "posted").map((item: any, i: number) => {
        const st = getStatus(item.status || "draft")
        const scheduleLabel = item.proposed_schedule || item.original_schedule || item.scheduled

        return (
          <div key={item.id || i} className="neon-panel p-5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: `${pillarColors[item.pillar] || "#666"}20`, color: pillarColors[item.pillar] || "#666" }}>
                    {item.pillar}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${st.bg}`}
                    style={{ color: st.color }}>
                    {st.label}
                  </span>
                  <span className="text-[9px] text-text-muted">
                    <Image size={10} className="inline mr-0.5" />{item.slide_count || item.slides?.length || 0} slides
                  </span>
                </div>
                <h2 className="text-base font-semibold text-gray-100">{item.title}</h2>
              </div>

              {/* Action area */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {(item.status === "ready" || item.status === "awaiting_images" || item.status === "awaiting_image") && (
                  <button
                    className="bg-red-600 text-black text-xs font-bold py-2 px-4 rounded-lg hover:bg-red-500 transition disabled:opacity-50 border border-red-400"
                    onClick={() => handleApprove(item)}
                    disabled={approving === item.id}
                  >
                    {approving === item.id ? "Scheduling..." : "Approve & Schedule"}
                  </button>
                )}
                {item.status === "approved" && (
                  <span className="text-[11px] text-blue-400 font-medium flex items-center gap-1">
                    <Clock size={12} /> Scheduled
                  </span>
                )}
                {item.status === "posted" && (
                  <span className="text-[11px] text-purple-400 font-medium flex items-center gap-1">
                    <CheckCheck size={12} /> Posted
                  </span>
                )}
              </div>
            </div>

            {/* Schedule info */}
            <div className="flex items-center gap-2 text-[11px] text-text-muted mb-3">
              <Calendar size={11} />
              {item.status === "awaiting_images" && item.proposed_schedule ? (
                <span>Approves to: <span className="text-gray-300 font-medium">{scheduleLabel}</span></span>
              ) : (
                <span>{scheduleLabel}</span>
              )}
            </div>

            {/* Caption preview */}
            {item.caption && (
              <div className="mb-3">
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wide mb-1">Caption</div>
                <p className="text-xs text-gray-300 line-clamp-3 leading-relaxed">{item.caption}</p>
              </div>
            )}

            {/* Hashtags */}
            {item.hashtags && (
              <div className="mb-3">
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wide mb-1">Hashtags</div>
                <p className="text-[10px] text-accent-blue/80">{item.hashtags}</p>
              </div>
            )}

            {/* Slide previews */}
            {item.slidePreviews && item.slidePreviews.length > 0 && (
              <div>
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wide mb-1">Slides</div>
                <SlidePreview slides={item.slidePreviews} />
              </div>
            )}

            {/* Posted info */}
            {item.status === "posted" && item.instagram_url && (
              <div className="mt-2 text-[10px] text-text-muted">
                Posted: <a href={item.instagram_url} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">
                  View on Instagram ↗
                </a>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------- Main Dashboard ----------
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("calendar")

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
        fetchData()
      } catch (err: any) {
        alert("Publish failed: " + err.message)
      }
    }
    reader.readAsDataURL(file)
  }

  const recentPosts = data?.posts
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5) || []

  const content = (
    <div className="min-h-screen" style={{ background: "#07070d" }}>
      {/* Top Bar */}
      <header className="border-b border-border sticky top-0 z-40" style={{ background: "rgba(7,7,13,0.9)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-[10px] font-bold shadow-lg shadow-red-900/30">GB</div>
            <h1 className="text-base font-bold tracking-tight">Command Center</h1>
            <div className="h-4 w-px bg-border mx-2" />
            <span className="text-[10px] text-text-muted uppercase tracking-wider">@garyfilmbudgets</span>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Users size={12} />
                <span className="font-semibold text-gray-300">{n(data.account.followers)}</span>
              </div>
            )}
            <button onClick={fetchData} className="btn-ghost p-1.5" title="Refresh">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* Tab Navigation */}
        <div className="tab-list mb-5 inline-flex">
          {["overview", "calendar", "posts", "compose", "queue", "inspire"].map((tab) => {
            const labels: Record<string, string> = {
              overview: "Overview", calendar: "Calendar", posts: "Post History", compose: "Compose",
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

        {/* Loading */}
        {loading && !data && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="shimmer h-24" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="neon-panel text-center py-10">
            <div className="text-red-400 text-base font-semibold mb-2">Connection Error</div>
            <p className="text-text-muted text-xs mb-4">{error}</p>
            <button className="btn-primary text-xs" onClick={fetchData}>Retry</button>
          </div>
        )}

        {/* ====== OVERVIEW TAB ====== */}
        {activeTab === "overview" && data && (
          <div className="space-y-4">
            {/* Compact stat bar */}
            <StatBar account={data.account} insights={data.insights} />

            {/* Two-column layout for growth + sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Growth tracking chart — spans 2 cols */}
              <div className="lg:col-span-2 neon-panel neon-panel-accent">
                <div className="panel-title">Growth Tracking</div>
                <GrowthChart posts={data.posts} />
              </div>

              {/* Right sidebar — hashtag analysis */}
              <div className="neon-panel">
                <div className="panel-title">Hashtag Analysis</div>
                <HashtagAnalysis />
              </div>
            </div>

            {/* Two-column: Engagement Tips + Upcoming Posts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="neon-panel">
                <div className="panel-title">Engagement Optimization</div>
                <EngagementTips />
              </div>

              <div className="neon-panel">
                <div className="panel-title">Upcoming Posts</div>
                <UpcomingPosts />
              </div>
            </div>

            {/* Recent Posts */}
            <div className="neon-panel">
              <div className="panel-title">Recent Posts</div>
              <div className="space-y-2">
                {recentPosts.length === 0 ? (
                  <p className="text-text-muted text-xs py-4 text-center">No posts yet</p>
                ) : (
                  recentPosts.map((p, i) => <RecentPostCard key={p.id} post={p} index={i} />)
                )}
              </div>
            </div>
          </div>
        )}

        {/* ====== CALENDAR TAB ====== */}
        {activeTab === "calendar" && (
          <PostCalendar />
        )}

        {/* ====== POST HISTORY TAB ====== */}
        {activeTab === "posts" && data && (
          <div className="neon-panel">
            <div className="panel-title">All Posts</div>
            {data.posts.length === 0 ? (
              <p className="text-text-muted text-xs py-8 text-center">No posts yet.</p>
            ) : (
              <div className="space-y-2">
                {data.posts.map((p) => <RecentPostCard key={p.id} post={p} index={0} />)}
              </div>
            )}
          </div>
        )}

        {/* ====== COMPOSE TAB ====== */}
        {activeTab === "compose" && (
          <ComposeTab onPublish={handlePublish} />
        )}

        {/* ====== QUEUE TAB ====== */}
        {activeTab === "queue" && (
          <QueueTab onPublish={handlePublish} />
        )}

        {/* ====== INSPIRATION TAB ====== */}
        {activeTab === "inspire" && (
          <div className="neon-panel">
            <div className="panel-title">Inspiration & Examples</div>
            <p className="text-xs text-text-muted mb-4">Example post structures from the Gary Budgets content pipeline.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {EXAMPLE_POSTS.map((ex, i) => (
                <div key={i} className="border border-border rounded-lg p-4 hover:border-border-light transition-colors cursor-pointer" style={{ background: "rgba(255,255,255,0.02)" }}
                  onClick={() => setActiveTab("compose")}>
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
    </div>
  )

  return content
}

// ---------- Example posts ----------
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
