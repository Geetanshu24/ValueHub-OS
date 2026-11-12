import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ASSIGNMENT_PRIORITIES, ASSIGNMENT_PRIORITY_LABELS, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, INTAKE_SOURCE_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS,
  type AssignmentPriority, type DocumentType, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import { ErrorText, errorMessage, formatInr, inputClass } from '../components/ui.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useFetch } from '../lib/useFetch.ts'

interface Bank { id: string; name: string; branches: { id: string; name: string }[] }
interface Staff { id: string; fullName: string; role: string }
interface Property { id: string; code: string; addressLine: string; propertyClass: PropertyClass; locality?: string | null; district?: string | null; state?: string | null }
interface Assignment { id: string; code: string; purpose: string; dueDate: string; status: string; bank: { name: string }; property: { code: string; addressLine: string } }
interface PreviousReport { id: string; reportNumber: string; createdAt: string; totalValue: string; assignment: { id: string; code: string; purpose: string; bank: { id: string; name: string }; property: Property } }
interface Guess<T = string> { value: T; confidence: number }
interface ExtractResult {
  files: { name: string; status: 'READ' | 'NO_TEXT' | 'FAILED'; note?: string }[]
  fields: { bankId?: Guess; purpose?: Guess; address?: Guess; propertyClass?: Guess<PropertyClass>; instructionDate?: Guess; borrowerName?: Guess }
}
interface Reuse { assignmentId: string; reportNumber: string }
interface Filters { q: string; bankId: string; state: string; district: string; locality: string; propertyClass: '' | PropertyClass; years: string }

const DRAFT_KEY = 'valuehub-intake-draft'
const dateToday = new Date().toISOString().slice(0, 10)
const dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
const blankProperty = { propertyClass: 'HOUSE' as PropertyClass, addressLine: '', unitDetail: '', locality: '', district: '', state: '', pinCode: '', khasra: '' }
const blankFilters: Filters = { q: '', bankId: '', state: '', district: '', locality: '', propertyClass: '', years: '' }
const sourceOptions: { value: IntakeSource; note: string; icon: string }[] = [
  { value: 'WHATSAPP', note: 'Save attachment first', icon: '◉' },
  { value: 'EMAIL', note: 'Download attachments', icon: '✉' },
  { value: 'MOBILE_APP', note: 'Scan, then upload', icon: '▣' },
  { value: 'DASHBOARD', note: 'Upload from device', icon: '⇧' },
  { value: 'MANUAL', note: 'Type the details in', icon: '✎' },
]
const stages = [
  ['Registration', 'Bank, loan and applicant'],
  ['Property & GPS', 'Where it is, and earlier work'],
  ['Assign Staff', 'Valuer, inspector, due date'],
  ['Confirm', 'Check and create the case'],
]
const SCOPE_ITEMS = ['Market value assessment', 'Realizable / distress value', 'Technical report with photographs', 'Title and legal documents scrutiny']
const PURPOSES = ['Home Loan Mortgage Valuation', 'Loan Against Property (LAP)', 'Project Finance / Construction', 'SARFAESI Distress Valuation', 'Capital Gain Tax / Income Tax']
const BILLING = ['Direct to Bank Monthly Invoice', 'Borrower Cash/NEFT on Site', 'Pre-paid by Bank DD']
const SLA: Record<AssignmentPriority, string> = { LOW: 'Relaxed', NORMAL: 'Normal (3-4 days SLA)', HIGH: 'Urgent (48 hours SLA)', URGENT: 'Super Urgent (same day / 24h)' }
const AREA_UNITS = { 'Sq.Yd': 0.83612736, 'Sq.Ft': 0.09290304, 'Sq.M': 1, Acre: 4046.8564224 } as const
type AreaUnit = keyof typeof AREA_UNITS

// A sector or locality in the address is the most useful first search term.
const guessLocality = (address: string) => /sector\s*\d+[a-z]?/i.exec(address)?.[0] ?? ''
const confidenceLabel = (guess?: Guess<unknown>) => (!guess ? 'Not found' : guess.confidence >= 0.55 ? 'Likely' : 'Check')

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as null | Record<string, unknown> } catch { return null }
}

