import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveState, type Loaded } from './api'
import { buildItems, isToday, type Item } from './helpers'
import { DAILY_LIMIT, STATUSES, VIEWS, type Kind, type UiState } from './types'
import Queue from './Queue'
import Conversation from './Conversation'
import TemplateDialog from './TemplateDialog'

type SaveState = 'saved' | 'saving' | 'error'

export default function Workbench({ loaded }: { loaded: Loaded }) {
  const [ui, setUi] = useState<UiState>(loaded.state)
  const [kind, setKind] = useState<Kind>('people')
  const [views, setViews] = useState<Record<Kind, number>>({ people: 0, videos: 0 })
  const [selected, setSelected] = useState<Record<Kind, string | null>>({ people: null, videos: null })
  const [pane, setPane] = useState<'list' | 'detail'>('list')
  const [saveStatus, setSaveStatus] = useState<SaveState>('saved')
  const [templateOpen, setTemplateOpen] = useState(false)
  const online = loaded.mode === 'online'

  const statuses = STATUSES[kind]
  const viewDefs = VIEWS[kind]
  const view = views[kind]
  const items = useMemo(
    () => buildItems(kind, loaded.people, loaded.videos, ui.cfg),
    [kind, loaded.people, loaded.videos, ui.cfg],
  )
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
  const current = visible.find((i) => i.key === selected[kind]) ?? visible[0] ?? null

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
    setSelected((s) => ({ ...s, [kind]: key }))
    setPane('detail')
  }

  const move = useCallback(
    (delta: number) => {
      if (!visible.length) return
      const idx = Math.max(0, visible.findIndex((i) => i.key === current?.key))
      const next = visible[Math.min(visible.length - 1, Math.max(0, idx + delta))]
      setSelected((s) => ({ ...s, [kind]: next.key }))
    },
    [visible, current, kind],
  )

  const setStatus = useCallback(
    (item: Item, status: string) => {
      const idx = statuses.indexOf(status)
      // The item is leaving this view: jump to its neighbour so you keep your place.
      if (!viewDefs[view].at.includes(idx)) {
        const at = visible.findIndex((i) => i.key === item.key)
        const neighbour = visible[at + 1] ?? visible[at - 1]
        setSelected((s) => ({ ...s, [kind]: neighbour?.key ?? null }))
      }
      setUi((u) => {
        const doneAt = { ...u.doneAt }
        const worked = idx > 0 && idx < statuses.length - 1
        if (worked) doneAt[item.key] ??= new Date().toISOString()
        else delete doneAt[item.key]
        return { ...u, statuses: { ...u.statuses, [item.key]: status }, doneAt }
      })
    },
    [statuses, viewDefs, view, visible, kind],
  )

  const setReply = (item: Item, text: string | null) =>
    setUi((u) => {
      const edits = { ...u.edits }
      if (text === null || text === item.reply) delete edits[item.key]
      else edits[item.key] = text
      return { ...u, edits }
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
        <nav className="tabs" aria-label="What to work on">
          {(['people', 'videos'] as Kind[]).map((k) => (
            <button
              key={k}
              aria-current={k === kind ? 'page' : undefined}
              onClick={() => { setKind(k); setPane('list') }}
            >
              {k === 'people' ? 'Messages' : 'Comments'}
            </button>
          ))}
        </nav>
        <div className="bar-end">
          {kind === 'people' && <button className="quiet" onClick={() => setTemplateOpen(true)}>Message template</button>}
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
              Sample data. Run <code>npm run find</code> and <code>npm run videos</code>, then reload. Real data is read from{' '}
              <code>{loaded.dir}</code>.
            </>
          )}
        </p>
      )}

      <Queue
        views={viewCounts}
        view={view}
        onView={(n) => setViews((s) => ({ ...s, [kind]: n }))}
        items={visible}
        currentKey={current?.key}
        statusOf={statusOf}
        onSelect={select}
        doneToday={doneToday}
        limit={DAILY_LIMIT[kind]}
        verb={kind === 'people' ? 'sent' : 'posted'}
        total={items.length}
      />

      <Conversation
        item={current}
        statuses={statuses}
        status={current ? statusOf(current) : statuses[0]}
        reply={current ? (ui.edits[current.key] ?? current.reply) : ''}
        edited={current ? current.key in ui.edits : false}
        onReply={(t) => current && setReply(current, t)}
        onRestore={() => current && setReply(current, null)}
        onStatus={(s) => current && setStatus(current, s)}
        onBack={() => setPane('list')}
        registerCopy={(fn) => { copyRef.current = fn }}
        emptyView={items.length > 0}
        online={online}
        kind={kind}
      />

      <TemplateDialog
        open={templateOpen}
        cfg={ui.cfg}
        onChange={(cfg) => setUi((u) => ({ ...u, cfg }))}
        onClose={() => setTemplateOpen(false)}
      />
    </div>
  )
}
