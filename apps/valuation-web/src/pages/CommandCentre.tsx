import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ASSIGNMENT_PRIORITY_LABELS, ASSIGNMENT_STATUS_LABELS, type AssignmentPriority, type AssignmentStatus } from '@value-hub/valuation-shared'
import { dueLabel, FLOW, nextActionFor } from '../components/WorkflowParts.tsx'
import { formatInr } from '../components/ui.tsx'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Summary {
  assignments?: { open: number; newThisWeek: number; dueToday: number; overdue: number; byStatus: Record<AssignmentStatus, number> }
  inspections: { upcomingWeek: number; inProgress: number; awaitingFieldReview: number }
  reports?: { awaitingValuation: number; awaitingQc: number; awaitingSignature: number }
  queries?: { open: number; dueWithinTwoDays: number }
  receivables?: { invoiced: number; received: number; outstanding: number; ageing: Record<string, number> }
}
interface Reminder { type: string; assignmentId: string; ref: string; dueAt: string; overdue: boolean; message: string }
interface Workload { id: string; fullName: string; role: string; openAssignments: number; overdueAssignments: number; pendingInspections: number }
interface Submitted { total: number; groups: { label: string; count: number }[] }
interface QueueItem {
  id: string; code: string; status: AssignmentStatus; dueDate: string; priority: AssignmentPriority; borrowerName: string | null
  bank: { name: string }; property: { addressLine: string }; assignedValuer: { fullName: string }; visitAt: string | null; visitStatus: string | null
}

// Which stage statuses make up each of the six workflow steps.
const PIPELINE: { step: string; statuses: AssignmentStatus[] }[] = [
  { step: FLOW[0], statuses: ['INTAKE'] },
  { step: FLOW[1], statuses: ['DOCUMENTS'] },
  { step: FLOW[2], statuses: ['INSPECTION'] },
  { step: FLOW[3], statuses: ['VALUATION', 'REVISION'] },
  { step: FLOW[4], statuses: ['QUALITY_REVIEW'] },
  { step: FLOW[5], statuses: ['APPROVED', 'SUBMITTED'] },
]
const AGEING_LABEL: Record<string, string> = { current: 'Not yet due', d1to30: '1–30 days', d31to60: '31–60 days', d61to90: '61–90 days', d90plus: '90+ days' }
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

function Tile({ label, value, tone, to, hint }: { label: string; value: number | string; tone?: 'warn' | 'bad'; to?: string; hint?: string }) {
  const hot = tone && Number(value) > 0
  const body = <div className={`cc-tile ${hot ? `is-${tone}` : ''}`}><small>{label}</small><b>{value}</b>{hint && <span>{hint}</span>}</div>
  return to ? <Link to={to} className="cc-tile-link">{body}</Link> : body
}

