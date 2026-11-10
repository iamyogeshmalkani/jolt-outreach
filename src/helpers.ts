// A video's number (TikTok) or shortcode (Instagram): the part of its address that never changes, even if the creator renames their account.
export const videoKey = (url: string) => /\/video\/(\d+)/.exec(url)?.[1] ?? /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/.exec(url)?.[1] ?? url

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
export const formatCount = (n: number) => compact.format(n)

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function ageText(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000)
  if (!Number.isFinite(days)) return ''
  return days < 30 ? relative.format(-Math.max(0, days), 'day') : relative.format(-Math.floor(days / 7), 'week')
}

// Tells one comment from another: the video, who wrote it, and a short fingerprint of what they wrote.
export function commentKey(videoUrl: string, handle: string, text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0
  return `${videoKey(videoUrl)}|${handle}|${(h >>> 0).toString(36)}`
}
