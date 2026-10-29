import { useEffect, useRef, useState } from 'react'
import type { Item } from './helpers'
import { NEXT_STEP, PREV_STEP } from './types'

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
  online: boolean
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

  if (!p.item) {
    return (
      <main className="convo convo-empty">
        {p.emptyView ? (
          <>
            <h2>All clear here</h2>
            <p>Pick another view. New people appear here as the finder finds them.</p>
          </>
        ) : (
          <>
            <h2>No people yet</h2>
            <p>
              {p.online
                ? <>The Jolt finder extension in Chrome publishes here, and this page updates within about 5 minutes.</>
                : <>Run <code>npm run find</code>, then reload this page.</>}
            </p>
          </>
        )}
      </main>
    )
  }

  const { item } = p
  const idx = p.statuses.indexOf(p.status)
  const next = idx <= 2 ? { label: NEXT_STEP[idx], to: p.statuses[idx + 1] } : null
  const prev = idx >= 1 && idx <= 3 ? { label: PREV_STEP[idx - 1], to: p.statuses[idx - 1] } : null
  const skipped = idx === p.statuses.length - 1
  const copyLabel = copied ? 'Copied' : 'Copy message'

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
        </div>
      </header>

      <section className="thread" aria-label="Conversation">
        <blockquote className="in" key={item.key}>{item.theirs}</blockquote>
        {item.note && <p className="note">{item.note}</p>}

        <div className="out">
          <label className="sr" htmlFor="reply">Your message</label>
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
            {prev && <button className="quiet" onClick={() => p.onStatus(prev.to)}>{prev.label}</button>}
            {idx === 0 && <button className="quiet" onClick={() => p.onStatus(p.statuses[p.statuses.length - 1])}>Skip</button>}
          </>
        )}
        {idx === 3 && <p className="done">Interview booked.</p>}
      </div>
    </main>
  )
}