export default function CommandCentre() {
  const { user } = useAuth()
  const summary = useFetch<Summary>('/dashboard/summary')
  const queue = useFetch<QueueItem[]>('/dashboard/work-queue')
  const canSeeAll = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'REVIEWER'
  const workload = useFetch<Workload[]>(canSeeAll ? '/dashboard/workload' : null)
  const [groupBy, setGroupBy] = useState('bank')
  const submitted = useFetch<Submitted>(canSeeAll ? `/dashboard/submitted?groupBy=${groupBy}` : null)
  const gaps = useFetch<{ id: string; code: string; missing: string[] }[]>(user?.role === 'FIRM_ADMIN' || user?.role === 'REVIEWER' ? '/dashboard/archive-gaps' : null)
  const reminders = useFetch<Reminder[]>(user?.role === 'INSPECTOR' ? null : '/dashboard/reminders')
  const s = summary.data
  const first = user?.fullName.split(' ')[0] ?? ''
  const isInspector = user?.role === 'INSPECTOR'
  const maxStage = Math.max(1, ...PIPELINE.map((p) => (s?.assignments ? p.statuses.reduce((n, st) => n + s.assignments!.byStatus[st], 0) : 0)))

  return <div className="pd-shell">
    <header className="pd-heading"><div><p className="pd-eyebrow">COMMAND CENTRE <span>/</span> {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</p><h1>{greeting()}, {first}</h1><p>{isInspector ? 'Your site visits, in the order they are due.' : 'Where every assignment stands, and what needs you next.'}</p></div>
      {!isInspector && <Link to="/assignments/new" className="pd-btn is-primary">＋ New assignment</Link>}</header>
    {summary.error && <p role="alert" className="pd-flag">{summary.error}</p>}

    {s?.assignments && <div className="cc-tiles">
      <Tile label="Open assignments" value={s.assignments.open} to="/assignments" />
      <Tile label="Due today" value={s.assignments.dueToday} tone="warn" to="/assignments" />
      <Tile label="Overdue" value={s.assignments.overdue} tone="bad" to="/assignments?overdue=true" />
      <Tile label="New this week" value={s.assignments.newThisWeek} />
      <Tile label="Open bank queries" value={s.queries?.open ?? 0} tone="warn" hint={s.queries?.dueWithinTwoDays ? `${s.queries.dueWithinTwoDays} due within 2 days` : undefined} to="/revisions" />
      {s.receivables && <Tile label="Outstanding" value={`₹ ${formatInr(s.receivables.outstanding)}`} to="/accounts" />}
    </div>}
    {isInspector && s && <div className="cc-tiles">
      <Tile label="Visits in next 7 days" value={s.inspections.upcomingWeek} />
      <Tile label="In progress" value={s.inspections.inProgress} />
      <Tile label="Submitted, awaiting review" value={s.inspections.awaitingFieldReview} />
    </div>}

    {s?.assignments && <section className="pd-card cc-pipeline" aria-labelledby="cc-pipe-h">
      <div className="pd-card-head"><div><span className="pd-step-tag">▤</span><div><h2 id="cc-pipe-h">Pipeline</h2><p>Open assignments by workflow step. Select a step to see them.</p></div></div></div>
      <div className="cc-pipe">{PIPELINE.map((p, i) => {
        const count = p.statuses.reduce((n, st) => n + s.assignments!.byStatus[st], 0)
        const first = p.statuses[0]
        return <Link key={p.step} to={`/assignments?status=${first}`} className={`cc-stage ${count ? '' : 'is-empty'}`}><span className="cc-stage-n">{i + 1}</span><small>{p.step}</small><b>{count}</b><i><em style={{ width: `${(count / maxStage) * 100}%` }} /></i></Link>
      })}</div>
      <p className="cc-closed">Closed so far: <b>{s.assignments.byStatus.CLOSED}</b></p>
    </section>}

    <div className="pd-grid">
      <div className="pd-main">
        <section className="pd-card" aria-labelledby="cc-q-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">1</span><div><h2 id="cc-q-h">{isInspector ? 'Your visits' : 'Work queue'}</h2><p>{isInspector ? 'Open a visit to measure, photograph and record.' : user?.role === 'VALUER' ? 'Your assignments, earliest due first.' : 'Open work, earliest due first. Each row opens the step it is waiting on.'}</p></div></div>{!isInspector && <Link to="/assignments" className="pd-btn is-ghost">All assignments →</Link>}</div>
          {!queue.data ? <p className="pd-muted">Loading…</p> : queue.data.length === 0 ? <div className="pd-empty"><b>Nothing waiting on you</b><p>{isInspector ? 'No site visits are scheduled for you.' : 'Every assignment is moving. New instructions appear here.'}</p></div> : <div className="cc-queue">{queue.data.map((q) => {
            const due = dueLabel(q.dueDate)
            const next = nextActionFor(q.status, q.id)
            return <article key={q.id}>
              <div className="cc-q-main"><div className="cc-q-top"><Link to={`/assignments/${q.id}`} className="cc-q-code">{q.code}</Link><span className="pd-pill is-type">{ASSIGNMENT_STATUS_LABELS[q.status]}</span>{q.priority !== 'NORMAL' && <span className={`pd-prio is-${q.priority.toLowerCase()} cc-prio`}>{ASSIGNMENT_PRIORITY_LABELS[q.priority]}</span>}</div>
                <b title={q.property.addressLine}>{q.property.addressLine}</b>
                <small>{q.bank.name}{q.borrowerName ? ` · ${q.borrowerName}` : ''}{!isInspector && user?.role !== 'VALUER' ? ` · ${q.assignedValuer.fullName}` : ''}</small></div>
              <div className="cc-q-due"><span className={`cc-due is-${due.tone}`}>{q.visitAt ? `Visit ${new Date(q.visitAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : due.text}</span><small>{q.visitAt ? `due ${due.text}` : `due ${new Date(q.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}</small></div>
              {next && <Link to={next.to} className="pd-btn is-primary">{isInspector ? 'Open visit' : next.label} →</Link>}
            </article>
          })}</div>}
        </section>

        {canSeeAll && workload.data && workload.data.length > 0 && <section className="pd-card" aria-labelledby="cc-w-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">2</span><div><h2 id="cc-w-h">Team workload</h2><p>Open work per person, for allocating the next assignment.</p></div></div></div>
          <div className="in-table-wrap"><table className="in-table"><thead><tr><th>Person</th><th>Role</th><th className="is-num">Open</th><th className="is-num">Overdue</th><th className="is-num">Visits pending</th></tr></thead><tbody>
            {workload.data.map((p) => <tr key={p.id}><td><b>{p.fullName}</b></td><td>{p.role.replace('_', ' ').toLowerCase()}</td><td className="is-num">{p.openAssignments}</td><td className={`is-num ${p.overdueAssignments ? 'cc-late' : ''}`}>{p.overdueAssignments}</td><td className="is-num">{p.pendingInspections}</td></tr>)}
          </tbody></table></div>
        </section>}

        {s?.receivables && <section className="pd-card" aria-labelledby="cc-r-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">3</span><div><h2 id="cc-r-h">Receivables</h2><p>What has been invoiced, what has come in, and how late the rest is.</p></div></div><Link to="/accounts" className="pd-btn is-ghost">Open Accounts →</Link></div>
          <div className="va-rates"><div><small>Invoiced</small><b>₹ {formatInr(s.receivables.invoiced)}</b></div><div><small>Received</small><b>₹ {formatInr(s.receivables.received)}</b></div><div><small>Outstanding</small><b>₹ {formatInr(s.receivables.outstanding)}</b></div></div>
          <div className="cc-ageing">{Object.entries(s.receivables.ageing).map(([k, v]) => <div key={k} className={Number(v) > 0 && k !== 'current' ? 'is-late' : ''}><small>{AGEING_LABEL[k]}</small><b>₹ {formatInr(v)}</b></div>)}</div>
        </section>}
      </div>

      <aside className="pd-aside cc-aside">
        {reminders.data && reminders.data.length > 0 && <div className="pd-ready"><h3>Needs attention</h3><ul className="cc-remind">{reminders.data.slice(0, 10).map((r) => <li key={`${r.type}-${r.ref}`} className={r.overdue ? 'is-late' : ''}><i /><Link to={`/assignments/${r.assignmentId}`}>{r.message}</Link></li>)}</ul></div>}
        {s && <div className="pd-ready"><h3>Field work</h3><div className="cc-mini"><div><b>{s.inspections.upcomingWeek}</b><small>visits in 7 days</small></div><div><b>{s.inspections.inProgress}</b><small>in progress</small></div><div className={s.inspections.awaitingFieldReview ? 'is-warn' : ''}><b>{s.inspections.awaitingFieldReview}</b><small>awaiting field review</small></div></div></div>}
        {s?.reports && <div className="pd-ready"><h3>Reports</h3><div className="cc-mini"><div><b>{s.reports.awaitingValuation}</b><small>awaiting calculations</small></div><div><b>{s.reports.awaitingQc}</b><small>in QC / approval</small></div><div><b>{s.reports.awaitingSignature}</b><small>ready to issue</small></div></div></div>}
        {canSeeAll && <div className="pd-ready"><h3>Submitted this month</h3><select className="cc-select" aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="bank">By bank</option><option value="branch">By branch</option><option value="valuer">By valuer</option><option value="propertyClass">By property class</option></select><p className="cc-total"><b>{submitted.data?.total ?? 0}</b> assignment{submitted.data?.total === 1 ? '' : 's'}</p>{submitted.data?.groups.map((g) => <p key={g.label} className="cc-group"><span>{g.label}</span><b>{g.count}</b></p>)}</div>}
        {gaps.data && gaps.data.length > 0 && <div className="pd-ready"><h3>Closed, but incomplete</h3><ul className="cc-remind">{gaps.data.map((g) => <li key={g.id}><i /><span><Link to={`/assignments/${g.id}`}>{g.code}</Link>: {g.missing.join(', ')}</span></li>)}</ul></div>}
      </aside>
    </div>
  </div>
}
