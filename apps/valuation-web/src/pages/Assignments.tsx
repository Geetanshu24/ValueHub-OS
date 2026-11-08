import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ASSIGNMENT_PRIORITY_LABELS, ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS, type AssignmentPriority, type AssignmentStatus } from '@value-hub/valuation-shared'
import Pager from '../components/Pager.tsx'
import { dueLabel, nextActionFor } from '../components/WorkflowParts.tsx'
import { ErrorText, formatDate } from '../components/ui.tsx'
import { useList } from '../lib/useList.ts'

interface AssignmentRow {
  id: string
  code: string
  dueDate: string
  status: AssignmentStatus
  priority: AssignmentPriority
  borrowerName: string | null
  bank: { name: string }
  property: { code: string; addressLine: string }
  assignedValuer: { fullName: string }
  acknowledgedAt: string | null
  billing?: { status: 'none' | 'unpaid' | 'part_paid' | 'paid'; amount: number; outstanding: number; code: string | null }
}

const isStatus = (value: string | null): value is AssignmentStatus => !!value && (ASSIGNMENT_STATUSES as readonly string[]).includes(value)

export default function Assignments() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const statusParam = params.get('status')
  const status = isStatus(statusParam) ? statusParam : ''
  const overdue = params.get('overdue') === 'true'
  const { data, error, loading } = useList<AssignmentRow>('/assignments', { page, pageSize: 25, status: status || undefined, overdue: overdue ? 'true' : undefined, q: search.trim() || undefined })

  // The filters live in the address, so a link from the Command Centre lands on the right list.
  const setFilter = (next: { status?: string; overdue?: boolean }) => {
    const copy = new URLSearchParams(params)
    if ('status' in next) { if (next.status) copy.set('status', next.status); else copy.delete('status') }
    if ('overdue' in next) { if (next.overdue) copy.set('overdue', 'true'); else copy.delete('overdue') }
    setParams(copy, { replace: true }); setPage(1)
  }

  return <div className="pd-shell">
    <header className="pd-heading"><div><p className="pd-eyebrow">ASSIGNMENTS</p><h1>Assignment Inbox</h1><p>Bank instructions, earliest due first. Each row opens the step it is waiting on.</p></div><Link to="/assignments/new" className="pd-btn is-primary">＋ New assignment</Link></header>
    <div className="ib-filters">
      <div className="ib-chips" role="group" aria-label="Filter by stage">
        <button type="button" className={status === '' ? 'is-on' : ''} onClick={() => setFilter({ status: '' })}>All</button>
        {ASSIGNMENT_STATUSES.filter((s) => s !== 'CANCELLED').map((s) => <button key={s} type="button" className={status === s ? 'is-on' : ''} onClick={() => setFilter({ status: s })}>{ASSIGNMENT_STATUS_LABELS[s]}</button>)}
      </div>
    </div>
    <div className="ib-filters">
      <input className="ib-search" type="search" placeholder="Search by assignment ID" aria-label="Search by assignment ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      <label className="ib-over"><input type="checkbox" checked={overdue} onChange={(e) => setFilter({ overdue: e.target.checked })} /> Overdue only</label>
    </div>
    <ErrorText message={error} />

    <section className="pd-card">
      {loading && !data ? <p className="pd-muted">Loading…</p> : data?.items.length === 0 ? <div className="pd-empty"><b>No assignments found</b><p>{status || overdue || search ? 'Try clearing the filters.' : 'Create the first assignment to get started.'}</p></div> : <div className="cc-queue">{data?.items.map((row) => {
        const due = dueLabel(row.dueDate)
        const closed = row.status === 'CLOSED' || row.status === 'CANCELLED'
        const next = nextActionFor(row.status, row.id)
        return <article key={row.id}>
          <div className="cc-q-main"><div className="cc-q-top"><Link to={`/assignments/${row.id}`} className="cc-q-code">{row.code}</Link><span className="pd-pill is-type">{ASSIGNMENT_STATUS_LABELS[row.status]}</span>{row.priority !== 'NORMAL' && <span className={`pd-prio is-${row.priority.toLowerCase()} cc-prio`}>{ASSIGNMENT_PRIORITY_LABELS[row.priority]}</span>}</div>
            <b title={row.property.addressLine}>{row.property.addressLine}</b>
            <small>{row.bank.name}{row.borrowerName ? ` · ${row.borrowerName}` : ''} · {row.assignedValuer.fullName}{row.billing && row.billing.status !== 'none' && <> · <b className={row.billing.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'} title={`Bill ${row.billing.code ?? ''}`}>{row.billing.status === 'paid' ? 'paid' : row.billing.status === 'part_paid' ? `part paid · ₹${row.billing.outstanding.toLocaleString('en-IN')} due` : `unpaid · ₹${row.billing.outstanding.toLocaleString('en-IN')}`}</b></>}{!row.acknowledgedAt && !closed ? <> · <b title="The valuer has not opened the pop-up for this case yet">not seen yet</b></> : null}</small></div>
          <div className="cc-q-due">{closed ? <small>{formatDate(row.dueDate)}</small> : <><span className={`cc-due is-${due.tone}`}>{due.text}</span><small>due {formatDate(row.dueDate)}</small></>}</div>
          {next ? <Link to={next.to} className="pd-btn is-primary">{next.label} →</Link> : <Link to={`/assignments/${row.id}`} className="pd-btn is-ghost">Open</Link>}
        </article>
      })}</div>}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </section>
  </div>
}
