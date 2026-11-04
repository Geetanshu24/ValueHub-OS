import { useCallback, useEffect, useState } from 'react'
import { api } from './api.ts'
import { REFRESH_EVENT } from './refresh.ts'

// Loads one GET endpoint; `reload` refetches after a mutation.
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    api
      .get<T>(path)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [path, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, reload)
    return () => window.removeEventListener(REFRESH_EVENT, reload)
  }, [reload])
  return { data: path ? data : null, error, reload }
}
