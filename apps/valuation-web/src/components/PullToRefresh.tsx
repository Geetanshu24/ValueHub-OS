import { useRef, useState, type ReactNode } from 'react'
import { requestRefresh } from '../lib/refresh.ts'

const THRESHOLD = 70
const MAX_PULL = 110

// Touch-screen pull-down at the top of the page reloads whatever is on screen.
// Desktop and mouse use are unaffected.
export default function PullToRefresh({ children }: { children: ReactNode }) {
  const startY = useRef<number | null>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  function onTouchStart(event: React.TouchEvent) {
    if (window.scrollY <= 0 && !refreshing) startY.current = event.touches[0].clientY
  }

  function onTouchMove(event: React.TouchEvent) {
    if (startY.current === null) return
    const distance = event.touches[0].clientY - startY.current
    if (distance <= 0 || window.scrollY > 0) {
      setPull(0)
      return
    }
    setPull(Math.min(MAX_PULL, distance * 0.5))
  }

  function onTouchEnd() {
    if (startY.current === null) return
    startY.current = null
    if (pull >= THRESHOLD * 0.5) {
      setRefreshing(true)
      setPull(THRESHOLD * 0.5)
      requestRefresh()
      window.setTimeout(() => {
        setRefreshing(false)
        setPull(0)
      }, 700)
    } else {
      setPull(0)
    }
  }

  const ready = pull >= THRESHOLD * 0.5
  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div
        aria-hidden={pull === 0}
        className="flex items-center justify-center overflow-hidden text-xs text-ink-soft transition-[height] duration-200 motion-reduce:transition-none"
        style={{ height: pull }}
      >
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : pull > 8 ? 'Pull to refresh' : ''}
      </div>
      {children}
    </div>
  )
}
