import { useCallback, useEffect, useState } from 'react'
import { load, type Loaded } from './api'
import type { Platform } from './types'
import Videos from './Videos'

// Instagram is the default; the TikTok list is at #tiktok
const fromHash = (): Platform => (location.hash === '#tiktok' ? 'tiktok' : 'instagram')

export default function App() {
  const [platform, setPlatform] = useState<Platform>(fromHash)
  const [loaded, setLoaded] = useState<Partial<Record<Platform, Loaded>>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    const onHash = () => setPlatform(fromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  // Each list is loaded the first time it is shown.
  useEffect(() => {
    if (loaded[platform]) return
    setError('')
    load(platform).then((l) => setLoaded((prev) => ({ ...prev, [platform]: l })), (e: Error) => setError(e.message))
  }, [platform, loaded[platform] === undefined])

  // Pick up new videos while the page is open (the finders add them every time they run).
  const refresh = useCallback(() => load(platform).then((l) => setLoaded((prev) => ({ ...prev, [platform]: l })), () => {}), [platform])
  const here = loaded[platform]
  useEffect(() => {
    if (!here) return
    const t = setInterval(refresh, 300_000)
    return () => clearInterval(t)
  }, [here !== undefined, refresh])

  const choose = (p: Platform) => {
    location.hash = p === 'tiktok' ? '#tiktok' : ''
    setPlatform(p)
  }

  if (error) {
    return (
      <main className="splash">
        <h1>Can't load the videos</h1>
        <p>{error}</p>
      </main>
    )
  }
  if (!here) return <main className="splash" aria-busy="true"><p>Loading videos</p></main>
  return <Videos key={platform} platform={platform} onPlatform={choose} loaded={here} onRefresh={refresh} />
}
