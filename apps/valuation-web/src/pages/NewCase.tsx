import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ASSIGNMENT_PRIORITIES, ASSIGNMENT_PRIORITY_LABELS, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, INTAKE_SOURCE_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS, isSupportedBank,
  type AssignmentPriority, type DocumentType, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import { ErrorText, errorMessage, inputClass, PageHeader } from '../components/ui.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Bank { id: string; name: string; branches: { id: string; name: string; city: string | null; district: string | null; state: string | null }[] }
interface Staff { id: string; fullName: string; role: string }
interface Guess<T = string> { value: T; confidence: number }
interface ExtractResult { files: { name: string; status: string }[]; fields: { bankId?: Guess; purpose?: Guess; address?: Guess; propertyClass?: Guess<PropertyClass>; instructionDate?: Guess; borrowerName?: Guess } }

const today = new Date().toISOString().slice(0, 10)
const inAWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

// The papers a case usually comes with, in the order they are usually thought of.
const PAPER_TYPES: DocumentType[] = ['BANK_INSTRUCTION', 'SALE_DEED', 'REGISTRY_PAPERS', 'APPROVED_PLAN', 'LAYOUT_PLAN', 'OCCUPATION_CERTIFICATE', 'COMPLETION_CERTIFICATE', 'REVENUE_RECORD', 'SHAJRA_PLAN', 'MAGISTRATE_CERTIFICATE', 'PROPERTY_TAX', 'ELECTRICITY_BILL', 'OTHER']
const GUESSES: [RegExp, DocumentType][] = [
  [/layout/i, 'LAYOUT_PLAN'], [/completion/i, 'COMPLETION_CERTIFICATE'], [/occupation|\boc\b/i, 'OCCUPATION_CERTIFICATE'], [/shajra|sajra|sejra/i, 'SHAJRA_PLAN'],
  [/jamabandi|jamabandhi|khasra|khatauni|revenue/i, 'REVENUE_RECORD'], [/magistrate/i, 'MAGISTRATE_CERTIFICATE'], [/patwari/i, 'PATWARI_REPORT'], [/electric|bijli/i, 'ELECTRICITY_BILL'],
  [/property.?tax|house.?tax/i, 'PROPERTY_TAX'], [/water/i, 'WATER_BILL'], [/registry|regd/i, 'REGISTRY_PAPERS'], [/deed|conveyance|sale/i, 'SALE_DEED'], [/approved|sanction|map|plan/i, 'APPROVED_PLAN'],
]
const guessType = (name: string): DocumentType => GUESSES.find(([pattern]) => pattern.test(name))?.[1] ?? 'BANK_INSTRUCTION'
const keyOf = (file: File) => `${file.name}-${file.size}`

