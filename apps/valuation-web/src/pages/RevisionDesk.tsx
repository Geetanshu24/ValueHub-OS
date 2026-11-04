import { useState } from 'react'
import { Link } from 'react-router-dom'
import { buttonClass, Card, ErrorText, errorMessage, formatDate, formatInr, ghostButtonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useAssignmentParam } from '../lib/useAssignmentParam.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface QueryRow {
  id: string
  assignmentId: string
  code: string
  kind: 'QUERY' | 'REVISION_REQUEST'
  question: string
  dueAt: string
  status: 'OPEN' | 'RESPONDED' | 'CLOSED'
  response: string | null
  responseDelivery: string | null
  escalatedAt: string | null
  escalationNote: string | null
  assignment: { code: string }
}
interface AssignmentOption {
  id: string
  code: string
  status: string
}
interface LineChange {
  component: string
  change: 'ADDED' | 'REMOVED' | 'CHANGED'
  fields?: string[]
  from?: { amount: number }
  to?: { amount: number }
}
interface ValuationDiff {
  changeReason: string | null
  header: { field: string; from: unknown; to: unknown }[]
  lines: LineChange[]
  totalDelta: number
}
interface ReportDiff extends ValuationDiff {
  fields: { field: string; from: unknown; to: unknown }[]
  limitations: { added: string[]; removed: string[] }
}

const shown = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value))

function Diff({ title, diff }: { title: string; diff: ValuationDiff | ReportDiff }) {
  const fieldChanges = 'fields' in diff ? diff.fields : diff.header
  return (
    <Card title={title}>
      {diff.changeReason && <p className="mb-2 text-sm">Reason recorded: <em>{diff.changeReason}</em></p>}
      <p className="mb-2 font-semibold">Net change in value: {diff.totalDelta >= 0 ? '+' : '−'}₹ {formatInr(Math.abs(diff.totalDelta))}</p>
      {fieldChanges.map((c) => <p key={c.field} className="text-sm"><strong>{c.field}</strong>: {shown(c.from)} → {shown(c.to)}</p>)}
      {diff.lines.map((l) => (
        <p key={l.component} className="text-sm">
          <strong>{l.component}</strong> {l.change.toLowerCase()}
          {l.fields && ` (${l.fields.join(', ')})`}
          {l.from && l.to && `: ₹ ${formatInr(l.from.amount)} → ₹ ${formatInr(l.to.amount)}`}
        </p>
      ))}
      {'limitations' in diff && diff.limitations.added.map((t) => <p key={t} className="text-sm text-brand-700">+ wording: {t}</p>)}
      {'limitations' in diff && diff.limitations.removed.map((t) => <p key={t} className="text-sm text-red-600">− wording: {t}</p>)}
      {fieldChanges.length === 0 && diff.lines.length === 0 && <p className="text-sm text-ink-soft">No differences.</p>}
    </Card>
  )
}

function Compare({ assignmentId }: { assignmentId: string }) {
  const [kind, setKind] = useState<'valuations' | 'reports'>('valuations')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('2')
  const [diff, setDiff] = useState<(ValuationDiff | ReportDiff) | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    try {
      setDiff(await api.get<ValuationDiff>(`/assignments/${assignmentId}/${kind}/compare`, { from, to }))
    } catch (caught) {
      setDiff(null)
      setError(errorMessage(caught))
    }
  }

  return (
    <>
      <Card title="Compare versions">
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputClass} aria-label="What to compare" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="valuations">Valuation versions</option>
            <option value="reports">Report versions</option>
          </select>
          <label className="text-sm">From V<input className={`${inputClass} ml-1 w-16`} type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-sm">to V<input className={`${inputClass} ml-1 w-16`} type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="button" className={buttonClass} onClick={() => void run()}>Compare</button>
        </div>
        <ErrorText message={error} />
      </Card>
      {diff && <Diff title={`${kind === 'valuations' ? 'Valuation' : 'Report'} V${from} → V${to}`} diff={diff} />}
    </>
  )
}