export default function NewAssignment() {
  const banks = useFetch<Paginated<Bank>>('/banks?pageSize=100')
  const staff = useFetch<Staff[]>('/users/staff')
  const [step, setStep] = useState(1)
  const [source, setSource] = useState<IntakeSource>('EMAIL')
  const [files, setFiles] = useState<File[]>([])
  const [reading, setReading] = useState<ExtractResult | null>(null)
  const [readBusy, setReadBusy] = useState(false)
  const [filters, setFilters] = useState<Filters>(blankFilters)
  const [reports, setReports] = useState<PreviousReport[]>([])
  const [matches, setMatches] = useState<Property[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<Property | null>(null)
  const [reuse, setReuse] = useState<Reuse | null>(null)
  const [previous, setPrevious] = useState<Assignment[]>([])
  const [property, setProperty] = useState(blankProperty)
  const [form, setForm] = useState({ bankId: '', branchId: '', assignedValuerId: '', purpose: PURPOSES[0], valuationDate: dateToday, instructionDate: dateToday, dueDate: dueDefault, priority: 'NORMAL' as AssignmentPriority, borrowerName: '', fee: '' })
  const [extra, setExtra] = useState({ officer: '', officerMobile: '', loanAccount: '', scope: [SCOPE_ITEMS[0]] as string[], father: '', mobile: '', email: '', areaValue: '', areaUnit: 'Sq.Yd' as AreaUnit, plannedInspectorId: '', billing: BILLING[1], special: '', lat: '', lon: '' })
  const [documentType, setDocumentType] = useState<DocumentType>('BANK_INSTRUCTION')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; code: string; uploaded: number; failed: string[] } | null>(null)
  const [draft, setDraft] = useState(readDraft)
  const branches = banks.data?.items.find((bank) => bank.id === form.bankId)?.branches ?? []
  const validStaff = useMemo(() => staff.data?.filter((person) => person.role === 'VALUER' || person.role === 'FIRM_ADMIN') ?? [], [staff.data])
  const inspectors = useMemo(() => staff.data?.filter((person) => person.role === 'INSPECTOR' || person.role === 'VALUER' || person.role === 'FIRM_ADMIN') ?? [], [staff.data])
  const bankName = (id: string) => banks.data?.items.find((bank) => bank.id === id)?.name
  const setE = <K extends keyof typeof extra>(key: K, value: (typeof extra)[K]) => setExtra((current) => ({ ...current, [key]: value }))

  // Reads the uploaded instruction and fills in what it can; the person confirms every value.
  async function readInstruction() {
    setError(null); setReading(null)
    if (files.length === 0) return
    setReadBusy(true)
    try {
      const data = new FormData()
      files.forEach((file) => data.append('files', file))
      const result = await api.upload<ExtractResult>('/intake/extract', data)
      setReading(result)
      const f = result.fields
      setForm((current) => ({ ...current, bankId: f.bankId?.value ?? current.bankId, branchId: '', purpose: f.purpose?.value ?? current.purpose, instructionDate: f.instructionDate?.value ?? current.instructionDate, borrowerName: f.borrowerName?.value ?? current.borrowerName }))
      setProperty((current) => ({ ...current, addressLine: f.address?.value ?? current.addressLine, propertyClass: f.propertyClass?.value ?? current.propertyClass }))
    } catch (caught) { setError(errorMessage(caught)) } finally { setReadBusy(false) }
  }

  function next() {
    setError(null)
    if (step === 1) {
      if (!form.bankId) return setError('Choose the bank')
      if (form.purpose.trim().length < 2) return setError('Enter the valuation purpose')
    }
    if (step === 2) {
      if (!form.borrowerName.trim()) return setError('Enter the applicant name')
      if (!selected && property.addressLine.trim().length < 3) return setError('Enter the property address')
    }
    if (step === 3) {
      if (!form.assignedValuerId) return setError('Choose the drafter / valuer')
      if (!form.dueDate) return setError('Set the due date')
    }
    setStep(step + 1)
  }

  async function search(use: Filters = filters) {
    setError(null); setBusy(true)
    try {
      const shared = { q: use.q.trim(), state: use.state.trim(), district: use.district.trim(), locality: use.locality.trim(), propertyClass: use.propertyClass }
      const [found, list] = await Promise.all([
        api.get<Paginated<PreviousReport>>('/intake/previous-work', { ...shared, bankId: use.bankId, years: use.years, pageSize: 20 }),
        api.get<Paginated<Property>>('/properties', { ...shared, pageSize: 20 }),
      ])
      setReports(found.items); setMatches(list.items); setSearched(true)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  function checkExisting() {
    const use = { ...blankFilters, locality: property.locality || guessLocality(property.addressLine), district: property.district, propertyClass: property.propertyClass }
    setFilters(use); void search(use)
  }
  async function chooseProperty(item: Property) {
    setSelected(item); setReuse(null); setError(null)
    try { setPrevious((await api.get<Paginated<Assignment>>('/assignments', { propertyId: item.id, pageSize: 20 })).items) }
    catch (caught) { setError(errorMessage(caught)) }
  }
  // "Use for New": the property comes from the earlier report; dates and the case itself are fresh.
  function reuseReport(report: PreviousReport) {
    setSelected(report.assignment.property); setPrevious([])
    setReuse({ assignmentId: report.assignment.id, reportNumber: report.reportNumber })
    setForm((current) => ({ ...current, bankId: current.bankId || report.assignment.bank.id, branchId: '' }))
  }
  function captureGps() {
    if (!navigator.geolocation) { setError('This browser cannot give a location.'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setE('lat', pos.coords.latitude.toFixed(6)); setE('lon', pos.coords.longitude.toFixed(6)) },
      () => setError('Could not get a location fix. Allow location access, or type the coordinates.'),
      { enableHighAccuracy: true, timeout: 20000 },
    )
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ source, form, extra, property, selected, reuse, step, savedAt: new Date().toISOString() })); setDraft(readDraft()) } catch { setError('This browser cannot save drafts') }
  }
  function resumeDraft() {
    if (!draft) return
    const saved = draft as { source: IntakeSource; form: typeof form; extra: typeof extra; property: typeof property; selected: Property | null; reuse: Reuse | null; step: number }
    if (!saved.form || !saved.extra) { discardDraft(); return }
    setSource(saved.source); setForm(saved.form); setExtra(saved.extra); setProperty(saved.property); setSelected(saved.selected); setReuse(saved.reuse); setStep(saved.step); setDraft(null)
  }
  function discardDraft() { try { localStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ } setDraft(null) }

  const areaSqm = Number(extra.areaValue) > 0 ? Number((Number(extra.areaValue) * AREA_UNITS[extra.areaUnit]).toFixed(2)) : 0

  async function create() {
    setError(null); setBusy(true)
    try {
      let propertyId = selected?.id
      if (!propertyId) {
        const made = await api.post<Property>('/properties', {
          propertyClass: property.propertyClass, addressLine: property.addressLine.trim(),
          ...(property.unitDetail && { unitDetail: property.unitDetail }), ...(property.locality && { locality: property.locality }),
          ...(property.district && { district: property.district }), ...(property.state && { state: property.state }), ...(property.pinCode && { pinCode: property.pinCode }),
          ...(property.khasra.trim() && { khasraNumbers: property.khasra.split(/[,;]/).map((n) => n.trim()).filter(Boolean) }),
          ...(extra.lat && extra.lon && { latitude: Number(extra.lat), longitude: Number(extra.lon) }),
        })
        propertyId = made.id
      }
      const text = (value: string) => value.trim() && { value: value.trim() }
      const assignment = await api.post<{ id: string; code: string }>('/assignments', {
        bankId: form.bankId, propertyId, assignedValuerId: form.assignedValuerId, purpose: form.purpose.trim(),
        valuationDate: form.valuationDate, dueDate: form.dueDate, intakeSource: source, priority: form.priority,
        ...(form.instructionDate && { instructionDate: form.instructionDate }), borrowerName: form.borrowerName.trim(),
        ...(reuse && { reusedFromId: reuse.assignmentId }),
        ...(form.branchId && { branchId: form.branchId }), ...(extra.scope.length > 0 && { scope: extra.scope.join('; ') }), ...(form.fee && { fee: Number(form.fee) }),
        ...(text(extra.officer) && { bankOfficerName: extra.officer.trim() }), ...(text(extra.officerMobile) && { bankOfficerMobile: extra.officerMobile.trim() }),
        ...(text(extra.loanAccount) && { loanAccountNo: extra.loanAccount.trim() }), ...(text(extra.father) && { applicantFatherName: extra.father.trim() }),
        ...(text(extra.mobile) && { applicantMobile: extra.mobile.trim() }), ...(text(extra.email) && { applicantEmail: extra.email.trim() }),
        billingArrangement: extra.billing, ...(text(extra.special) && { specialInstructions: extra.special.trim() }),
        ...(areaSqm > 0 && { approxAreaSqm: areaSqm }), ...(extra.plannedInspectorId && { plannedInspectorId: extra.plannedInspectorId }),
      })
      const failed: string[] = []
      for (const file of files) {
        const data = new FormData(); data.set('type', documentType); data.set('source', source); data.set('assignmentId', assignment.id); data.set('file', file)
        try { await api.upload(`/properties/${propertyId}/documents`, data) } catch (caught) { failed.push(`${file.name}: ${errorMessage(caught)}`) }
      }
      discardDraft()
      setCreated({ id: assignment.id, code: assignment.code, uploaded: files.length - failed.length, failed })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  useEffect(() => { window.scrollTo({ top: 0 }) }, [step, created])

  if (created) return <div className="intake-shell">
    <section className="intake-success"><span className="intake-success-tick">✓</span><h1>Case registered successfully!</h1><p>Case ID</p><b className="intake-success-code">{created.code}</b>
      <dl><div><dt>Bank</dt><dd>{bankName(form.bankId) ?? '—'}</dd></div><div><dt>Source</dt><dd>{INTAKE_SOURCE_LABELS[source]}</dd></div><div><dt>Priority</dt><dd>{ASSIGNMENT_PRIORITY_LABELS[form.priority]}</dd></div><div><dt>Files attached</dt><dd>{created.uploaded}</dd></div></dl>
      {reuse && <p className="intake-success-note">Started from {reuse.reportNumber}. The earlier report is unchanged.</p>}
      {created.failed.length > 0 && <p role="alert" className="intake-success-warn">Some files did not upload: {created.failed.join('; ')}. Add them from the Document Vault.</p>}
      <div className="intake-success-actions"><Link to={`/assignments/${created.id}`} className="intake-outline-button">View case</Link><Link to={`/assignments/${created.id}/documents`} className="intake-primary">Go to Document Vault <span>→</span></Link></div>
      <Link to="/assignments/new" reloadDocument className="intake-view-link">Register another case</Link>
    </section></div>

  const guess = (key: keyof ExtractResult['fields']) => reading?.fields[key]
  const tag = (key: keyof ExtractResult['fields']) => reading ? <em className={`intake-confidence is-${confidenceLabel(guess(key)).replace(' ', '-').toLowerCase()}`}>{confidenceLabel(guess(key))}</em> : null
  const person = (id: string) => staff.data?.find((p) => p.id === id)?.fullName ?? 'Not assigned'
  const dueText = form.dueDate ? new Date(`${form.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'
  const toggleScope = (item: string) => setE('scope', extra.scope.includes(item) ? extra.scope.filter((x) => x !== item) : [...extra.scope, item])

  return <div className="intake-shell">
    <div className="intake-topline"><Link to="/assignments" className="intake-back">← <span>Case Register</span></Link><span className="intake-save-note"><i /> Secure workspace</span></div>
    <nav className="intake-stepper" aria-label="Case registration steps">{stages.map(([label, note], index) => <button key={label} type="button" onClick={() => index + 1 < step && setStep(index + 1)} className={`intake-step ${step === index + 1 ? 'is-current' : step > index + 1 ? 'is-done' : ''}`}><span className="intake-step-number">{step > index + 1 ? '✓' : `0${index + 1}`}</span><span className="intake-step-copy"><b>{label}</b><small>{note}</small></span></button>)}</nav>
    <ErrorText message={error ?? banks.error ?? staff.error} />
    {draft && step === 1 && <div className="intake-draft-banner"><span>You have a saved draft{typeof draft.savedAt === 'string' ? ` from ${new Date(draft.savedAt).toLocaleString('en-IN')}` : ''}. Files are not saved in a draft; add them again if needed.</span><button type="button" className="intake-outline-button" onClick={resumeDraft}>Resume draft</button><button type="button" className="intake-outline-button" onClick={discardDraft}>Discard</button></div>}

    {step === 1 && <>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Instruction received</h3><p>How it arrived. Add the bank letter to fill in the details automatically (optional).</p></div><span className="intake-form-step">REGISTRATION</span></div>
        <div className="intake-source-grid">{sourceOptions.map((option) => <button key={option.value} type="button" onClick={() => setSource(option.value)} className={`intake-source-option ${source === option.value ? 'is-selected' : ''}`}><span className="intake-source-icon">{option.icon}</span><span><b>{INTAKE_SOURCE_LABELS[option.value]}</b><small>{option.note}</small></span><span className="intake-radio" /></button>)}</div>
        <label className="intake-dropzone"><input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setReading(null) }} /><span className="intake-cloud">⇧</span><b>Drop the bank letter here or <em>browse</em></b><small>PDF, JPG or PNG · up to 25 MB per file</small></label>
        {files.length > 0 && <div className="intake-file-list">{files.map((file) => <div className="intake-file-row" key={`${file.name}-${file.size}`}><span className="intake-file-icon">{file.type.includes('pdf') ? 'PDF' : 'IMG'}</span><span className="intake-file-info"><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span><button aria-label={`Remove ${file.name}`} type="button" onClick={() => setFiles(files.filter((candidate) => candidate !== file))}>×</button></div>)}
          <button type="button" className="intake-outline-button" disabled={readBusy} onClick={() => void readInstruction()}>{readBusy ? 'Reading…' : 'Read documents and fill details'}</button></div>}
        {reading && reading.files.map((file) => <p key={file.name} className={`intake-read-row is-${file.status.toLowerCase()}`}><b>{file.name}</b><span>{file.status === 'READ' ? 'Text read. Check the details below.' : file.note ?? 'Could not be read'}</span></p>)}
      </section>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Bank &amp; valuation</h3><p>Who asked for the valuation and why.</p></div><span className="intake-form-step">BANK</span></div><div className="intake-fields-grid">
        <label>Date received *<input className={inputClass} type="date" value={form.instructionDate} onChange={(e) => setForm({ ...form, instructionDate: e.target.value })} /> {tag('instructionDate')}</label>
        <label>Bank name * {tag('bankId')}<select className={inputClass} value={form.bankId} onChange={(e) => setForm({ ...form, bankId: e.target.value, branchId: '' })}><option value="">Choose bank…</option>{banks.data?.items.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
        <label>Branch<select className={inputClass} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">Optional</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label>Loan account no. / LOS ref<input className={inputClass} placeholder="e.g. SBIHL20268849" value={extra.loanAccount} onChange={(e) => setE('loanAccount', e.target.value)} /></label>
        <label>Bank officer name<input className={inputClass} placeholder="e.g. Mr. Rajesh Verma (Chief Mgr)" value={extra.officer} onChange={(e) => setE('officer', e.target.value)} /></label>
        <label>Officer mobile<input className={inputClass} placeholder="+91-98110-XXXXX" value={extra.officerMobile} onChange={(e) => setE('officerMobile', e.target.value)} /></label>
        <label className="intake-field-wide">Valuation purpose * {tag('purpose')}<input className={inputClass} list="intake-purposes" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /><datalist id="intake-purposes">{PURPOSES.map((p) => <option key={p} value={p} />)}</datalist></label>
        <fieldset className="intake-field-wide"><legend>Scope of service requested</legend><div className="intake-scope">{SCOPE_ITEMS.map((item) => <label key={item}><input type="checkbox" checked={extra.scope.includes(item)} onChange={() => toggleScope(item)} /> {item}</label>)}</div></fieldset>
      </div></section>
    </>}

    {step === 2 && <>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Applicant</h3><p>The borrower or client.</p></div><span className="intake-form-step">APPLICANT</span></div><div className="intake-fields-grid">
        <label>Applicant name * {tag('borrowerName')}<input className={inputClass} placeholder="Mr. Ramesh Kumar Gupta" value={form.borrowerName} onChange={(e) => setForm({ ...form, borrowerName: e.target.value })} /></label>
        <label>Father / husband name<input className={inputClass} value={extra.father} onChange={(e) => setE('father', e.target.value)} /></label>
        <label>Primary mobile<input className={inputClass} placeholder="+91-98110-XXXXX" value={extra.mobile} onChange={(e) => setE('mobile', e.target.value)} /></label>
        <label>Email address<input className={inputClass} type="email" value={extra.email} onChange={(e) => setE('email', e.target.value)} /></label>
      </div></section>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Property &amp; GPS</h3><p>{selected ? `Using the property on record: ${selected.code}` : 'Where the property is. Details can be completed later in the Document Vault.'}</p></div><span className="intake-form-step">PROPERTY</span></div>
        {selected && <div className="intake-reuse-banner"><b>{selected.code} · {selected.addressLine}</b><span>{reuse ? `Starting from report ${reuse.reportNumber}.` : 'Only the property identity is reused.'}</span><button type="button" className="intake-outline-button" onClick={() => { setSelected(null); setReuse(null); setPrevious([]) }}>Don’t reuse</button></div>}
        {!selected && <div className="intake-fields-grid">
          <label>Property type * {tag('propertyClass')}<select className={inputClass} value={property.propertyClass} onChange={(e) => setProperty({ ...property, propertyClass: e.target.value as PropertyClass })}>{PROPERTY_CLASSES.map((value) => <option key={value} value={value}>{PROPERTY_CLASS_LABELS[value]}</option>)}</select></label>
          <label>Approximate land area<span className="intake-area"><input className={inputClass} type="number" min="0" step="0.01" value={extra.areaValue} onChange={(e) => setE('areaValue', e.target.value)} /><select className={inputClass} value={extra.areaUnit} onChange={(e) => setE('areaUnit', e.target.value as AreaUnit)}>{(Object.keys(AREA_UNITS) as AreaUnit[]).map((u) => <option key={u} value={u}>{u}</option>)}</select></span></label>
          <label className="intake-field-wide">Full structured property address * {tag('address')}<input className={inputClass} placeholder="House / plot number, street, locality, city" value={property.addressLine} onChange={(e) => setProperty({ ...property, addressLine: e.target.value })} /></label>
          <label>Khasra / plot no.<input className={inputClass} placeholder="Comma separated" value={property.khasra} onChange={(e) => setProperty({ ...property, khasra: e.target.value })} /></label>
          <label>Unit / floor<input className={inputClass} value={property.unitDetail} onChange={(e) => setProperty({ ...property, unitDetail: e.target.value })} /></label>
          <label>Colony / sector<input className={inputClass} value={property.locality} onChange={(e) => setProperty({ ...property, locality: e.target.value })} /></label>
          <label>District / city<input className={inputClass} value={property.district} onChange={(e) => setProperty({ ...property, district: e.target.value })} /></label>
          <label>State<input className={inputClass} value={property.state} onChange={(e) => setProperty({ ...property, state: e.target.value })} /></label>
          <label>PIN code<input className={inputClass} placeholder="6 digits" pattern="\d{6}" value={property.pinCode} onChange={(e) => setProperty({ ...property, pinCode: e.target.value })} /></label>
        </div>}
        {!selected && <div className="intake-gps"><div><b>GPS location</b><small>{extra.lat && extra.lon ? `${extra.lat}, ${extra.lon}` : 'Not captured. Capture it from the property, or type it.'}</small></div>
          <input className={inputClass} placeholder="Latitude" value={extra.lat} onChange={(e) => setE('lat', e.target.value)} /><input className={inputClass} placeholder="Longitude" value={extra.lon} onChange={(e) => setE('lon', e.target.value)} /><button type="button" className="intake-outline-button" onClick={captureGps}>◎ Capture my location</button></div>}
      </section>
      <section className="intake-panel intake-search-panel"><div className="intake-results-head"><div><h3>Existing work on this property</h3><p>A property can have many cases. Reusing never changes an earlier report.</p></div><button type="button" className="intake-outline-button" disabled={busy} onClick={checkExisting}>{busy ? 'Searching…' : searched ? 'Search again' : 'Check for existing work'}</button></div>
        {searched && (reports.length > 0 ? <div className="intake-report-table" role="table"><div className="intake-report-row is-head" role="row"><span>Report no.</span><span>Address / property</span><span>Bank</span><span>Date</span><span>Value</span><span /></div>
          {reports.map((report) => <div className="intake-report-row" role="row" key={report.id}><b>{report.reportNumber}</b><span>{report.assignment.property.addressLine}<small>{report.assignment.property.code}</small></span><span>{report.assignment.bank.name}</span><span>{new Date(report.createdAt).toLocaleDateString('en-IN')}</span><span>₹ {formatInr(report.totalValue)}</span><span className="intake-report-actions"><Link className="intake-outline-button" to={`/assignments/${report.assignment.id}`} target="_blank">View ↗</Link><button type="button" className="intake-primary" onClick={() => reuseReport(report)}>Use for new</button></span></div>)}</div>
          : <p className="intake-no-history">No approved or issued report matches. {matches.length > 0 ? 'You can pick a property on record below, or continue with a new one.' : 'A new property record will be created.'}</p>)}
        {searched && matches.length > 0 && <div className="intake-property-list">{matches.map((item) => <article key={item.id} className={`intake-property-row ${selected?.id === item.id ? 'is-selected' : ''}`}><span className="intake-property-avatar">⌂</span><div className="intake-property-main"><b>{item.addressLine}</b><small>{item.code} <span>·</span> {PROPERTY_CLASS_LABELS[item.propertyClass]}</small></div><div className="intake-property-location">{[item.locality, item.district, item.state].filter(Boolean).join(', ') || 'Location not recorded'}</div><button type="button" className={selected?.id === item.id ? 'intake-selected-button' : 'intake-outline-button'} onClick={() => void chooseProperty(item)}>{selected?.id === item.id ? '✓ Selected' : 'Use property'}</button></article>)}</div>}
        {selected && !reuse && previous.length > 0 && <div className="intake-history-list">{previous.map((item) => <article key={item.id} className="intake-history-row"><span className="intake-history-doc">▤</span><span className="intake-history-copy"><b>{item.code}</b><small>{item.bank.name} · {item.purpose}</small></span><span className="intake-status">{item.status.replaceAll('_', ' ')}</span><Link to={`/assignments/${item.id}`} target="_blank" className="intake-view-link">View ↗</Link></article>)}</div>}
      </section>
    </>}

    {step === 3 && <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Assign staff &amp; schedule</h3><p>Who prepares the documents, who visits the site, and by when.</p></div><span className="intake-form-step">ASSIGN</span></div><div className="intake-fields-grid">
      <label>Assign drafter (document layer) *<select className={inputClass} value={form.assignedValuerId} onChange={(e) => setForm({ ...form, assignedValuerId: e.target.value })}><option value="">Choose…</option>{validStaff.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>
      <label>Assign inspector (site layer)<select className={inputClass} value={extra.plannedInspectorId} onChange={(e) => setE('plannedInspectorId', e.target.value)}><option value="">Decide later</option>{inspectors.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.role.toLowerCase().replace('_', ' ')})</option>)}</select></label>
      <label>Due date *<input className={inputClass} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
      <label>Valuation date *<input className={inputClass} type="date" value={form.valuationDate} onChange={(e) => setForm({ ...form, valuationDate: e.target.value })} /></label>
      <label>Priority level<select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AssignmentPriority })}>{ASSIGNMENT_PRIORITIES.map((value) => <option key={value} value={value}>{SLA[value]}</option>)}</select></label>
      <label>Agreed fee (₹)<input className={inputClass} type="number" min="0" step="0.01" placeholder="Leave empty for the bank’s default fee" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></label>
      <label className="intake-field-wide">Billing arrangement<select className={inputClass} value={extra.billing} onChange={(e) => setE('billing', e.target.value)}>{BILLING.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
      <label className="intake-field-wide">Special bank instructions / red flags<textarea className={inputClass} rows={3} placeholder="e.g. Verify road width carefully; boundary wall dispute flagged by the branch officer" value={extra.special} onChange={(e) => setE('special', e.target.value)} /></label>
    </div></section>}

    {step === 4 && <>
      <section className="intake-summary-card intake-confirm"><div className="intake-confirm-head"><span className="intake-summary-label">CASE INTAKE SUMMARY CARD</span><em>Ready for creation</em></div>
        <dl><div><dt>Client / applicant</dt><dd>{form.borrowerName || '—'}</dd></div><div><dt>Bank / branch</dt><dd>{bankName(form.bankId) ?? '—'}{branches.find((b) => b.id === form.branchId) ? ` (${branches.find((b) => b.id === form.branchId)?.name})` : ''}</dd></div>
          <div className="is-wide"><dt>Property</dt><dd>{(selected?.addressLine ?? property.addressLine) || '—'}{areaSqm > 0 ? ` (${extra.areaValue} ${extra.areaUnit})` : ''}</dd></div>
          <div><dt>Assigned drafter</dt><dd>{person(form.assignedValuerId)}</dd></div><div><dt>Assigned inspector</dt><dd>{extra.plannedInspectorId ? person(extra.plannedInspectorId) : 'Decide later'}</dd></div>
          <div><dt>Agreed fee</dt><dd>{form.fee ? `₹ ${formatInr(form.fee)}` : 'Bank default'}</dd></div><div><dt>Target due date</dt><dd>{dueText}</dd></div>
          <div><dt>Purpose</dt><dd>{form.purpose}</dd></div><div><dt>Priority</dt><dd>{SLA[form.priority]}</dd></div></dl>
        <div className="intake-governance"><b>ValuerPro core governance rule</b><p>Creating this case sets up separate document and site evidence layers. Staff cannot overwrite each other’s field observations.</p></div>
      </section>
      {files.length > 0 && <section className="intake-panel intake-doc-type"><div><b>Classify instruction files</b><small>{files.length} file{files.length === 1 ? '' : 's'} will be stored once the case is created.</small></div><select className={inputClass} value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>{DOCUMENT_TYPES.map((value) => <option key={value} value={value}>{DOCUMENT_TYPE_LABELS[value]}</option>)}</select></section>}
    </>}

    <footer className="intake-footer">
      {step > 1 ? <button type="button" className="intake-back-button" onClick={() => setStep(step - 1)}>← Back</button> : <span />}
      <span className="intake-footer-actions">
        <button type="button" className="intake-outline-button" onClick={saveDraft}>Save as draft</button>
        {step < 4 ? <button type="button" className="intake-primary" onClick={next}>Next: {stages[step][0]} <span>→</span></button>
          : <button type="button" className="intake-primary" disabled={busy} onClick={() => void create()}>{busy ? 'Creating case…' : 'Create case'} <span>→</span></button>}
      </span>
    </footer>
  </div>
}