// One page to log a case: the papers, who and what it is for, the property, and who works on it.
export default function NewCase() {
  const { user } = useAuth()
  const banks = useFetch<Paginated<Bank>>('/banks?pageSize=100')
  const staff = useFetch<Staff[]>('/users/staff')
  const [files, setFiles] = useState<File[]>([])
  const [types, setTypes] = useState<Record<string, DocumentType>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; code: string; failed: string[] } | null>(null)
  const typedInput = useRef<HTMLInputElement>(null)
  const typedFor = useRef<DocumentType>('SALE_DEED')
  const [form, setForm] = useState({
    bankId: '', branchId: '', borrowerName: '', clientPhone: '', purpose: '', dueDate: inAWeek,
    assignedValuerId: user && (user.role === 'VALUER' || user.role === 'FIRM_ADMIN') ? user.id : '', assignedDrafterId: '', assignedInspectorId: '',
    address: '', propertyClass: 'HOUSE' as PropertyClass, locality: '', district: '', state: '', pinCode: '',
    source: 'DASHBOARD' as IntakeSource, valuationDate: today, instructionDate: today, priority: 'NORMAL' as AssignmentPriority, fee: '', scope: '',
  })
  const set = (patch: Partial<typeof form>) => setForm((cur) => ({ ...cur, ...patch }))

  const typeOf = (file: File): DocumentType => types[keyOf(file)] ?? guessType(file.name)
  const addFiles = (incoming: File[], type?: DocumentType) => {
    if (incoming.length === 0) return
    setFiles((cur) => [...cur, ...incoming.filter((f) => !cur.some((c) => keyOf(c) === keyOf(f)))])
    if (type) setTypes((cur) => ({ ...cur, ...Object.fromEntries(incoming.map((f) => [keyOf(f), type])) }))
  }
  const valuers = useMemo(() => staff.data?.filter((p) => p.role === 'VALUER' || p.role === 'FIRM_ADMIN') ?? [], [staff.data])
  const drafters = useMemo(() => staff.data?.filter((p) => p.role === 'DRAFTER') ?? [], [staff.data])
  const inspectors = useMemo(() => staff.data?.filter((p) => p.role === 'INSPECTOR' || p.role === 'VALUER') ?? [], [staff.data])
  const branches = banks.data?.items.find((b) => b.id === form.bankId)?.branches ?? []

  // Optional: read the instruction letter and fill what it says. Nothing is saved until you create the case.
  async function fillFromFiles() {
    setBusy('read'); setError(null); setNotice(null)
    try {
      const data = new FormData()
      files.forEach((file) => data.append('files', file))
      const f = (await api.upload<ExtractResult>('/intake/extract', data)).fields
      set({
        ...(f.bankId && { bankId: f.bankId.value, branchId: '' }), ...(f.purpose && { purpose: f.purpose.value }), ...(f.address && { address: f.address.value }),
        ...(f.propertyClass && { propertyClass: f.propertyClass.value }), ...(f.borrowerName && { borrowerName: f.borrowerName.value }), ...(f.instructionDate && { instructionDate: f.instructionDate.value }),
      })
      setNotice('Filled what could be read. Please check every box.')
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(null) }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy('create')
    try {
      const property = await api.post<{ id: string }>('/properties', {
        propertyClass: form.propertyClass, addressLine: form.address.trim(),
        ...(form.locality && { locality: form.locality }), ...(form.district && { district: form.district }), ...(form.state && { state: form.state }), ...(form.pinCode && { pinCode: form.pinCode }),
      })
      const assignment = await api.post<{ id: string; code: string }>('/assignments', {
        bankId: form.bankId, propertyId: property.id, assignedValuerId: form.assignedValuerId, purpose: form.purpose.trim(),
        valuationDate: form.valuationDate, dueDate: form.dueDate, intakeSource: form.source, priority: form.priority,
        ...(form.branchId && { branchId: form.branchId }), ...(form.borrowerName.trim() && { borrowerName: form.borrowerName.trim() }), ...(form.clientPhone.trim() && { clientPhone: form.clientPhone.trim() }),
        ...(form.assignedDrafterId && { assignedDrafterId: form.assignedDrafterId }), ...(form.assignedInspectorId && { assignedInspectorId: form.assignedInspectorId }),
        ...(form.instructionDate && { instructionDate: form.instructionDate }), ...(form.fee && { fee: Number(form.fee) }), ...(form.scope.trim() && { scope: form.scope.trim() }),
      })
      const failed: string[] = []
      for (const file of files) {
        const data = new FormData(); data.set('type', typeOf(file)); data.set('source', form.source); data.set('assignmentId', assignment.id); data.set('file', file)
        try { await api.upload(`/properties/${property.id}/documents`, data) } catch (caught) { failed.push(`${file.name}: ${errorMessage(caught)}`) }
      }
      setCreated({ id: assignment.id, code: assignment.code, failed })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(null) }
  }

  if (created) {
    return (
      <div className="nc-done">
        <h1>Case {created.code} is logged in</h1>
        <p>{form.assignedDrafterId || form.assignedInspectorId ? 'The drafter and the inspector can see it now.' : 'Choose the drafter and the inspector on the case page.'}</p>
        {created.failed.length > 0 && <p role="alert" className="pd-flag">Some files did not upload: {created.failed.join('; ')}. Add them from the case page.</p>}
        <div className="flex gap-2"><Link to={`/assignments/${created.id}/bank-report`} className="pd-btn is-primary">Open report →</Link><Link to={`/assignments/${created.id}`} className="pd-btn is-ghost">Open the case</Link><Link to="/assignments" className="pd-btn is-ghost">Back to the inbox</Link></div>
      </div>
    )
  }

  return (
    <form onSubmit={create} className="nc-page">
      <PageHeader eyebrow="New case" title="Log in a case" subtitle="Add the papers, say who it is for, and give it to the drafter and the inspector." />
      <ErrorText message={error} />
      {notice && <p className="pd-notice" role="status">{notice}</p>}

      <section className="nc-card">
        <h2>1. Papers</h2>
        <p className="pd-muted">Everything that came with the work. Each file gets its own type, which you can change.</p>
        <label className="intake-dropzone">
          <input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <span className="intake-cloud">⇧</span><b>Drop files here or <em>browse</em></b><small>PDF, JPG or PNG · up to 25 MB per file</small>
        </label>
        <div className="nd-checklist" aria-label="Papers by type">
          <div className="nd-chips">
            {PAPER_TYPES.map((type) => {
              const count = files.filter((f) => typeOf(f) === type).length
              return <button key={type} type="button" className={`nd-chip ${count > 0 ? 'is-on' : ''}`} onClick={() => { typedFor.current = type; typedInput.current?.click() }}><span>{count > 0 ? '✓' : '+'}</span>{DOCUMENT_TYPE_LABELS[type]}{count > 0 && <em>{count}</em>}</button>
            })}
          </div>
          <input ref={typedInput} type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { addFiles(Array.from(e.target.files ?? []), typedFor.current); e.target.value = '' }} />
        </div>
        {files.length > 0 && <div className="intake-file-list">
          {files.map((file) => (
            <div className="intake-file-row" key={keyOf(file)}>
              <span className="intake-file-icon">{file.type.includes('pdf') ? 'PDF' : 'IMG'}</span>
              <span className="intake-file-info"><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span>
              <select className={inputClass} aria-label={`Type of ${file.name}`} value={typeOf(file)} onChange={(e) => setTypes({ ...types, [keyOf(file)]: e.target.value as DocumentType })} style={{ maxWidth: 190 }}>{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}</select>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((f) => f !== file))}>×</button>
            </div>
          ))}
          <button type="button" className="chk-link" disabled={busy !== null} onClick={() => void fillFromFiles()}>{busy === 'read' ? 'Reading…' : 'Fill the boxes below from these files (optional)'}</button>
        </div>}
      </section>

      <section className="nc-card">
        <h2>2. The case</h2>
        <div className="nc-grid">
          <label>Bank *<select className={inputClass} required value={form.bankId} onChange={(e) => set({ bankId: e.target.value, branchId: '' })}><option value="">Choose bank…</option>{banks.data?.items.filter((b) => isSupportedBank(b.name)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>Branch<select className={inputClass} value={form.branchId} onChange={(e) => set({ branchId: e.target.value })}><option value="">Not known</option>{branches.map((b) => <option key={b.id} value={b.id}>{[b.name, b.city, b.district, b.state].filter(Boolean).join(', ')}</option>)}</select></label>
          <label>Client name<input className={inputClass} value={form.borrowerName} onChange={(e) => set({ borrowerName: e.target.value })} /></label>
          <label>Client phone<input className={inputClass} type="tel" value={form.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} /></label>
          <label className="is-wide">What is it for? *<input className={inputClass} required minLength={2} placeholder="e.g. Loan against property, valuation and restatement" value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} /></label>
          <label>Due date *<input className={inputClass} type="date" required value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></label>
        </div>
      </section>

      <section className="nc-card">
        <h2>3. The property</h2>
        <div className="nc-grid">
          <label className="is-wide">Address *<input className={inputClass} required minLength={3} value={form.address} onChange={(e) => set({ address: e.target.value })} /></label>
          <label>Type<select className={inputClass} value={form.propertyClass} onChange={(e) => set({ propertyClass: e.target.value as PropertyClass })}>{PROPERTY_CLASSES.map((c) => <option key={c} value={c}>{PROPERTY_CLASS_LABELS[c]}</option>)}</select></label>
          <label>Locality / sector<input className={inputClass} value={form.locality} onChange={(e) => set({ locality: e.target.value })} /></label>
          <label>District / city<input className={inputClass} value={form.district} onChange={(e) => set({ district: e.target.value })} /></label>
          <label>State<input className={inputClass} value={form.state} onChange={(e) => set({ state: e.target.value })} /></label>
          <label>PIN code<input className={inputClass} pattern="\d{6}" placeholder="6 digits" value={form.pinCode} onChange={(e) => set({ pinCode: e.target.value })} /></label>
        </div>
      </section>

      <section className="nc-card">
        <h2>4. Who works on it</h2>
        <div className="nc-grid">
          <label>Valuer *<select className={inputClass} required value={form.assignedValuerId} onChange={(e) => set({ assignedValuerId: e.target.value })}><option value="">Choose…</option>{valuers.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>
          <label>Drafter<select className={inputClass} value={form.assignedDrafterId} onChange={(e) => set({ assignedDrafterId: e.target.value })}><option value="">Choose later</option>{drafters.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select>{staff.data && drafters.length === 0 && <small className="nc-hint">No drafter yet. The owner adds one in Administration → Users with the role Drafter.</small>}</label>
          <label>Site inspector<select className={inputClass} value={form.assignedInspectorId} onChange={(e) => set({ assignedInspectorId: e.target.value })}><option value="">Choose later</option>{inspectors.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select>{staff.data && inspectors.length === 0 && <small className="nc-hint">No inspector yet. The owner adds one in Administration → Users with the role Inspector.</small>}</label>
        </div>
      </section>

      <details className="br-sec">
        <summary><b>More</b><span className="br-badge">optional</span></summary>
        <div className="nc-grid" style={{ padding: '4px 16px 14px' }}>
          <label>How it arrived<select className={inputClass} value={form.source} onChange={(e) => set({ source: e.target.value as IntakeSource })}>{(Object.keys(INTAKE_SOURCE_LABELS) as IntakeSource[]).map((s) => <option key={s} value={s}>{INTAKE_SOURCE_LABELS[s]}</option>)}</select></label>
          <label>Priority<select className={inputClass} value={form.priority} onChange={(e) => set({ priority: e.target.value as AssignmentPriority })}>{ASSIGNMENT_PRIORITIES.map((p) => <option key={p} value={p}>{ASSIGNMENT_PRIORITY_LABELS[p]}</option>)}</select></label>
          <label>Fee (₹)<input className={inputClass} type="number" min="0" step="0.01" value={form.fee} onChange={(e) => set({ fee: e.target.value })} /></label>
          <label>Date the bank sent it<input className={inputClass} type="date" value={form.instructionDate} onChange={(e) => set({ instructionDate: e.target.value })} /></label>
          <label>Valuation date<input className={inputClass} type="date" value={form.valuationDate} onChange={(e) => set({ valuationDate: e.target.value })} /></label>
          <label className="is-wide">Scope of work<input className={inputClass} value={form.scope} onChange={(e) => set({ scope: e.target.value })} /></label>
        </div>
      </details>

      <div className="nc-actions">
        <Link to="/assignments" className="pd-btn is-ghost">Cancel</Link>
        <button type="submit" className="pd-btn is-primary" disabled={busy !== null}>{busy === 'create' ? 'Logging in…' : 'Log in the case'}</button>
      </div>
    </form>
  )
}
