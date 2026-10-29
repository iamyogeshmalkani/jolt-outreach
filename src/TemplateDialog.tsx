import { useEffect, useRef } from 'react'
import { sub } from './helpers'
import type { Config } from './types'

type Props = { open: boolean; cfg: Config; onChange: (c: Config) => void; onClose: () => void }

export default function TemplateDialog({ open, cfg, onChange, onClose }: Props) {
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
        <h2>Message template</h2>
        <p className="hint">Messages update as you type. Edits you made to a single message are kept.</p>
        <label>
          Your first name
          <input value={cfg.name} onChange={(e) => onChange({ ...cfg, name: e.target.value })} />
        </label>
        <label>
          What they get for their time
          <input value={cfg.offer} onChange={(e) => onChange({ ...cfg, offer: e.target.value })} />
        </label>
        <label>
          Main message. {'{NAME}'} and {'{OFFER}'} fill in from above.
          <textarea rows={5} value={cfg.body} onChange={(e) => onChange({ ...cfg, body: e.target.value })} />
        </label>
        <p className="preview">{sub(cfg.body, cfg)}</p>
        <button className="primary">Done</button>
      </form>
    </dialog>
  )
}
