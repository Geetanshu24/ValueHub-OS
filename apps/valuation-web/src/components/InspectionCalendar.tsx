import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ghostButtonClass, ErrorText } from './ui.tsx'
import type { Paginated } from '../lib/api.ts'
import { useFetch } from '../lib/useFetch.ts'

interface Visit {
  id: string
  visitedAt: string
  status: string
  inspector: { fullName: string }
  assignment: { id: string; code: string; property: { addressLine: string } }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Month grid of scheduled and completed visits, Monday first.
export default function InspectionCalendar() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  const visits = useFetch<Paginated<Visit>>(`/inspections?from=${first.toISOString()}&to=${new Date(next.getTime() - 1).toISOString()}&pageSize=100`)

  const leading = (first.getDay() + 6) % 7
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const cells = [...Array<null>(leading).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const byDay = new Map<number, Visit[]>()
  for (const visit of visits.data?.items ?? []) {
    const day = new Date(visit.visitedAt).getDate()
    byDay.set(day, [...(byDay.get(day) ?? []), visit])
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <button type="button" className={ghostButtonClass} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>←</button>
        <strong>{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className={ghostButtonClass} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>→</button>
      </div>
      <ErrorText message={visits.error} />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs">
        {WEEKDAYS.map((d) => <div key={d} className="bg-slate-50 p-1 text-center font-semibold">{d}</div>)}
        {cells.map((day, i) => (
          <div key={i} className="min-h-20 bg-white p-1">
            {day && <p className="text-slate-400">{day}</p>}
            {day && byDay.get(day)?.map((v) => (
              <Link key={v.id} to={`/inspections?assignment=${v.assignment.id}`} className="mb-0.5 block truncate rounded bg-brand-50 px-1 text-brand-700" title={`${v.assignment.code} · ${v.inspector.fullName} · ${v.status}`}>
                {new Date(v.visitedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} {v.assignment.code.slice(-5)}
              </Link>
            ))}
          </div>
        ))}
      </div>
      {visits.data && <p className="mt-2 text-xs text-slate-500">{visits.data.total} visit(s) this month</p>}
    </div>
  )
}
