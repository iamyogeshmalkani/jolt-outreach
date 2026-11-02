import { useEffect, useRef } from 'react'

type Props = { open: boolean; token: string; repo: string; onToken: (t: string) => void; onClose: () => void }

export default function Settings({ open, token, repo, onToken, onClose }: Props) {
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
          GitHub token. With it, Mark complete is saved for the finder too, so it never lists that video again. It stays in this browser and is only
          sent to GitHub.
          <input type="password" autoComplete="off" placeholder="github_pat_..." value={token} onChange={(e) => onToken(e.target.value.trim())} />
        </label>
        <p className="hint">
          Use the same token as the Jolt finder extension, or make one at{' '}
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub, Fine-grained tokens</a>:
          pick Only select repositories, choose <b>{repo}</b>, and set Contents to Read and write.
        </p>
        <button className="primary">Done</button>
      </form>
    </dialog>
  )
}
