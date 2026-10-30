import { DEFAULT_REPLY, type Config, type Person } from './types'

// One person to message, as the queue and conversation show them.
export type Item = {
  key: string
  title: string            // @handle
  theirs: string           // what they wrote
  reply: string            // the private message we would send
  commentReply: string     // the public reply under their comment
  written: boolean         // the public reply was written for this comment, not the standard one
  creator: boolean         // gets the creator message
  priority: 'A' | 'B'
  isNew: boolean           // found by the latest run that found anyone
  note?: string
  source: string
  sourceUrl: string        // the video they commented on
  profileUrl: string
}

// {ME} is your first name, {NAME} is the person you are writing to.
export const sub = (text: string, cfg: Config, them = '[Name]') =>
  text.replaceAll('{ME}', cfg.name.trim() || '[Your Name]').replaceAll('{NAME}', them)

export function buildItems(people: Person[], cfg: Config, creators: Record<string, boolean> = {}, replies: Record<string, string> = {}): Item[] {
  const latest = people.reduce((max, p) => (p.found && p.found > max ? p.found : max), '')
  return people.map((p) => ({
    key: `p:${p.handle}`,
    title: `@${p.handle}`,
    theirs: p.comment,
    reply: sub((creators[`p:${p.handle}`] ? cfg.creatorBody : cfg.commenterBody).trim(), cfg, p.handle),
    commentReply: replies[`p:${p.handle}`] ?? DEFAULT_REPLY,
    written: `p:${p.handle}` in replies,
    creator: Boolean(creators[`p:${p.handle}`]),
    priority: p.priority,
    isNew: Boolean(latest) && p.found === latest,
    note: p.note || undefined,
    source: p.source,
    sourceUrl: p.url,
    profileUrl: `https://www.tiktok.com/@${p.handle}`,
  }))
}

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
