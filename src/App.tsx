import { useCallback, useEffect, useState } from 'react'
import { load, type Loaded } from './api'
import Videos from './Videos'

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load().then(setLoaded, (e: Error) => setError(e.message))
  }, [])

  // Pick up new videos while the page is open (the finder adds them every time it runs).
  const refresh = useCallback(() => load().then(setLoaded, () => {}), [])
  useEffect(() => {
    if (!loaded) return
    const t = setInterval(refresh, 300_000)
    return () => clearInterval(t)
  }, [loaded !== null, refresh])

  if (error) {
    return (
      <main className="splash">
        <h1>Can't load the videos</h1>
        <p>{error}</p>
      </main>
    )
  }
  if (!loaded) return <main className="splash" aria-busy="true"><p>Loading videos</p></main>
  return <Videos loaded={loaded} onRefresh={refresh} />
}
