import type { Item } from './helpers'

type Props = {
  views: { label: string; count: number }[]
  view: number
  onView: (i: number) => void
  items: Item[]
  currentKey?: string
  statusOf: (i: Item) => string
  onSelect: (key: string) => void
  doneToday: number
  limit: number
  total: number
}

export default function Queue(p: Props) {
  return (
    <aside className="queue" aria-label="Queue">
      <div className="chips" role="group" aria-label="Show">
        {p.views.map((v, i) => (
          <button key={v.label} aria-pressed={i === p.view} onClick={() => p.onView(i)}>
            {v.label} <b>{v.count}</b>
          </button>
        ))}
      </div>

      <ul className="rows">
        {p.items.map((i) => (
          <li key={i.key}>
            <button
              className="row"
              aria-current={i.key === p.currentKey ? 'true' : undefined}
              onClick={() => p.onSelect(i.key)}
            >
              <span className="row-head">
                <span className="handle">{i.title}</span>
                {i.isNew && <span className="tag new">New</span>}
                {i.priority === 'A' && <span className="tag">Specific</span>}
                {(p.view === 2) && <span className="state">{p.statusOf(i)}</span>}
              </span>
              <span className="row-text">{i.theirs}</span>
            </button>
          </li>
        ))}
        {p.items.length === 0 && (
          <li className="rows-empty">{p.total === 0 ? 'Nothing here yet.' : 'No one here.'}</li>
        )}
      </ul>

      <p className={`today${p.doneToday >= p.limit ? ' over' : ''}`}>
        <b>{p.doneToday}</b> of {p.limit} sent today
      </p>
    </aside>
  )
}
