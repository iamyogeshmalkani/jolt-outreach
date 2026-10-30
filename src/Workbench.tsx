import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveState, type Loaded } from './api'
import { buildItems, isToday, type Item } from './helpers'
import { DAILY_LIMIT, STATUSES, VIEWS, type UiState } from './types'
import Queue from './Queue'
import Conversation from './Conversation'
import TemplateDialog from './TemplateDialog'
import { CHUNK, getKey, setKey, writeReplies } from './ai'

type SaveState = 'saved' | 'saving' | 'error'

export default function Workbench({ loaded }: { loaded: Loaded }) {
  const [ui, setUi] = useState<UiState>(loaded.state)
  const [view, setView] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [pane, setPane] = useState<'list' | 'detail'>('list')
  const [saveStatus, setSaveStatus] = useState<SaveState>('saved')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [apiKey, setApiKey] = useState(getKey)
  const [writing, setWriting] = useState(false)
  const [aiNote, setAiNote] = useState('')
  const online = loaded.mode === 'online'

  const statuses = STATUSES
  const viewDefs = VIEWS
  const items = useMemo(() => buildItems(loaded.people, ui.cfg, ui.creators, ui.replies), [loaded.people, ui.cfg, ui.creators, ui.replies])
  const statusOf = useCallback((i: Item) => ui.statuses[i.key] ?? statuses[0], [ui.statuses, statuses])
  const viewOf = useCallback(
    (i: Item) => viewDefs.findIndex((v) => v.at.includes(statuses.indexOf(statusOf(i)))),
    [viewDefs, statuses, statusOf],
  )

  // People who said something specific go first.
  const visible = useMemo(
    () =>
      items
        .filter((i) => viewOf(i) === view)
        .sort((a, b) => Number(b.priority === 'A') - Number(a.priority === 'A')),
    [items, view, viewOf],
  )
  const current = visible.find((i) => i.key === selected) ?? visible[0] ?? null

  const viewCounts = useMemo(
    () => viewDefs.map((v, n) => ({ label: v.label, count: items.filter((i) => viewOf(i) === n).length })),
    [viewDefs, items, viewOf],
  )

  const doneToday = items.filter((i) => ui.doneAt[i.key] && isToday(ui.doneAt[i.key])).length

  // Save to disk shortly after the last change.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSaveStatus('saving')
    const t = setTimeout(() => {
      saveState(ui).then(
        () => setSaveStatus('saved'),
        () => setSaveStatus('error'),
      )
    }, 400)
    return () => clearTimeout(t)
  }, [ui])

  const select = (key: string) => {
    setSelected(key)
    setPane('detail')
  }

  const move = useCallback(
    (delta: number) => {
      if (!visible.length) return
      const idx = Math.max(0, visible.findIndex((i) => i.key === current?.key))
      const next = visible[Math.min(visible.length - 1, Math.max(0, idx + delta))]
      setSelected(next.key)
    },
    [visible, current],
  )

  const setStatus = useCallback(
    (item: Item, status: string) => {
      const idx = statuses.indexOf(status)
      // The item is leaving this view: jump to its neighbour so you keep your place.
      if (!viewDefs[view].at.includes(idx)) {
        const at = visible.findIndex((i) => i.key === item.key)
        const neighbour = visible[at + 1] ?? visible[at - 1]
        setSelected(neighbour?.key ?? null)
      }
      setUi((u) => {
        const doneAt = { ...u.doneAt }
        const worked = idx > 0 && idx < statuses.length - 1
        if (worked) doneAt[item.key] ??= new Date().toISOString()
        else delete doneAt[item.key]
        return { ...u, statuses: { ...u.statuses, [item.key]: status }, doneAt }
      })
    },
    [statuses, viewDefs, view, visible],
  )

  const setReply = (item: Item, text: string | null) =>
    setUi((u) => {
      const edits = { ...u.edits }
      if (text === null || text === item.reply) delete edits[item.key]
      else edits[item.key] = text
      return { ...u, edits }
    })

  // The public reply is kept under its own key, next to the private message's.
  const replyKey = (item: Item) => `c:${item.key}`
  const setCommentReply = (item: Item, text: string | null) =>
    setUi((u) => {
      const edits = { ...u.edits }
      if (text === null || text === item.commentReply) delete edits[replyKey(item)]
      else edits[replyKey(item)] = text
      return { ...u, edits }
    })

  // Asks the AI for the public replies of these people, a few at a time, saving each group as it arrives.
  const writeFor = async (targets: Item[]) => {
    if (!apiKey) {
      setTemplateOpen(true)
      return
    }
    setWriting(true)
    setAiNote('')
    let wrote = 0
    try {
      for (let i = 0; i < targets.length; i += CHUNK) {
        const group = targets.slice(i, i + CHUNK)
        const out = await writeReplies(apiKey, group.map((t) => t.theirs))
        setUi((u) => {
          const replies = { ...u.replies }
          const edits = { ...u.edits }
          group.forEach((t, j) => {
            const text = out[j]
            if (!text) return
            replies[t.key] = text
            delete edits[replyKey(t)] // a fresh reply replaces one edited by hand
            wrote++
          })
          return { ...u, replies, edits }
        })
      }
      if (wrote < targets.length) setAiNote(`Wrote ${wrote} of ${targets.length}. The rest broke a rule (such as having a link) and keep the standard reply.`)
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setWriting(false)
    }
  }
  const unwritten = visible.filter((i) => !i.written)

  // Switches a person between the commenter and the creator message. A message they edited by hand is kept.
  const setCreator = (item: Item, on: boolean) =>
    setUi((u) => {
      const creators = { ...u.creators }
      if (on) creators[item.key] = true
      else delete creators[item.key]
      return { ...u, creators }
    })

  const copyRef = useRef<() => void>(() => {})

  // Quiet shortcuts: J and K move through the queue, C copies the reply.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || templateOpen) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 'c') copyRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, templateOpen])

  return (
    <div className="app" data-pane={pane}>
      <header className="bar">
        <h1><i className="mark" aria-hidden="true" />Jolt outreach</h1>
        <div className="bar-end">
          <button className="quiet" onClick={() => writeFor(unwritten)} disabled={writing || (apiKey !== '' && !unwritten.length)}>
            {writing ? 'Writing replies' : unwritten.length && apiKey ? `Write ${unwritten.length} replies` : 'Write replies'}
          </button>
          <button className="quiet" onClick={() => setTemplateOpen(true)}>Settings</button>
          {online && <span className="save">Statuses are saved in this browser</span>}
          {saveStatus !== 'saved' && (
            <span className={`save save-${saveStatus}`} role="status">
              {saveStatus === 'saving' ? 'Saving' : "Couldn't save. Check the terminal."}
            </span>
          )}
        </div>
      </header>

      {loaded.demo && (
        <p className="banner">
          {online ? (
            <>
              Sample people for now. Real ones appear here once the Jolt finder extension is running in Chrome.{' '}
              <a href={`${import.meta.env.BASE_URL}jolt-finder-extension.zip`}>Get the extension</a>
            </>
          ) : (
            <>
              Sample data. Run <code>npm run find</code>, then reload. Real data is read from{' '}
              <code>{loaded.dir}</code>.
            </>
          )}
        </p>
      )}

      <Queue
        views={viewCounts}
        view={view}
        onView={setView}
        items={visible}
        currentKey={current?.key}
        statusOf={statusOf}
        onSelect={select}
        doneToday={doneToday}
        limit={DAILY_LIMIT}
        total={items.length}
      />

      <Conversation
        item={current}
        statuses={statuses}
        status={current ? statusOf(current) : statuses[0]}
        reply={current ? (ui.edits[current.key] ?? current.reply) : ''}
        edited={current ? current.key in ui.edits : false}
        commentReply={current ? (ui.edits[replyKey(current)] ?? current.commentReply) : ''}
        commentEdited={current ? replyKey(current) in ui.edits : false}
        written={current?.written ?? false}
        writing={writing}
        aiNote={aiNote}
        onCommentReply={(t) => current && setCommentReply(current, t)}
        onCommentRestore={() => current && setCommentReply(current, null)}
        onWrite={() => current && writeFor([current])}
        onReply={(t) => current && setReply(current, t)}
        onRestore={() => current && setReply(current, null)}
        onCreator={(on) => current && setCreator(current, on)}
        onStatus={(s) => current && setStatus(current, s)}
        onBack={() => setPane('list')}
        registerCopy={(fn) => { copyRef.current = fn }}
        emptyView={items.length > 0}
        online={online}
      />

      <TemplateDialog
        open={templateOpen}
        cfg={ui.cfg}
        apiKey={apiKey}
        onApiKey={(k) => { setApiKey(k); setKey(k) }}
        onChange={(cfg) => setUi((u) => ({ ...u, cfg }))}
        onClose={() => setTemplateOpen(false)}
      />
    </div>
  )
}
