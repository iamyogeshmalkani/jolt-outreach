import { useEffect, useState } from 'react'
import { load, type Loaded } from './api'
import Workbench from './Workbench'

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load().then(setLoaded, (e: Error) => setError(e.message))
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
