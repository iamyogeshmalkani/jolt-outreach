// The two places videos are found. Each has its own pair of files on the data branch.
export type Platform = 'tiktok' | 'instagram'

// A video the finder found, as saved in videos_found.json (TikTok) or instagram_found.json (Instagram) on the data branch.
export type Video = {
  url: string
  creator: string
  caption: string
  views?: number | null  // TikTok only
  likes?: number | null  // Instagram only; null when the creator hides likes
  comments: number | null
  topic: string          // the search that found it
  posted: string | null  // when it was posted (ISO), read from the video's number
  found: string          // when the run that found it happened (ISO); the latest run's videos are tagged New
  read?: number          // how many of its top comments the finder read (missing on videos found before comments were read)
  matches?: Comment[]    // the ones among them that are about screen time, brain rot, phone addiction and the other comment topics
}

// A comment the finder kept because it is about one of the comment topics.
export type Comment = { handle: string; text: string; topics: string[] }

// A video marked complete, as saved in videos_done.json. The finder never lists these again.
export type Done = { url: string; at: string }

// A comment marked complete, as saved in comments_done.json. `id` comes from commentKey().
export type CommentDone = { id: string; at: string }