export default function RevisionDesk() {
  const { user } = useAuth()
  const assignments = useFetch<Paginated<AssignmentOption>>('/assignments?pageSize=100')
  const [assignmentId, setAssignmentId] = useAssignmentParam()
  const [status, setStatus] = useState('OPEN')
  const queries = useFetch<Paginated<QueryRow>>(`/queries?pageSize=100${status ? `&status=${status}` : ''}${assignmentId ? `&assignmentId=${assignmentId}` : ''}`)
  const [form, setForm] = useState({ kind: 'QUERY', question: '', dueAt: '' })
  const [error, setError] = useState<string | null>(null)
  const canAnswer = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canLog = canAnswer || user?.role === 'REVIEWER'

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      queries.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  function respond(item: QueryRow) {
    const response = window.prompt(`Response to ${item.code}`)?.trim()
    if (!response) return
    const sendTo = window.prompt('Also email this response to (leave blank to only record it)')?.trim()
    void run(() => api.post(`/queries/${item.id}/respond`, { response, ...(sendTo && { sendTo }) }))
  }

  return (
    <div>
      <PageHeader eyebrow="RECORDS" title="Revision / Query Desk" subtitle="Bank questions, correction requests and what changed between versions." />

      <select className={`${inputClass} mb-4`} value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} aria-label="Assignment">
        <option value="">All assignments</option>
        {assignments.data?.items.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.status}</option>)}
      </select>
      <ErrorText message={error ?? queries.error} />

      {assignmentId && canLog && (
        <Card title="Log a bank query or correction request">
          <div className="flex flex-wrap gap-2">
            <select className={inputClass} aria-label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="QUERY">Query</option>
              <option value="REVISION_REQUEST">Revision request (reopens a submitted assignment)</option>
            </select>
            <input className={`${inputClass} min-w-64 flex-1`} placeholder="What the bank asked" aria-label="Question" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
            <input className={inputClass} type="datetime-local" aria-label="Response due" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            <button type="button" className={buttonClass} disabled={!form.question || !form.dueAt} onClick={() => void run(async () => { await api.post(`/assignments/${assignmentId}/queries`, { ...form, dueAt: new Date(form.dueAt).toISOString() }); setForm({ ...form, question: '' }) })}>Log</button>
          </div>
        </Card>
      )}

      <div className="mb-3 flex gap-2">
        {['OPEN', 'RESPONDED', 'CLOSED', ''].map((s) => (
          <button key={s || 'ALL'} type="button" className={status === s ? buttonClass : ghostButtonClass} onClick={() => setStatus(s)}>{s ? s.toLowerCase() : 'all'}</button>
        ))}
      </div>

      {queries.data?.items.map((q) => {
        const overdue = q.status === 'OPEN' && new Date(q.dueAt) < new Date()
        return (
          <Card key={q.id} title={`${q.code} · ${q.kind === 'QUERY' ? 'Query' : 'Revision request'} · ${q.status.toLowerCase()}`}>
            <p className="text-sm text-ink-soft"><Link className="text-brand-700 hover:underline" to={`/assignments/${q.assignmentId}`}>{q.assignment.code}</Link> · respond by <span className={overdue ? 'font-semibold text-red-600' : ''}>{formatDate(q.dueAt)}{overdue && ' (overdue)'}</span></p>
            <p className="mt-1">{q.question}</p>
            {q.escalatedAt && <p className="mt-1 text-sm text-amber-700">Escalated: {q.escalationNote}</p>}
            {q.response && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">Response: {q.response}{q.responseDelivery && ` (email ${q.responseDelivery.toLowerCase()})`}</p>}
            <div className="mt-2 flex gap-2">
              {q.status === 'OPEN' && canLog && !q.escalatedAt && <button type="button" className={ghostButtonClass} onClick={() => { const note = window.prompt('Why is this being escalated?')?.trim(); if (note) void run(() => api.post(`/queries/${q.id}/escalate`, { note })) }}>Escalate</button>}
              {q.status === 'OPEN' && canAnswer && <button type="button" className={buttonClass} onClick={() => respond(q)}>Respond</button>}
              {q.status === 'RESPONDED' && canAnswer && <button type="button" className={ghostButtonClass} onClick={() => void run(() => api.post(`/queries/${q.id}/close`, {}))}>Close</button>}
              {q.kind === 'REVISION_REQUEST' && <Link className={ghostButtonClass} to={`/valuation?assignment=${q.assignmentId}`}>Revise valuation</Link>}
            </div>
          </Card>
        )
      })}
      {queries.data?.items.length === 0 && <p className="mb-4 text-ink-soft">Nothing here.</p>}

      {assignmentId && <Compare assignmentId={assignmentId} />}
    </div>
  )
}
