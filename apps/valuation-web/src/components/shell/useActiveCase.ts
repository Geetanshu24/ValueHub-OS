import { useEffect } from 'react'
import { useMatch } from 'react-router-dom'

const KEY = 'valuerpro-active-case'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }

// The case the sidebar works on: the one in the address, else the last one opened.
export function useActiveCase(): string | null {
  const match = useMatch('/assignments/:id/*')
  const fromRoute = match?.params.id && match.params.id !== 'new' ? match.params.id : null
  useEffect(() => { if (fromRoute) { try { localStorage.setItem(KEY, fromRoute) } catch { /* remembering is optional */ } } }, [fromRoute])
  return fromRoute ?? read()
}
