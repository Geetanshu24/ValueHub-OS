import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
import NewAssignment from './NewAssignment.tsx'
import { AlertCircle, Download, ExternalLink, FileText, Plus, Search, X } from 'lucide-react'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS, type AssignmentStatus, type PropertyClass } from '@value-hub/valuation-shared'
import Pager from '../components/Pager.tsx'
import { ErrorText, formatDate, formatInr } from '../components/ui.tsx'
import { useToast } from '../components/shell/Toast.tsx'
import { useFetch } from '../lib/useFetch.ts'
import { useList } from '../lib/useList.ts'

interface Row {
  id: string; code: string; purpose: string; dueDate: string; receivedAt: string; status: AssignmentStatus; borrowerName: string | null; fee: string | null
  bank: { id: string; name: string }; branch: { name: string } | null; property: { code: string; addressLine: string; propertyClass: PropertyClass }
  assignedValuer: { id: string; fullName: string }
  inspections: { inspector: { fullName: string } }[]; valuations: { totalValue: string; status: string }[]
  invoices: { amount: string; payments: { amount: string; voidedAt: string | null }[] }[]
}
interface Bank { id: string; name: string }
interface Staff { id: string; fullName: string; role: string }

const BADGE: Partial<Record<AssignmentStatus, string>> = {
  INSPECTION: 'bg-blue-100 text-blue-800', VALUATION: 'bg-purple-100 text-purple-800', QUALITY_REVIEW: 'bg-purple-100 text-purple-800', APPROVED: 'bg-emerald-100 text-emerald-800 font-bold',
  SUBMITTED: 'bg-emerald-100 text-emerald-800', CLOSED: 'bg-slate-200 text-slate-800', REVISION: 'bg-amber-100 text-amber-800 font-bold border border-amber-300',
}
const select = 'rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-navy'
const isStatus = (value: string | null): value is AssignmentStatus => !!value && (ASSIGNMENT_STATUSES as readonly string[]).includes(value)
const paidOf = (r: Row) => {
  const billed = r.invoices.reduce((t, i) => t + Number(i.amount), 0)
  const paid = r.invoices.reduce((t, i) => t + i.payments.filter((p) => !p.voidedAt).reduce((s, p) => s + Number(p.amount), 0), 0)
  return { billed, paid, state: billed === 0 ? 'unbilled' : paid >= billed - 0.005 ? 'paid' : 'due' }
}

