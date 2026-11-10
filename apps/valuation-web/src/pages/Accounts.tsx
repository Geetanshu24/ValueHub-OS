import { useState } from 'react'
import Pager from '../components/Pager.tsx'
import InvoiceCard, { type Invoice } from '../components/InvoiceBlock.tsx'
import { ErrorText, formatInr, PageHeader } from '../components/ui.tsx'
import { type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Summary { invoiced: number; received: number; outstanding: number; ageing: Record<string, number>; outstandingByBank: { bank: string; outstanding: number }[]; averageDaysToPayment: number | null }

const STATUSES = ['', 'SENT', 'PARTIALLY_PAID', 'PAID']
const STATUS_LABEL: Record<string, string> = { '': 'All', SENT: 'Unpaid', PARTIALLY_PAID: 'Part paid', PAID: 'Paid' }

export default function Accounts() {
  const { user } = useAuth()
  const canBill = user?.role === 'FIRM_ADMIN' || user?.role === 'ACCOUNTS'
  const isAdmin = user?.role === 'FIRM_ADMIN'
  const summary = useFetch<Summary>('/accounts/summary')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const invoices = useFetch<Paginated<Invoice>>(`/invoices?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`)
  const reload = () => { invoices.reload(); summary.reload() }
  const s = summary.data

  return <div>
    <PageHeader eyebrow="BUSINESS" title="Accounts" subtitle="What you have billed, what has been paid and what is still owed. A bill is raised when you approve a report." />
    <ErrorText message={summary.error ?? invoices.error} />

    {s && <>
      <div className="cc-tiles">
        <div className="cc-tile"><small>Invoiced</small><b>₹ {formatInr(s.invoiced)}</b></div>
        <div className="cc-tile"><small>Received</small><b>₹ {formatInr(s.received)}</b></div>
        <div className={`cc-tile ${s.outstanding > 0 ? 'is-warn' : ''}`}><small>Outstanding</small><b>₹ {formatInr(s.outstanding)}</b></div>
      </div>
    </>}


    <div className="ib-filters">
      <div className="ib-chips" role="group" aria-label="Filter invoices">{STATUSES.map((st) => <button key={st || 'all'} type="button" className={status === st ? 'is-on' : ''} onClick={() => { setStatus(st); setPage(1) }}>{STATUS_LABEL[st]}</button>)}</div>
    </div>
    {invoices.data?.items.map((inv) => <InvoiceCard key={inv.id} invoice={inv} canBill={canBill} isAdmin={isAdmin} onChange={reload} />)}
    {invoices.data?.items.length === 0 && <div className="pd-empty"><b>No invoices</b><p>{status ? 'Try another filter.' : 'A bill appears here when a report is approved.'}</p></div>}
    {invoices.data && <Pager page={invoices.data.page} pageSize={invoices.data.pageSize} total={invoices.data.total} onChange={setPage} />}
  </div>
}
