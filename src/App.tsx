import { useCallback, useEffect, useState } from 'react'
import { load, type Loaded } from './api'
import Workbench from './Workbench'

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load().then(setLoaded, (e: Error) => setError(e.message))
  }, [])

  // Pick up new people and videos without losing your place or your edits.
  const refresh = useCallback(
    () =>
      load().then(
        (next) => setLoaded((prev) => (prev ? { ...prev, people: next.people, videos: next.videos, demo: next.demo } : prev)),
        () => {},
      ),
    [],
  )

  // The finder adds people while the page is open: every minute on your computer, every 5 minutes online.
  useEffect(() => {
    if (!loaded) return
    const t = setInterval(refresh, loaded.mode === 'local' ? 60_000 : 300_000)
    return () => clearInterval(t)
  }, [loaded?.mode, refresh])

  if (error) {
    return (
      <main className="splash">
        <h1>Can't load your outreach</h1>
        <p>{error}</p>
      </main>
    )
  }
  if (!loaded) return <main className="splash" aria-busy="true"><p>Loading your queue</p></main>
  return <Workbench loaded={loaded} />
}
