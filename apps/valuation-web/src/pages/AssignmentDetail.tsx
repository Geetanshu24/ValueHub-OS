import Timeline from '../components/Timeline.tsx'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_TRANSITIONS,
  type AssignmentStatus,
} from '@value-hub/valuation-shared'
import { buttonClass, Card, ErrorText, errorMessage, formatDate, ghostButtonClass, inputClass } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { nextActionFor } from '../components/WorkflowParts.tsx'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Assignment {
  id: string
  code: string
  purpose: string
  scope: string | null
  valuationDate: string
  dueDate: string
  fee: string | null
  status: AssignmentStatus
  bank: { name: string }
  branch: { name: string } | null
  property: { id: string; code: string; addressLine: string; propertyClass: string }
  assignedValuer: { id: string; fullName: string }
}
interface Hold {
  legalHold: boolean
}
interface Staff {
  id: string
  fullName: string
  role: string
}

export default function AssignmentDetail() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const assignment = useFetch<Assignment>(`/assignments/${id}`)
  const staff = useFetch<Staff[]>('/users/staff')
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ purpose: string; scope: string; dueDate: string; fee: string } | null>(null)
  const a = assignment.data
  const canEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      assignment.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!edit) return
    void run(async () => {
      await api.patch(`/assignments/${id}`, {
        purpose: edit.purpose,
        scope: edit.scope || undefined,
        dueDate: edit.dueDate,
        ...(edit.fee && { fee: Number(edit.fee) }),
      })
      setEdit(null)
    })
  }

  if (!a) return <ErrorText message={assignment.error} />

  const links = [
    ['Documents', '/documents'],
    ['Inspection', '/inspections'],
    ['Valuation', '/valuation'],
    ['Report', '/reports'],
    ['Revisions & queries', '/revisions'],
    ['Accounts', '/accounts'],
  ]

  return (
    <div>
      <Link to="/assignments" className="text-sm text-brand-700 hover:underline">← Assignments</Link>
      <h1 className="mt-2 text-2xl font-bold">{a.code}</h1>
      <p className="mb-4 text-base text-ink-soft">{a.bank.name}{a.branch ? ` · ${a.branch.name}` : ''} · {a.property.code} · {a.property.addressLine}</p>
      <ErrorText message={error ?? assignment.error} />

      {nextActionFor(a.status, id) && (
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-brand-700 to-brand-600 p-4 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider opacity-80">Next step</p>
            <p className="text-lg font-bold">{nextActionFor(a.status, id)?.label}</p>
          </div>
          <Link to={nextActionFor(a.status, id)?.to ?? '#'} className="rounded-lg bg-white px-4 py-2 text-base font-semibold text-brand-700 hover:bg-brand-50">Continue →</Link>
        </section>
      )}

      <Card title="Stage">
        <p className="mb-3">Currently <strong>{ASSIGNMENT_STATUS_LABELS[a.status]}</strong>. Move to:</p>
        <div className="flex flex-wrap gap-2">
          {ASSIGNMENT_TRANSITIONS[a.status].map((next) => (
            <button key={next} type="button" className={next === 'CANCELLED' ? ghostButtonClass : buttonClass} onClick={() => void run(() => api.patch(`/assignments/${id}/status`, { status: next }))}>
              {ASSIGNMENT_STATUS_LABELS[next]}
            </button>
          ))}
          {ASSIGNMENT_TRANSITIONS[a.status].length === 0 && <span className="text-ink-soft">No further moves.</span>}
        </div>
      </Card>

      <Card title="Details">
        {edit ? (
          <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
            <input className={inputClass} required minLength={2} aria-label="Purpose" value={edit.purpose} onChange={(e) => setEdit({ ...edit, purpose: e.target.value })} />
            <input className={inputClass} placeholder="Scope" aria-label="Scope" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} />
            <input className={inputClass} type="date" required aria-label="Due date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} />
            <input className={inputClass} type="number" step="0.01" min="0" placeholder="Fee ₹" aria-label="Fee" value={edit.fee} onChange={(e) => setEdit({ ...edit, fee: e.target.value })} />
            <div className="flex gap-2"><button type="submit" className={buttonClass}>Save</button><button type="button" className={ghostButtonClass} onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        ) : (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-ink-soft">Purpose: </dt><dd className="inline">{a.purpose}</dd></div>
            <div><dt className="inline text-ink-soft">Scope: </dt><dd className="inline">{a.scope ?? '—'}</dd></div>
            <div><dt className="inline text-ink-soft">Valuation date: </dt><dd className="inline">{formatDate(a.valuationDate)}</dd></div>
            <div><dt className="inline text-ink-soft">Due: </dt><dd className="inline">{formatDate(a.dueDate)}</dd></div>
            <div><dt className="inline text-ink-soft">Fee: </dt><dd className="inline">{a.fee ? `₹ ${Number(a.fee).toLocaleString('en-IN')}` : '—'}</dd></div>
            <div><dt className="inline text-ink-soft">Valuer: </dt><dd className="inline">{a.assignedValuer.fullName}</dd></div>
          </dl>
        )}
        {!edit && canEdit && (
          <button type="button" className={`${ghostButtonClass} mt-3`} onClick={() => setEdit({ purpose: a.purpose, scope: a.scope ?? '', dueDate: a.dueDate.slice(0, 10), fee: a.fee ?? '' })}>
            Edit details
          </button>
        )}
      </Card>

      {user?.role === 'FIRM_ADMIN' && (
        <Card title="Reallocate">
          <select className={inputClass} aria-label="Reassign valuer" value={a.assignedValuer.id} onChange={(e) => void run(() => api.patch(`/assignments/${id}`, { assignedValuerId: e.target.value }))}>
            {staff.data?.filter((s) => s.role === 'VALUER' || s.role === 'FIRM_ADMIN').map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </Card>
      )}

      {user?.role === 'FIRM_ADMIN' && (
        <Card title="Legal hold">
          <p className="mb-2 text-sm text-ink-soft">A record on legal hold is kept out of any retention review until released. Both actions need a reason and are logged.</p>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              const reason = window.prompt('Reason for placing this record on legal hold')?.trim()
              if (reason) void run(() => api.post<Hold>(`/assignments/${id}/legal-hold`, { reason }))
            }}
          >
            Place on legal hold
          </button>{' '}
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              const reason = window.prompt('Reason for releasing the legal hold')?.trim()
              if (reason) void run(() => api.post<Hold>(`/assignments/${id}/legal-hold/release`, { reason }))
            }}
          >
            Release hold
          </button>
        </Card>
      )}

      <Card title="Work on this assignment">
        <div className="flex flex-wrap gap-2">
          <Link to={`/assignments/${id}/documents`} className={ghostButtonClass}>Property &amp; Documents</Link>
          <Link to={`/assignments/${id}/inspection`} className={ghostButtonClass}>Site Inspection</Link>
          <Link to={`/assignments/${id}/comparison`} className={ghostButtonClass}>Documents vs Site</Link>
          <Link to={`/assignments/${id}/valuation`} className={ghostButtonClass}>Valuation</Link>
          <Link to={`/assignments/${id}/bank-report`} className={ghostButtonClass}>Bank report (Word / PDF)</Link>
          <Link to={`/assignments/${id}/review`} className={ghostButtonClass}>Quality Review</Link>
          <Link to={`/assignments/${id}/submission`} className={ghostButtonClass}>Approval &amp; Submission</Link>
          {links.filter(([, path]) => path !== '/documents' && path !== '/inspections' && path !== '/valuation' && path !== '/reports').map(([label, path]) => (
            <Link key={path} to={`${path}?assignment=${id}`} className={ghostButtonClass}>{label}</Link>
          ))}
        </div>
      </Card>
      <Timeline assignmentId={id} />
    </div>
  )
}
