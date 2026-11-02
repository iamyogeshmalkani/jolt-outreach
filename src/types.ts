// A video the finder found, as saved in videos_found.json on the data branch.
export type Video = {
  url: string
  creator: string
  caption: string
  views: number | null
  comments: number
  topic: string          // the search that found it
  posted: string | null  // when it was posted (ISO), read from the video's number
  found: string          // when the run that found it happened (ISO); the latest run's videos are tagged New
}

// A video marked complete, as saved in videos_done.json. The finder never lists these again.
export type Done = { url: string; at: string }
