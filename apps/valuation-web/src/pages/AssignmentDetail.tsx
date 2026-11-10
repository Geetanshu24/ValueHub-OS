import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentStatus,
} from '@value-hub/valuation-shared'
import { buttonClass, Card, ErrorText, errorMessage, formatDate, ghostButtonClass, inputClass } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
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
  branch: { name: string; city: string | null; district: string | null; state: string | null } | null
  clientPhone: string | null
  borrowerName: string | null
  receivedAt: string
  assignedDrafter: { id: string; fullName: string } | null
  assignedInspector: { id: string; fullName: string } | null
  property: { id: string; code: string; addressLine: string; propertyClass: string }
  assignedValuer: { id: string; fullName: string }
  assignedAt: string
  lifecycle?: { key: string; label: string }
  acknowledgedAt: string | null
  billing?: { status: 'none' | 'unpaid' | 'part_paid' | 'paid'; amount: number; outstanding: number; code: string | null }
}
interface Step { key: string; title: string; who: string | null; state: 'todo' | 'doing' | 'done' | 'blocked'; detail: string }
const STEP_LINK: Record<string, string> = { documents: '/documents', drafter: '/workbench', inspector: '/inspection', compare: '/compare', report: '/bank-report', check: '/check' }
// Each person sees only the steps that are theirs.
const STEPS_FOR: Record<string, string[]> = { DRAFTER: ['drafter', 'compare', 'report'], INSPECTOR: ['inspector'] }
const needsPerson = (step: Step) => (step.key === 'drafter' || step.key === 'inspector') && !step.who
interface AuditRow { id: string; action: string; actorName: string | null; createdAt: string; metadata: { from?: string; to?: string } | null }
const ACTION_LABELS: Record<string, string> = {
  'assignment.created': 'Case created and assigned',
  'assignment.reallocated': 'Case given to a different valuer',
  'assignment.acknowledged': 'Valuer opened the case pop-up',
  'assignment.updated': 'Details edited',
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
  const progress = useFetch<{ steps: Step[]; rework: { id: string; kind: string; reason: string; dueDate: string | null; revision: number }[] }>(id ? `/assignments/${id}/bank-report/progress` : null)
  const trail = useFetch<{ items: AuditRow[] }>(user?.role === 'FIRM_ADMIN' && id ? `/audit?entityType=Assignment&entityId=${id}&pageSize=50` : null)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ purpose: string; scope: string; dueDate: string; fee: string } | null>(null)
  const a = assignment.data
  const canEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'

  const steps = (progress.data?.steps ?? []).filter((st) => !STEPS_FOR[user?.role ?? ''] || STEPS_FOR[user?.role ?? ''].includes(st.key))

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      assignment.reload()
      trail.reload()
      progress.reload()
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

  return (
    <div>
      <Link to="/assignments" className="text-sm text-brand-700 hover:underline">← Assignments</Link>
      <h1 className="mt-2 text-2xl font-bold">{a.code} {a.lifecycle && <span className="pd-pill is-type" style={{ verticalAlign: 'middle' }}>{a.lifecycle.label}</span>}</h1>
      <p className="mb-4 text-base text-ink-soft">{a.bank.name}{a.branch ? ` · ${a.branch.name}` : ''} · {a.property.code} · {a.property.addressLine}</p>
      <ErrorText message={error ?? assignment.error} />

      <Card title="Case briefing">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-ink-soft">Case no.: </dt><dd className="inline font-semibold">{a.code}</dd></div>
          <div><dt className="inline text-ink-soft">Logged in: </dt><dd className="inline">{new Date(a.receivedAt).toLocaleString('en-IN')}</dd></div>
          <div><dt className="inline text-ink-soft">Client: </dt><dd className="inline">{a.borrowerName ?? '—'}</dd></div>
          <div><dt className="inline text-ink-soft">Client phone: </dt><dd className="inline">{a.clientPhone ?? '—'}</dd></div>
          <div><dt className="inline text-ink-soft">Bank: </dt><dd className="inline">{a.bank.name}</dd></div>
          <div><dt className="inline text-ink-soft">Branch: </dt><dd className="inline">{a.branch ? [a.branch.name, a.branch.city, a.branch.district, a.branch.state].filter(Boolean).join(', ') : '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="inline text-ink-soft">Purpose: </dt><dd className="inline">{a.purpose}</dd></div>
          {a.billing && a.billing.status !== 'none' && <div className="sm:col-span-2"><dt className="inline text-ink-soft">Bill: </dt><dd className="inline">{a.billing.code} · ₹{a.billing.amount.toLocaleString('en-IN')} · <b className={a.billing.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}>{a.billing.status === 'paid' ? 'paid' : a.billing.status === 'part_paid' ? `part paid, ₹${a.billing.outstanding.toLocaleString('en-IN')} due` : 'unpaid'}</b></dd></div>}
          <div><dt className="inline text-ink-soft">Drafter: </dt><dd className="inline">{a.assignedDrafter?.fullName ?? '—'}</dd></div>
          <div><dt className="inline text-ink-soft">Site inspector: </dt><dd className="inline">{a.assignedInspector?.fullName ?? '—'}</dd></div>
        </dl>
      </Card>

      {(progress.data?.rework ?? []).filter((r) => user?.role === 'DRAFTER' ? r.kind !== 'REINSPECTION' : user?.role === 'INSPECTOR' ? r.kind === 'REINSPECTION' : true).map((r) => (
        <p key={r.id} className="pd-flag" role="alert"><b>{r.kind === 'DRAFTER' ? 'Returned for rework' : r.kind === 'REINSPECTION' ? 'New site visit requested' : 'More documents needed'} (round {r.revision}):</b> {r.reason}{r.dueDate ? ` · needed by ${formatDate(r.dueDate)}` : ''}</p>
      ))}

      <Card title="Where this case stands">
        <ol className="cs-list">
          {steps.map((step) => (
            <li key={step.key} className={`cs-step is-${needsPerson(step) ? 'alert' : step.state === 'blocked' ? 'wait' : step.state}`}>
              <span className="cs-dot" aria-hidden="true">{step.state === 'done' ? '✓' : step.state === 'doing' ? '…' : needsPerson(step) ? '!' : '○'}</span>
              <div className="cs-text">
                <b>{step.title}</b>
                <small>{step.who ? `${step.who} · ` : ''}{step.detail}</small>
              </div>
              {STEP_LINK[step.key] && (needsPerson(step) && canEdit
                ? <button type="button" className="pd-btn is-ghost" onClick={() => document.getElementById('team-card')?.scrollIntoView({ behavior: 'smooth' })}>Choose</button>
                : <Link to={`/assignments/${id}${STEP_LINK[step.key]}`} className={`pd-btn ${step.state === 'doing' || step.state === 'todo' ? 'is-primary' : 'is-ghost'}`}>{step.state === 'done' ? 'View' : 'Open'}</Link>)}
            </li>
          ))}
        </ol>
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
            <div><dt className="inline text-ink-soft">Assigned: </dt><dd className="inline">{new Date(a.assignedAt).toLocaleString('en-IN')} · {a.acknowledgedAt ? `seen ${new Date(a.acknowledgedAt).toLocaleString('en-IN')}` : <b className="text-amber-700">not seen yet</b>}</dd></div>
          </dl>
        )}
        {!edit && canEdit && (
          <button type="button" className={`${ghostButtonClass} mt-3`} onClick={() => setEdit({ purpose: a.purpose, scope: a.scope ?? '', dueDate: a.dueDate.slice(0, 10), fee: a.fee ?? '' })}>
            Edit details
          </button>
        )}
      </Card>

      {canEdit && (
        <div id="team-card"><Card title="Team on this case">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">Drafter
              <select className={inputClass} aria-label="Drafter" value={a.assignedDrafter?.id ?? ''} onChange={(e) => e.target.value && void run(() => api.patch(`/assignments/${id}`, { assignedDrafterId: e.target.value }))}>
                <option value="">Not assigned</option>
                {staff.data?.filter((s) => s.role === 'DRAFTER').map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
              {staff.data && !staff.data.some((s) => s.role === 'DRAFTER') && <small className="nc-hint">No drafter yet. The owner adds one in Administration → Users with the role Drafter.</small>}
            </label>
            <label className="text-sm">Site inspector
              <select className={inputClass} aria-label="Site inspector" value={a.assignedInspector?.id ?? ''} onChange={(e) => e.target.value && void run(() => api.patch(`/assignments/${id}`, { assignedInspectorId: e.target.value }))}>
                <option value="">Not assigned</option>
                {staff.data?.filter((s) => s.role === 'INSPECTOR' || s.role === 'VALUER').map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
            </label>
          </div>
        </Card>
        </div>
      )}

      {user?.role === 'FIRM_ADMIN' && (
        <Card title="Reallocate">
          <select className={inputClass} aria-label="Reassign valuer" value={a.assignedValuer.id} onChange={(e) => void run(() => api.patch(`/assignments/${id}`, { assignedValuerId: e.target.value }))}>
            {staff.data?.filter((s) => s.role === 'VALUER' || s.role === 'FIRM_ADMIN').map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </Card>
      )}

      {user?.role === 'FIRM_ADMIN' && (
        <Card title="Activity">
          {!trail.data ? <p className="text-sm text-ink-soft">Loading…</p> : trail.data.items.length === 0 ? <p className="text-sm text-ink-soft">Nothing recorded yet.</p> : (
            <ol className="space-y-1 text-sm">
              {trail.data.items.map((row) => (
                <li key={row.id}><span className="text-ink-soft">{new Date(row.createdAt).toLocaleString('en-IN')}</span> · {ACTION_LABELS[row.action] ?? (row.action === 'assignment.status_changed' ? `Moved to ${ASSIGNMENT_STATUS_LABELS[row.metadata?.to as AssignmentStatus] ?? row.metadata?.to ?? 'a new stage'}` : row.action)}{row.actorName ? ` · ${row.actorName}` : ''}</li>
              ))}
            </ol>
          )}
        </Card>
      )}

    </div>
  )
}
