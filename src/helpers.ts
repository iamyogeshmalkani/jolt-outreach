import type { Config, Person } from './types'

// One person to message, as the queue and conversation show them.
export type Item = {
  key: string
  title: string            // @handle
  theirs: string           // what they wrote
  reply: string            // the message we would send
  priority: 'A' | 'B'
  note?: string
  source: string
  sourceUrl: string        // the video they commented on
  profileUrl: string
}

export const sub = (text: string, cfg: Config) =>
  text
    .replaceAll('{NAME}', cfg.name.trim() || '[name]')
    .replaceAll('{OFFER}', cfg.offer.trim() || '[offer]')

export function buildItems(people: Person[], cfg: Config): Item[] {
  return people.map((p) => ({
    key: `p:${p.handle}`,
    title: `@${p.handle}`,
    theirs: p.comment,
    reply: `Hey! ${p.opener} ${sub(cfg.body.trim(), cfg)}`,
    priority: p.priority,
    note: p.note || undefined,
    source: p.source,
    sourceUrl: p.url,
    profileUrl: `https://www.tiktok.com/@${p.handle}`,
  }))
}

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
