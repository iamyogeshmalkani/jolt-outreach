import type { Config, Kind, Person, Video } from './types'

// One shape for both people and videos, so the queue and conversation don't care which they show.
export type Item = {
  key: string
  kind: Kind
  title: string            // @handle shown in the queue and header
  theirs: string           // what they wrote: a comment, or the video caption
  reply: string            // the message or comment we would send
  priority?: 'A' | 'B'
  note?: string
  source: string
  sourceUrl: string        // the video this came from
  profileUrl: string
  facts?: string           // e.g. "1,204 comments, 48K likes"
}

export const sub = (text: string, cfg: Config) =>
  text
    .replaceAll('{NAME}', cfg.name.trim() || '[name]')
    .replaceAll('{OFFER}', cfg.offer.trim() || '[offer]')

export function buildItems(kind: Kind, people: Person[], videos: Video[], cfg: Config): Item[] {
  if (kind === 'people') {
    return people.map((p) => ({
      key: `p:${p.handle}`,
      kind,
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
  return videos.map((v) => ({
    key: `v:${v.url}`,
    kind,
    title: `@${v.creator}`,
    theirs: v.caption,
    reply: v.draft,
    source: v.source,
    sourceUrl: v.url,
    profileUrl: `https://www.tiktok.com/@${v.creator}`,
    facts: [v.comments && `${v.comments} comments`, v.likes && `${v.likes} likes`].filter(Boolean).join(', '),
  }))
}

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
