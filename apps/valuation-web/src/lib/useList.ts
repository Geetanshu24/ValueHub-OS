import { useEffect, useState } from 'react'
import { api, type Paginated } from './api.ts'
import { REFRESH_EVENT } from './refresh.ts'

interface ListState<T> {
  data: Paginated<T> | null
  error: string | null
  loading: boolean
}

// Fetches one page of a list endpoint; refetches when path/query change.
export function useList<T>(path: string, query: Record<string, string | number | undefined>, reloadKey = 0): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ data: null, error: null, loading: true })
  const queryKey = JSON.stringify(query)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const bump = () => setRefreshTick((n) => n + 1)
    window.addEventListener(REFRESH_EVENT, bump)
    return () => window.removeEventListener(REFRESH_EVENT, bump)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState((previous) => ({ ...previous, loading: true, error: null }))
    api
      .get<Paginated<T>>(path, JSON.parse(queryKey) as Record<string, string | number | undefined>)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (!cancelled) setState({ data: null, error: error instanceof Error ? error.message : 'Failed to load', loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [path, queryKey, reloadKey, refreshTick])

  return state
}