export default function Assignments() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const { user } = useAuth()
  const canCreate = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [bank, setBank] = useState('')
  const [type, setType] = useState('')
  const [assignee, setAssignee] = useState('')
  const [payment, setPayment] = useState('')
  const statusParam = params.get('status')
  const status = isStatus(statusParam) ? statusParam : ''
  const overdue = params.get('overdue') === 'true'
  const banks = useFetch<{ items: Bank[] }>('/banks?pageSize=100').data?.items
  const staff = useFetch<Staff[]>('/users/staff').data
  const { data, error, loading } = useList<Row>('/assignments', { page, pageSize: 25, status: status || undefined, overdue: overdue ? 'true' : undefined, q: search.trim() || undefined, bankId: bank || undefined, propertyClass: type || undefined, assignedValuerId: assignee || undefined })

  const rows = useMemo(() => (data?.items ?? []).filter((r) => !payment || (payment === 'Paid' ? paidOf(r).state === 'paid' : paidOf(r).state !== 'paid')), [data, payment])
  const today = new Date(new Date().toDateString()).getTime()
  const filtered = Boolean(status || overdue || search || bank || type || assignee || payment)
  const setStatus = (value: string) => { const copy = new URLSearchParams(params); if (value) copy.set('status', value); else copy.delete('status'); setParams(copy, { replace: true }); setPage(1) }
  const clear = () => { setSearch(''); setBank(''); setType(''); setAssignee(''); setPayment(''); setParams(new URLSearchParams(), { replace: true }); setPage(1) }
  const exportCsv = () => {
    const lines = [['Case ID', 'Status', 'Bank', 'Branch', 'Borrower', 'Address', 'Type', 'Valuer', 'Received', 'Due', 'Final value'], ...rows.map((r) => [r.code, ASSIGNMENT_STATUS_LABELS[r.status], r.bank.name, r.branch?.name ?? '', r.borrowerName ?? '', r.property.addressLine, PROPERTY_CLASS_LABELS[r.property.propertyClass], r.assignedValuer.fullName, r.receivedAt.slice(0, 10), r.dueDate.slice(0, 10), r.valuations[0]?.totalValue ?? ''])]
    const csv = lines.map((l) => l.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'cases.csv'; a.click(); URL.revokeObjectURL(url)
    toast(`Exported ${rows.length} cases`, 'success')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-brand-border bg-white p-4 shadow-xs sm:flex-row">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Filter by Case ID, Owner, Bank, Address, Khasra…" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-xs transition focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-navy" />
        </div>
        <div className="flex w-full items-center justify-end space-x-2.5 sm:w-auto">
          <span className="text-xs font-medium text-slate-500">{data ? `Showing ${rows.length} of ${data.total} cases` : ''}</span>
          <button type="button" onClick={exportCsv} className="flex items-center space-x-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"><Download className="h-3.5 w-3.5" /><span>Export CSV</span></button>
          {canCreate && <button type="button" onClick={() => setCreating(true)} className="flex items-center space-x-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-navyDark"><Plus className="h-3.5 w-3.5" /><span>New Case</span></button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-border bg-white p-3 text-xs shadow-xs">
        <label className="flex items-center space-x-1"><span className="font-medium text-slate-500">Bank:</span><select className={select} value={bank} onChange={(e) => { setBank(e.target.value); setPage(1) }}><option value="">All Banks</option>{banks?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="flex items-center space-x-1"><span className="font-medium text-slate-500">Type:</span><select className={select} value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}><option value="">All Types</option>{PROPERTY_CLASSES.map((c) => <option key={c} value={c}>{PROPERTY_CLASS_LABELS[c]}</option>)}</select></label>
        <label className="flex items-center space-x-1"><span className="font-medium text-slate-500">Status:</span><select className={select} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All Statuses</option>{ASSIGNMENT_STATUSES.map((s) => <option key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</option>)}</select></label>
        <label className="flex items-center space-x-1"><span className="font-medium text-slate-500">Assignee:</span><select className={select} value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1) }}><option value="">All Staff</option>{staff?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></label>
        <label className="flex items-center space-x-1"><span className="font-medium text-slate-500">Bill/Paid:</span><select className={select} value={payment} onChange={(e) => setPayment(e.target.value)}><option value="">All Payments</option><option value="Paid">Paid Only</option><option value="Pending">Pending / Unbilled</option></select></label>
        <label className="flex items-center space-x-1 text-slate-600"><input type="checkbox" checked={overdue} onChange={(e) => { const copy = new URLSearchParams(params); if (e.target.checked) copy.set('overdue', 'true'); else copy.delete('overdue'); setParams(copy, { replace: true }); setPage(1) }} /><span>Overdue only</span></label>
        {filtered && <button type="button" onClick={clear} className="ml-auto flex items-center space-x-1 text-xs font-semibold text-brand-red hover:underline"><X className="h-3.5 w-3.5" /><span>Clear Filters</span></button>}
      </div>
      <ErrorText message={error} />

      <div className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="select-none bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              <tr><th className="px-3 py-3">Case ID</th><th className="px-2 py-3">Status</th><th className="px-3 py-3">Bank / Branch</th><th className="px-3 py-3">Owner</th><th className="px-3 py-3">Property Address</th><th className="px-2 py-3">Type</th><th className="px-2 py-3">Valuer / Insp</th><th className="px-2 py-3">Received</th><th className="px-2 py-3">Due Date</th><th className="px-3 py-3 text-right">Final Value (₹)</th><th className="px-2 py-3 text-center">Fee / Paid</th><th className="px-2 py-3 text-center">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data && <tr><td colSpan={12} className="p-6 text-center text-slate-400">Loading…</td></tr>}
              {data && rows.length === 0 && <tr><td colSpan={12} className="p-6 text-center text-slate-400">No cases found matching current filters.</td></tr>}
              {rows.map((r) => {
                const late = new Date(new Date(r.dueDate).toDateString()).getTime() < today && !['SUBMITTED', 'CLOSED', 'CANCELLED'].includes(r.status)
                const pay = paidOf(r)
                const value = r.valuations[0]
                return (
                  <tr key={r.id} className="group transition hover:bg-blue-50/40">
                    <td className="px-3 py-2.5"><Link to={`/assignments/${r.id}`} className="block font-mono text-[11px] font-bold text-brand-navy hover:underline">{r.code}</Link><span className="font-mono text-[9px] text-slate-400">{r.purpose}</span></td>
                    <td className="px-2 py-2.5"><span className={`whitespace-nowrap rounded px-2 py-0.5 text-[10px] ${BADGE[r.status] ?? 'bg-slate-100 text-slate-700'}`}>{ASSIGNMENT_STATUS_LABELS[r.status]}</span></td>
                    <td className="px-3 py-2.5"><div className="font-semibold text-slate-800">{r.bank.name}</div><div className="max-w-[120px] truncate text-[10px] text-slate-500">{r.branch?.name ?? '—'}</div></td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800">{r.borrowerName ?? <span className="font-normal text-slate-300">—</span>}</td>
                    <td className="max-w-[160px] px-3 py-2.5" title={r.property.addressLine}><div className="truncate text-[11px] text-slate-700">{r.property.addressLine}</div></td>
                    <td className="px-2 py-2.5"><span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">{PROPERTY_CLASS_LABELS[r.property.propertyClass]}</span></td>
                    <td className="px-2 py-2.5 text-[10px]"><div>V: <strong className="text-slate-800">{r.assignedValuer.fullName.split(' ')[0]}</strong></div><div>I: <span className="text-slate-600">{r.inspections[0]?.inspector.fullName.split(' ')[0] ?? '—'}</span></div></td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[10px] text-slate-500">{formatDate(r.receivedAt)}</td>
                    <td className="whitespace-nowrap px-2 py-2.5">{late ? <span className="flex items-center space-x-0.5 font-mono font-bold text-brand-red"><AlertCircle className="h-3 w-3" /><span>{formatDate(r.dueDate)}</span></span> : <span className="font-mono text-slate-600">{formatDate(r.dueDate)}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-slate-900">{value ? `₹${formatInr(value.totalValue)}` : <span className="font-normal text-slate-300">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-center"><div className="font-mono text-[10px] font-bold text-slate-700">{r.fee ? `₹${formatInr(r.fee)}` : '—'}</div>{pay.state === 'paid' ? <span className="rounded bg-emerald-100 px-1.5 text-[9px] font-bold text-emerald-800">Paid</span> : pay.state === 'due' ? <span className="rounded bg-red-100 px-1.5 text-[9px] font-bold text-red-700">Due</span> : <span className="rounded bg-slate-100 px-1.5 text-[9px] font-bold text-slate-500">Unbilled</span>}</td>
                    <td className="px-2 py-2.5 text-center"><div className="flex items-center justify-center space-x-1"><button type="button" onClick={() => navigate(`/assignments/${r.id}`)} className="rounded p-1 text-brand-navy hover:bg-slate-200" title="Open case"><ExternalLink className="h-3.5 w-3.5" /></button><button type="button" onClick={() => navigate(`/assignments/${r.id}/documents`)} className="rounded p-1 text-slate-600 hover:bg-slate-200" title="Documents"><FileText className="h-3.5 w-3.5" /></button></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data && <div className="border-t border-slate-200 bg-slate-50 p-3"><Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} /></div>}
      </div>
      {creating && canCreate && <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Create new case registration">
        <div className="absolute inset-0 bg-slate-900/50" onClick={() => setCreating(false)} />
        <div className="relative flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-gradient-to-r from-brand-navy to-brand-navyDark px-5 py-4 text-white">
            <div><h2 className="text-sm font-bold">Create New Case Registration</h2><p className="text-[11px] text-slate-300">Add the bank instruction, confirm the details, reuse earlier work and assign it</p></div>
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg p-1 hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto bg-slate-50 slide-intake"><NewAssignment /></div>
        </div>
      </div>}
    </div>
  )
}
