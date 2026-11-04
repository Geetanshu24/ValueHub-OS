import { useState } from 'react'
import { Link } from 'react-router-dom'
import Pager from '../components/Pager.tsx'
import InvoiceCard, { RaiseInvoice, type Invoice } from '../components/InvoiceBlock.tsx'
import { ErrorText, formatInr, PageHeader } from '../components/ui.tsx'
import { type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useAssignmentParam } from '../lib/useAssignmentParam.ts'
import { useFetch } from '../lib/useFetch.ts'

interface Summary { invoiced: number; received: number; outstanding: number; ageing: Record<string, number>; outstandingByBank: { bank: string; outstanding: number }[]; averageDaysToPayment: number | null }
interface AssignmentOption { id: string; code: string; status: string; fee: string | null; property: { addressLine: string } }

const AGEING_LABEL: Record<string, string> = { current: 'Not yet due', d1to30: '1–30 days', d31to60: '31–60 days', d61to90: '61–90 days', d90plus: '90+ days' }
const STATUSES = ['', 'DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']

export default function Accounts() {
  const { user } = useAuth()
  const canBill = user?.role === 'FIRM_ADMIN' || user?.role === 'ACCOUNTS'
  const isAdmin = user?.role === 'FIRM_ADMIN'
  const summary = useFetch<Summary>('/accounts/summary')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [overdue, setOverdue] = useState(false)
  const invoices = useFetch<Paginated<Invoice>>(`/invoices?page=${page}&pageSize=25${status ? `&status=${status}` : ''}${overdue ? '&overdue=true' : ''}`)
  const assignments = useFetch<Paginated<AssignmentOption>>(canBill ? '/assignments?pageSize=100' : null)
  const [assignmentId, setAssignmentId] = useAssignmentParam()
  const reload = () => { invoices.reload(); summary.reload() }
  const billable = assignments.data?.items.filter((a) => ['SUBMITTED', 'CLOSED'].includes(a.status)) ?? []
  const chosen = billable.find((a) => a.id === assignmentId)
  const already = useFetch<Paginated<Invoice>>(assignmentId ? `/invoices?assignmentId=${assignmentId}&pageSize=100` : null)
  const invoicedOnChosen = (already.data?.items ?? []).filter((i) => i.status !== 'CANCELLED').reduce((t, i) => t + Number(i.amount), 0)
  const s = summary.data

  return <div>
    <PageHeader eyebrow="BUSINESS" title="Accounts" subtitle="Invoices, payments received and what is still owed." />
    <ErrorText message={summary.error ?? invoices.error} />

    {s && <>
      <div className="cc-tiles">
        <div className="cc-tile"><small>Invoiced</small><b>₹ {formatInr(s.invoiced)}</b></div>
        <div className="cc-tile"><small>Received</small><b>₹ {formatInr(s.received)}</b></div>
        <div className={`cc-tile ${s.outstanding > 0 ? 'is-warn' : ''}`}><small>Outstanding</small><b>₹ {formatInr(s.outstanding)}</b></div>
        <div className="cc-tile"><small>Average days to payment</small><b>{s.averageDaysToPayment ?? '—'}</b></div>
      </div>
      <section className="pd-card mb-4">
        <h2 className="ui-card-title">How late the money is</h2>
        <div className="cc-ageing">{Object.entries(s.ageing).map(([k, v]) => <div key={k} className={Number(v) > 0 && k !== 'current' ? 'is-late' : ''}><small>{AGEING_LABEL[k]}</small><b>₹ {formatInr(v)}</b></div>)}</div>
        {s.outstandingByBank.length > 0 && <div className="va-rates ac-banks">{s.outstandingByBank.map((b) => <div key={b.bank}><small>{b.bank}</small><b>₹ {formatInr(b.outstanding)}</b><span>outstanding</span></div>)}</div>}
      </section>
    </>}

    {canBill && <section className="pd-card mb-4">
      <h2 className="ui-card-title">Raise an invoice</h2>
      <label className="va-f">Submitted assignment
        <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
          <option value="">Choose an assignment…</option>
          {billable.map((a) => <option key={a.id} value={a.id}>{a.code}{a.fee ? ` — fee ₹ ${formatInr(a.fee)}` : ' — no fee set'}</option>)}
        </select>
      </label>
      {chosen ? <div className="ac-raise"><RaiseInvoice assignmentId={chosen.id} fee={chosen.fee} invoiced={invoicedOnChosen} onDone={() => { reload(); already.reload() }} /></div> : <p className="pd-muted ac-hint">Invoices are raised once the report has been submitted to the bank. You can also raise one from the assignment’s Approval &amp; Submission step{assignmentId ? ' (this assignment is not submitted yet)' : ''}.</p>}
    </section>}

    <div className="ib-filters">
      <div className="ib-chips" role="group" aria-label="Filter invoices">{STATUSES.map((st) => <button key={st || 'all'} type="button" className={status === st ? 'is-on' : ''} onClick={() => { setStatus(st); setPage(1) }}>{st ? st.replace('_', ' ').toLowerCase() : 'All'}</button>)}</div>
      <label className="ib-over"><input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1) }} /> Overdue only</label>
    </div>
    {invoices.data?.items.map((inv) => <InvoiceCard key={inv.id} invoice={inv} canBill={canBill} isAdmin={isAdmin} onChange={reload} />)}
    {invoices.data?.items.length === 0 && <div className="pd-empty"><b>No invoices</b><p>{status || overdue ? 'Try clearing the filters.' : <>Raise the first one above, or from an assignment’s <Link to="/assignments?status=SUBMITTED">submission step</Link>.</>}</p></div>}
    {invoices.data && <Pager page={invoices.data.page} pageSize={invoices.data.pageSize} total={invoices.data.total} onChange={setPage} />}
  </div>
}
