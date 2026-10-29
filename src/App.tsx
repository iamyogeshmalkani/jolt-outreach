import { useEffect, useState } from 'react'
import { load, type Loaded } from './api'
import Workbench from './Workbench'

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load().then(setLoaded, (e: Error) => setError(e.message))
  }, [])

  // Pick up new people and videos the finder has added, without losing your place or your edits.
  useEffect(() => {
    const t = setInterval(() => {
      load().then(
        (next) => setLoaded((prev) => (prev ? { ...prev, people: next.people, videos: next.videos, demo: next.demo } : prev)),
        () => {},
      )
    }, 60_000)
    return () => clearInterval(t)
  }, [])

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
