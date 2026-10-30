import { useEffect, useRef } from 'react'
import type { Config } from './types'

type Props = { open: boolean; cfg: Config; apiKey: string; onApiKey: (k: string) => void; onChange: (c: Config) => void; onClose: () => void }

export default function TemplateDialog({ open, cfg, apiKey, onApiKey, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} className="template" onClose={onClose}>
      <form method="dialog">
        <h2>Settings</h2>
        <label>
          Groq API key, used to write the replies under comments. It stays in this browser and is only sent to Groq.
          <input type="password" autoComplete="off" placeholder="gsk_..." value={apiKey} onChange={(e) => onApiKey(e.target.value)} />
        </label>
        <p className="hint">Messages update as you type. Edits you made to a single message are kept.</p>
        <label>
          Your first name
          <input value={cfg.name} onChange={(e) => onChange({ ...cfg, name: e.target.value })} />
        </label>
        <label>
          Message to people who comment. {'{NAME}'} is their name and {'{ME}'} is yours.
          <textarea rows={10} value={cfg.commenterBody} onChange={(e) => onChange({ ...cfg, commenterBody: e.target.value })} />
        </label>
        <label>
          Message to creators. Replace [specific project/topic] on each message.
          <textarea rows={10} value={cfg.creatorBody} onChange={(e) => onChange({ ...cfg, creatorBody: e.target.value })} />
        </label>
        <button className="primary">Done</button>
      </form>
    </dialog>
  )
}
