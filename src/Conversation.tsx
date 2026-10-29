import { useEffect, useRef, useState } from 'react'
import type { Item } from './helpers'
import { NEXT_STEP, type Kind } from './types'

type Props = {
  item: Item | null
  statuses: string[]
  status: string
  reply: string
  edited: boolean
  onReply: (text: string) => void
  onRestore: () => void
  onStatus: (s: string) => void
  onBack: () => void
  registerCopy: (fn: () => void) => void
  emptyView: boolean
  kind: Kind
}

export default function Conversation(p: Props) {
  const [copied, setCopied] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const replyRef = useRef(p.reply)
  replyRef.current = p.reply

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(replyRef.current)
    } catch {
      area.current?.select()
      document.execCommand('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  useEffect(() => p.registerCopy(copy)) // always points at the latest reply

  const script = `python jolt_outreach.py${p.kind === 'videos' ? ' --videos' : ''}`

  if (!p.item) {
    return (
      <main className="convo convo-empty">
        {p.emptyView ? (
          <>
            <h2>All clear here</h2>
            <p>Pick another view, or run <code>{script}</code> to find more.</p>
          </>
        ) : (
          <>
            <h2>Nothing to show yet</h2>
            <p>Run <code>{script}</code>, then reload this page.</p>
          </>
        )}
      </main>
    )
  }

  const { item } = p
  const isPeople = p.kind === 'people'
  const idx = p.statuses.indexOf(p.status)
  const next = idx <= 2 ? { label: NEXT_STEP[p.kind][idx], to: p.statuses[idx + 1] } : null
  const skipped = idx === p.statuses.length - 1
  const copyLabel = copied ? 'Copied' : isPeople ? 'Copy message' : 'Copy comment'

  return (
    <main className="convo">
      <header className="convo-head">
        <button className="back" onClick={p.onBack}>Back</button>
        <h2>
          {item.title}
          {idx > 0 && <span className="pill">{p.status}</span>}
        </h2>
        <div className="links">
          <a href={item.profileUrl} target="_blank" rel="noopener noreferrer">Profile</a>
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Video</a>
          {item.facts && <span className="facts">{item.facts}</span>}
        </div>
      </header>

      <section className="thread" aria-label="Conversation">
        <blockquote className="in" key={item.key}>{item.theirs}</blockquote>
        {item.note && <p className="note">{item.note}</p>}

        <div className="out">
          <label className="sr" htmlFor="reply">{isPeople ? 'Your message' : 'Your comment'}</label>
          <textarea id="reply" ref={area} value={p.reply} rows={5} onChange={(e) => p.onReply(e.target.value)} />
        </div>
        {p.edited && <button className="quiet restore" onClick={p.onRestore}>Restore original</button>}
      </section>

      <div className="actions">
        {skipped ? (
          <button className="primary" onClick={() => p.onStatus(p.statuses[0])}>Put back in the queue</button>
        ) : (
          <>
            <button className={idx === 0 ? 'primary' : 'secondary'} onClick={copy}>{copyLabel}</button>
            {next && (
              <button className={idx === 0 ? 'secondary' : 'primary'} onClick={() => p.onStatus(next.to)}>
                {next.label}
              </button>
            )}
            {idx === 0 && <button className="quiet" onClick={() => p.onStatus(p.statuses[p.statuses.length - 1])}>Skip</button>}
          </>
        )}
        {idx === 3 && <p className="done">{isPeople ? 'Interview booked.' : 'Moved to a DM.'}</p>}
      </div>
    </main>
  )
}
