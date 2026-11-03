import { useMemo, useState } from 'react'
import { getToken, setDone, setToken, type Loaded } from './api'
import { ageText, formatCount, videoKey } from './helpers'
import Settings from './Settings'
import type { Platform, Video } from './types'

const REPO: string = import.meta.env.VITE_REPO ?? 'iamyogeshmalkani/jolt-outreach'

const NAMES: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram' }
// Where to write to the person who left a comment.
const profileUrl = (platform: Platform, handle: string) =>
  platform === 'instagram' ? `https://www.instagram.com/${encodeURIComponent(handle)}/` : `https://www.tiktok.com/@${encodeURIComponent(handle)}`

export default function Videos({ platform, onPlatform, loaded, onRefresh }: {
  platform: Platform
  onPlatform: (p: Platform) => void
  loaded: Loaded
  onRefresh: () => Promise<void>
}) {
  const [view, setView] = useState<'videos' | 'comments'>('videos')
  const [tab, setTab] = useState<'todo' | 'done'>('todo')
  const [done, setDoneKeys] = useState(() => new Set(loaded.done.map((d) => videoKey(d.url))))
  const [token, setTokenState] = useState(getToken)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')

  // The server's list is the truth; anything marked here but not yet seen there is kept until it shows up.
  const doneKeys = useMemo(() => new Set([...loaded.done.map((d) => videoKey(d.url)), ...done]), [loaded.done, done])

  const latest = useMemo(() => loaded.videos.reduce((max, v) => (v.found > max ? v.found : max), ''), [loaded.videos])
  const sorted = useMemo(
    () => [...loaded.videos].sort((a, b) => b.found.localeCompare(a.found) || (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0)),
    [loaded.videos],
  )
  const todo = sorted.filter((v) => !doneKeys.has(videoKey(v.url)))
  const finished = sorted.filter((v) => doneKeys.has(videoKey(v.url)))
  const shown = tab === 'todo' ? todo : finished

  // Every saved comment with the video it is on, newest run first.
  const people = useMemo(
    () => sorted.flatMap((v) => (v.matches ?? []).map((c) => ({ ...c, video: v }))),
    [sorted],
  )

  async function mark(v: Video, on: boolean) {
    const key = videoKey(v.url)
    setBusy(key)
    setNote('')
    try {
      const where = await setDone(platform, v.url, on)
      setDoneKeys((prev) => {
        const next = new Set(prev)
        if (on) next.add(key)
        else next.delete(key)
        return next
      })
      if (where === 'local') {
        setNote(
          on
            ? 'Marked complete in this browser only. Add a GitHub token in Settings so the finder never lists it again.'
            : 'Brought back in this browser. Add a GitHub token in Settings to bring it back for the finder too.',
        )
      }
      if (!on) await onRefresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy('')
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied((c) => (c === url ? '' : c)), 1500)
    } catch {
      setNote('Could not copy. Open the video and copy the address from there.')
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <h1><i className="mark" aria-hidden="true" />Jolt videos</h1>
        <div className="chips" role="group" aria-label="Platform">
          {(Object.keys(NAMES) as Platform[]).map((p) => (
            <button key={p} aria-pressed={platform === p} onClick={() => onPlatform(p)}>{NAMES[p]}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="View">
          <button aria-pressed={view === 'videos'} onClick={() => setView('videos')}>Videos <b>{loaded.videos.length}</b></button>
          <button aria-pressed={view === 'comments'} onClick={() => setView('comments')}>Comments <b>{people.length}</b></button>
        </div>
        {view === 'videos' && (
          <div className="chips" role="group" aria-label="Show">
            <button aria-pressed={tab === 'todo'} onClick={() => setTab('todo')}>To do <b>{todo.length}</b></button>
            <button aria-pressed={tab === 'done'} onClick={() => setTab('done')}>Complete <b>{finished.length}</b></button>
          </div>
        )}
        <div className="bar-end">
          <button className="quiet" onClick={() => onRefresh()}>Refresh</button>
          <button className="quiet" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      {!token && (
        <p className="banner">
          Mark complete is saved in this browser only until you add a GitHub token in Settings. With a token, the finder also never lists that video again.
        </p>
      )}
      {note && <p className="banner" role="status">{note}</p>}

      {view === 'comments' && (
        <main className="videos">
          {people.length === 0 && (
            <p className="empty">
              {loaded.videos.some((v) => v.matches !== undefined)
                ? 'No saved comment is about screen time or digital habits yet. The finder checks the top comments of every video it keeps.'
                : 'No comments yet. Update the finder extension, run it, and the comments it keeps appear here with a link to each person.'}
            </p>
          )}
          <ul>
            {people.map((c, i) => (
              <li key={`${c.handle}-${videoKey(c.video.url)}-${i}`} className="video">
                <p className="v-caption">{c.text}</p>
                <p className="v-facts">
                  <b>@{c.handle}</b>
                  <span>{c.topics.join(', ')}</span>
                  <span>on {c.video.creator ? `@${c.video.creator}'s` : 'a'} video</span>
                </p>
                <div className="v-actions">
                  <a className="primary" href={profileUrl(platform, c.handle)} target="_blank" rel="noopener noreferrer">Open profile</a>
                  <button className="secondary" onClick={() => copy(profileUrl(platform, c.handle))}>
                    {copied === profileUrl(platform, c.handle) ? 'Copied' : 'Copy profile link'}
                  </button>
                  <a className="secondary" href={c.video.url} target="_blank" rel="noopener noreferrer">Open video</a>
                </div>
              </li>
            ))}
          </ul>
        </main>
      )}

      {view === 'videos' && <main className="videos">
        {shown.length === 0 && (
          <p className="empty">
            {loaded.videos.length === 0
              ? `No videos yet. Run the Jolt ${NAMES[platform]} finder extension in Chrome and they will appear here.`
              : tab === 'todo'
                ? 'Nothing left to do. New videos show up after the next finder run.'
                : 'No video is marked complete yet.'}
          </p>
        )}
        <ul>
          {shown.map((v) => {
            const key = videoKey(v.url)
            const age = ageText(v.posted)
            return (
              <li key={key} className="video">
                <p className="v-caption">
                  {v.found === latest && tab === 'todo' && <span className="tag new">New</span>}
                  {v.caption || 'No caption'}
                </p>
                <p className="v-facts">
                  {v.creator && <b>@{v.creator}</b>}
                  {v.views != null && <span>{formatCount(v.views)} views</span>}
                  {platform === 'instagram' && <span>{v.likes != null ? `${formatCount(v.likes)} likes` : 'likes hidden'}</span>}
                  {v.comments != null && <span>{formatCount(v.comments)} comments</span>}
                  {age && <span>{age}</span>}
                  <span>found for “{v.topic}”</span>
                </p>
                {v.matches !== undefined && (
                  <div className="v-comments">
                    <p className="hint">
                      {v.read === 0
                        ? 'The comments could not be read for this video.'
                        : `${v.matches.length} of the top ${v.read ?? '?'} comments ${v.matches.length === 1 ? 'is' : 'are'} about the topics.`}
                    </p>
                    {v.matches.length > 0 && (
                      <ul>
                        {v.matches.map((c, i) => (
                          <li key={`${c.handle}-${i}`}>
                            <b>@{c.handle}</b>
                            <p>{c.text}</p>
                            <span className="topics">{c.topics.join(', ')}</span>
                            <span className="c-actions">
                              <a className="secondary" href={profileUrl(platform, c.handle)} target="_blank" rel="noopener noreferrer">Open profile</a>
                              <button className="quiet" onClick={() => copy(profileUrl(platform, c.handle))}>
                                {copied === profileUrl(platform, c.handle) ? 'Copied' : 'Copy profile link'}
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="v-actions">
                  <a className="primary" href={v.url} target="_blank" rel="noopener noreferrer">{platform === 'instagram' ? 'Open reel' : 'Open video'}</a>
                  <button className="secondary" onClick={() => copy(v.url)}>{copied === v.url ? 'Copied' : 'Copy link'}</button>
                  {tab === 'todo' ? (
                    <button className="secondary" disabled={busy === key} onClick={() => mark(v, true)}>
                      {busy === key ? 'Saving' : 'Mark complete'}
                    </button>
                  ) : (
                    <button className="quiet" disabled={busy === key} onClick={() => mark(v, false)}>
                      {busy === key ? 'Saving' : 'Bring back'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </main>}

      <Settings
        open={settingsOpen}
        token={token}
        repo={REPO}
        onToken={(t) => { setTokenState(t); setToken(t) }}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
