import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS, PROPERTY_CLASSES, type AssignmentStatus } from '@value-hub/valuation-shared'
import Pager from '../components/Pager.tsx'
import { buttonClass, Card, ErrorText, errorMessage, formatDate, ghostButtonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { downloadFromPost, type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Result {
  id: string
  code: string
  status: AssignmentStatus
  purpose: string
  valuationDate: string
  bank: { name: string }
  branch: { name: string } | null
  assignedValuer: { fullName: string }
  property: { id: string; code: string; addressLine: string; propertyClass: string; district: string | null }
}
interface SearchResponse extends Paginated<Result> {
  documentHits: Record<string, { documentId: string; fileName: string; snippet: string }[]>
}
interface PlanItem {
  id: string
  group: string
  label: string
  sensitive?: 'fees' | 'gps' | 'internal'
}

const EMPTY = { q: '', status: '', propertyClass: '', district: '', dateField: '', from: '', to: '' }

function DossierBuilder({ assignmentId, code, onClose }: { assignmentId: string; code: string; onClose: () => void }) {
  const plan = useFetch<PlanItem[]>(`/assignments/${assignmentId}/dossier/plan`)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [redact, setRedact] = useState({ fees: true, gps: false, internal: true })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = chosen ?? plan.data?.map((p) => p.id) ?? []
  const groups = [...new Set(plan.data?.map((p) => p.group))]

  async function build() {
    setBusy(true)
    setError(null)
    try {
      await downloadFromPost(`/assignments/${assignmentId}/dossier`, { items: selected, redact }, `${code}-dossier.zip`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={`Evidence dossier — ${code}`}>
      <p className="mb-3 text-sm text-ink-soft">Review what leaves the system. Sensitive items are marked; redactions remove them entirely. The archive carries an index and a hash for every file, and the export is logged.</p>
      <ErrorText message={error ?? plan.error} />
      {groups.map((group) => (
        <div key={group} className="mb-2">
          <p className="text-sm font-semibold">{group}</p>
          {plan.data?.filter((p) => p.group === group).map((item) => (
            <label key={item.id} className="block text-sm">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setChosen(e.target.checked ? [...selected, item.id] : selected.filter((x) => x !== item.id))} /> {item.label}
              {item.sensitive && <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-700">may contain {item.sensitive === 'gps' ? 'GPS coordinates' : item.sensitive === 'fees' ? 'fees' : 'internal notes'}</span>}
            </label>
          ))}
        </div>
      ))}
      <div className="mb-3 mt-3 space-y-1 border-t border-slate-100 pt-2 text-sm">
        <p className="font-semibold">Redact</p>
        <label className="block"><input type="checkbox" checked={redact.fees} onChange={(e) => setRedact({ ...redact, fees: e.target.checked })} /> Fees, invoices and payments</label>
        <label className="block"><input type="checkbox" checked={redact.gps} onChange={(e) => setRedact({ ...redact, gps: e.target.checked })} /> Site GPS coordinates</label>
        <label className="block"><input type="checkbox" checked={redact.internal} onChange={(e) => setRedact({ ...redact, internal: e.target.checked })} /> Audit trail and internal notes</label>
      </div>
      <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={busy || selected.length === 0} onClick={() => void build()}>{busy ? 'Building…' : 'Build and download'}</button>
        <button type="button" className={ghostButtonClass} onClick={onClose}>Close</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">An archive proves what the firm held and when; it does not prove title or guarantee a legal outcome.</p>
    </Card>
  )
}

export default function EvidenceVault() {
  const { user } = useAuth()
  const canExport = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'REVIEWER'
  const [form, setForm] = useState(EMPTY)
  const [applied, setApplied] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [dossier, setDossier] = useState<{ id: string; code: string } | null>(null)

  const params = new URLSearchParams({ page: String(page), pageSize: '20' })
  for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value)
  const results = useFetch<SearchResponse>(`/search?${params.toString()}`)

  function search(event: FormEvent) {
    event.preventDefault()
    setApplied(form)
    setPage(1)
  }

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  return (
    <div>
      <PageHeader eyebrow="RECORDS" title="Evidence Vault" subtitle="Find any past case by ID, address, khasra number, bank, date, or the words inside its documents." />

      <form onSubmit={search} className="mb-4 grid gap-2 sm:grid-cols-3">
        <input className={`${inputClass} sm:col-span-3`} type="search" placeholder="Search IDs, address, khasra, bank, or text inside documents…" aria-label="Search" value={form.q} onChange={set('q')} />
        <select className={inputClass} aria-label="Status" value={form.status} onChange={set('status')}>
          <option value="">Any status</option>
          {ASSIGNMENT_STATUSES.map((s) => <option key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</option>)}
        </select>
        <select className={inputClass} aria-label="Property class" value={form.propertyClass} onChange={set('propertyClass')}>
          <option value="">Any property class</option>
          {PROPERTY_CLASSES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className={inputClass} placeholder="District" aria-label="District" value={form.district} onChange={set('district')} />
        <select className={inputClass} aria-label="Date field" value={form.dateField} onChange={set('dateField')}>
          <option value="">Date filter…</option>
          {['received', 'valuation', 'due', 'inspection', 'submission', 'invoice'].map((d) => <option key={d} value={d}>{d} date</option>)}
        </select>
        <input className={inputClass} type="date" aria-label="From" value={form.from} onChange={set('from')} />
        <input className={inputClass} type="date" aria-label="To" value={form.to} onChange={set('to')} />
        <div className="flex gap-2"><button type="submit" className={buttonClass}>Search</button><button type="button" className={ghostButtonClass} onClick={() => { setForm(EMPTY); setApplied(EMPTY); setPage(1) }}>Clear</button></div>
      </form>
      <ErrorText message={results.error} />

      {dossier && <DossierBuilder assignmentId={dossier.id} code={dossier.code} onClose={() => setDossier(null)} />}

      {results.data?.items.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p><Link className="font-semibold text-brand-700 hover:underline" to={`/assignments/${r.id}`}>{r.code}</Link> <span className="text-sm text-ink-soft">· {ASSIGNMENT_STATUS_LABELS[r.status]} · valued {formatDate(r.valuationDate)}</span></p>
              <p className="text-sm">{r.bank.name}{r.branch ? ` · ${r.branch.name}` : ''} · {r.property.code} · {r.property.addressLine}{r.property.district ? `, ${r.property.district}` : ''}</p>
              <p className="text-xs text-slate-500">{r.property.propertyClass} · {r.assignedValuer.fullName} · {r.purpose}</p>
            </div>
            {canExport && <button type="button" className={ghostButtonClass} onClick={() => setDossier({ id: r.id, code: r.code })}>Export dossier</button>}
          </div>
          {results.data?.documentHits[r.property.id]?.map((hit) => (
            <p key={hit.documentId} className="mt-1 text-xs text-slate-600">in {hit.fileName}: …{hit.snippet.replaceAll('«', '').replaceAll('»', '')}…</p>
          ))}
        </Card>
      ))}
      {results.data?.items.length === 0 && <p className="text-ink-soft">No matching cases.</p>}
      {results.data && <Pager page={results.data.page} pageSize={results.data.pageSize} total={results.data.total} onChange={setPage} />}
    </div>
  )
}
