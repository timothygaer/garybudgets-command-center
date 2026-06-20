// Instagram API types
export interface AccountInsights {
  followers: number
  followersChange: number
  reach: number
  profileViews: number
  websiteClicks: number
  accountsEngaged: number
  totalInteractions: number
  views: number
}

export interface Post {
  id: string
  media_type: string
  media_url: string
  permalink?: string
  caption: string
  timestamp: string
  like_count: number
  comments_count: number
  insights?: PostInsights
}

export interface PostInsights {
  impressions: number
  reach: number
  saved: number
  shares: number
  follows: number
  profile_visits: number
}

export interface QueueItem {
  id: string
  title: string
  pillar: string
  caption: string
  image_url?: string
  status: "draft" | "awaiting_image" | "ready" | "posted"
  scheduled_for?: string
  posted_at?: string
}

export interface ContentPillar {
  name: string
  percentage: number
  color: string
  posts: number
  avgEngagement: number
}

// Instagram API response types
export interface IGMediaResponse {
  data: IGMedia[]
}

export interface IGMedia {
  id: string
  media_type: string
  media_url: string
  permalink?: string
  caption?: string
  timestamp: string
  like_count?: number
  comments_count?: number
  insights?: {
    data?: IGInsight[]
  }
}

export interface IGInsight {
  name: string
  values: { value: number }[]
}

export interface IGAccountInsights {
  data: IGInsight[]
}
