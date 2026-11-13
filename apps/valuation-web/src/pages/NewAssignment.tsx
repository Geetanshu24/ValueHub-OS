import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ASSIGNMENT_PRIORITIES, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, INTAKE_SOURCES, INTAKE_SOURCE_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS,
  type AssignmentPriority, type DocumentType, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import { ErrorText, errorMessage, formatInr, inputClass } from '../components/ui.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Bank { id: string; name: string; branches: { id: string; name: string }[] }
interface Staff { id: string; fullName: string; role: string }
interface Guess<T = string> { value: T; confidence: number }
interface DeedResult {
  files: { name: string; status: 'READ' | 'NO_TEXT' | 'FAILED'; note?: string }[]
  fields: { borrowerName?: Guess; fatherName?: Guess; propertyClass?: Guess<PropertyClass>; area?: Guess<{ value: number; unit: AreaUnit }>; address?: Guess; khasra?: Guess; locality?: Guess; district?: Guess }
}
type DeedField = keyof DeedResult['fields']

const DRAFT_KEY = 'valuehub-intake-draft'
const dateToday = new Date().toISOString().slice(0, 10)
const dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
const blankProperty = { propertyClass: 'HOUSE' as PropertyClass, addressLine: '', locality: '', district: '', khasra: '' }
const stages = [
  ['Registration', 'Bank and valuation details'],
  ['Property & GPS', 'Documents, applicant, property'],
  ['Assign Staff', 'Drafter, inspector, due date'],
  ['Confirm', 'Check and create the case'],
]
const SCOPE_ITEMS = ['Property Valuation Report', 'Physical Site Measurement', 'Document vs Site Verification', 'Stage Construction Estimate']
const PURPOSES = ['Home Loan Mortgage Valuation', 'Loan Against Property (LAP)', 'Project Finance / Construction', 'SARFAESI Distress Valuation', 'Capital Gain Tax / Income Tax']
const BILLING = ['Direct to Bank Monthly Invoice', 'Borrower Cash/NEFT on Site', 'Pre-paid by Bank DD']
const SLA: Record<AssignmentPriority, string> = { LOW: 'Relaxed', NORMAL: 'Normal (3-4 days SLA)', HIGH: 'Urgent (48 hours SLA)', URGENT: 'Super Urgent (same day / 24h)' }
const AREA_UNITS = { 'Sq.Yd': 0.83612736, 'Sq.Ft': 0.09290304, 'Sq.M': 1, Acre: 4046.8564224 } as const
type AreaUnit = keyof typeof AREA_UNITS

// A first guess at what a file is from its name; the person can change it.
const TYPE_GUESSES: [RegExp, DocumentType][] = [
  [/layout/i, 'LAYOUT_PLAN'], [/completion/i, 'COMPLETION_CERTIFICATE'], [/occupation|\boc\b/i, 'OCCUPATION_CERTIFICATE'],
  [/shajra|sajra|sejra/i, 'SHAJRA_PLAN'], [/jamabandi|jamabandhi|khasra|khatauni|revenue/i, 'REVENUE_RECORD'], [/magistrate/i, 'MAGISTRATE_CERTIFICATE'],
  [/patwari/i, 'PATWARI_REPORT'], [/electric|bijli/i, 'ELECTRICITY_BILL'], [/property.?tax|house.?tax/i, 'PROPERTY_TAX'], [/water/i, 'WATER_BILL'],
  [/registry|regd/i, 'REGISTRY_PAPERS'], [/deed|conveyance|sale/i, 'SALE_DEED'], [/approved|sanction|map|plan/i, 'APPROVED_PLAN'],
]
const guessType = (name: string): DocumentType => TYPE_GUESSES.find(([pattern]) => pattern.test(name))?.[1] ?? 'BANK_INSTRUCTION'
const confidenceLabel = (guess?: Guess<unknown>) => (!guess ? 'Not found' : guess.confidence >= 0.55 ? 'Likely' : 'Check')

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as null | Record<string, unknown> } catch { return null }
}

export default function NewAssignment() {
  const { user } = useAuth()
  const banks = useFetch<Paginated<Bank>>('/banks?pageSize=100')
  const staff = useFetch<Staff[]>('/users/staff')
  const [step, setStep] = useState(1)
  const [source, setSource] = useState<IntakeSource>('EMAIL')
  const [files, setFiles] = useState<File[]>([])
  const [reading, setReading] = useState<DeedResult | null>(null)
  const [readBusy, setReadBusy] = useState(false)
  const [property, setProperty] = useState(blankProperty)
  const [form, setForm] = useState({ bankId: '', branchId: '', purpose: PURPOSES[0], valuationDate: dateToday, instructionDate: dateToday, dueDate: dueDefault, priority: 'NORMAL' as AssignmentPriority, borrowerName: '', fee: '' })
  const [extra, setExtra] = useState({ officer: '', officerMobile: '', scope: SCOPE_ITEMS.slice(0, 3), father: '', mobile: '', email: '', areaValue: '', areaUnit: 'Sq.Yd' as AreaUnit, inspectorId: '', drafterId: '', billing: BILLING[1], special: '', lat: '', lon: '' })
  // Each file has its own type, guessed from its name and changeable.
  const [fileTypes, setFileTypes] = useState<Record<string, DocumentType>>({})
  const fileKey = (file: File) => `${file.name}-${file.size}`
  const typeOf = (file: File): DocumentType => fileTypes[fileKey(file)] ?? guessType(file.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; code: string; uploaded: number; failed: string[] } | null>(null)
  const [draft, setDraft] = useState(readDraft)
  const branches = banks.data?.items.find((bank) => bank.id === form.bankId)?.branches ?? []
  const validStaff = useMemo(() => staff.data?.filter((person) => person.role === 'VALUER' || person.role === 'FIRM_ADMIN') ?? [], [staff.data])
  const drafters = useMemo(() => staff.data?.filter((person) => person.role === 'DRAFTER') ?? [], [staff.data])
  const inspectors = useMemo(() => staff.data?.filter((person) => person.role === 'INSPECTOR' || person.role === 'VALUER' || person.role === 'FIRM_ADMIN') ?? [], [staff.data])
  // The case form has no valuer field: the person registering signs, or the first valuer in the firm.
  const valuerId = user && validStaff.some((person) => person.id === user.id) ? user.id : validStaff[0]?.id
  const bankName = (id: string) => banks.data?.items.find((bank) => bank.id === id)?.name
  const setE = <K extends keyof typeof extra>(key: K, value: (typeof extra)[K]) => setExtra((current) => ({ ...current, [key]: value }))
  const deedFiles = files.filter((file) => typeOf(file) === 'SALE_DEED')

  // Reads the sale deed and fills in what it can; anything it does not find stays for the person to type.
  async function readDeed() {
    setError(null); setReading(null)
    if (deedFiles.length === 0) return setError('Mark which file is the sale deed')
    setReadBusy(true)
    try {
      const data = new FormData()
      deedFiles.forEach((file) => data.append('files', file))
      const result = await api.upload<DeedResult>('/intake/extract-deed', data)
      setReading(result)
      const f = result.fields
      setForm((current) => ({ ...current, borrowerName: f.borrowerName?.value ?? current.borrowerName }))
      setE('father', f.fatherName?.value ?? extra.father)
      if (f.area) setExtra((current) => ({ ...current, areaValue: String(f.area?.value.value), areaUnit: f.area?.value.unit ?? current.areaUnit }))
      setProperty((current) => ({ ...current, addressLine: f.address?.value ?? current.addressLine, propertyClass: f.propertyClass?.value ?? current.propertyClass, khasra: f.khasra?.value ?? current.khasra, locality: f.locality?.value ?? current.locality, district: f.district?.value ?? current.district }))
    } catch (caught) { setError(errorMessage(caught)) } finally { setReadBusy(false) }
  }

  function next() {
    setError(null)
    if (step === 1) {
      if (!form.bankId) return setError('Choose the bank')
      if (!form.instructionDate) return setError('Enter the date received')
      if (form.purpose.trim().length < 2) return setError('Enter the valuation purpose')
    }
    if (step === 2) {
      if (!form.borrowerName.trim()) return setError('Enter the applicant name')
      if (property.addressLine.trim().length < 3) return setError('Enter the property address')
    }
    if (step === 3) {
      if (!form.dueDate) return setError('Set the due date')
      if (!valuerId) return setError('No valuer is available to sign this case')
    }
    setStep(step + 1)
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
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ source, form, extra, property, step, savedAt: new Date().toISOString() })); setDraft(readDraft()) } catch { setError('This browser cannot save drafts') }
  }
  function resumeDraft() {
    if (!draft) return
    const saved = draft as { source: IntakeSource; form: typeof form; extra: typeof extra; property: typeof property; step: number }
    if (!saved.form || !saved.extra || !saved.property) { discardDraft(); return }
    setSource(saved.source); setForm(saved.form); setExtra(saved.extra); setProperty({ ...blankProperty, ...saved.property }); setStep(saved.step); setDraft(null)
  }
  function discardDraft() { try { localStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ } setDraft(null) }

  const areaSqm = Number(extra.areaValue) > 0 ? Number((Number(extra.areaValue) * AREA_UNITS[extra.areaUnit]).toFixed(2)) : 0

  async function create() {
    setError(null); setBusy(true)
    try {
      const made = await api.post<{ id: string }>('/properties', {
        propertyClass: property.propertyClass, addressLine: property.addressLine.trim(),
        ...(property.locality.trim() && { locality: property.locality.trim() }), ...(property.district.trim() && { district: property.district.trim() }),
        ...(property.khasra.trim() && { khasraNumbers: property.khasra.split(/[,;]/).map((n) => n.trim()).filter(Boolean) }),
        ...(extra.lat && extra.lon && { latitude: Number(extra.lat), longitude: Number(extra.lon) }),
      })
      const propertyId = made.id
      const text = (value: string) => value.trim() && { value: value.trim() }
      const assignment = await api.post<{ id: string; code: string }>('/assignments', {
        bankId: form.bankId, propertyId, assignedValuerId: valuerId, purpose: form.purpose.trim(),
        valuationDate: form.valuationDate, dueDate: form.dueDate, intakeSource: source, priority: form.priority,
        ...(form.instructionDate && { instructionDate: form.instructionDate }), borrowerName: form.borrowerName.trim(),
        ...(form.branchId && { branchId: form.branchId }), ...(extra.scope.length > 0 && { scope: extra.scope.join('; ') }), ...(form.fee && { fee: Number(form.fee) }),
        ...(text(extra.officer) && { bankOfficerName: extra.officer.trim() }), ...(text(extra.officerMobile) && { bankOfficerMobile: extra.officerMobile.trim() }),
        ...(text(extra.father) && { applicantFatherName: extra.father.trim() }),
        ...(text(extra.mobile) && { applicantMobile: extra.mobile.trim() }), ...(text(extra.email) && { applicantEmail: extra.email.trim() }),
        billingArrangement: extra.billing, ...(text(extra.special) && { specialInstructions: extra.special.trim() }),
        ...(areaSqm > 0 && { approxAreaSqm: areaSqm }), ...(extra.inspectorId && { assignedInspectorId: extra.inspectorId }), ...(extra.drafterId && { assignedDrafterId: extra.drafterId }), ...(extra.mobile.trim() && { clientPhone: extra.mobile.trim() }),
      })
      const failed: string[] = []
      for (const file of files) {
        const data = new FormData(); data.set('type', typeOf(file)); data.set('source', source); data.set('assignmentId', assignment.id); data.set('file', file)
        try { await api.upload(`/properties/${propertyId}/documents`, data) } catch (caught) { failed.push(`${file.name}: ${errorMessage(caught)}`) }
      }
      discardDraft()
      setCreated({ id: assignment.id, code: assignment.code, uploaded: files.length - failed.length, failed })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  useEffect(() => { window.scrollTo({ top: 0 }) }, [step, created])

  if (created) return <div className="intake-shell">
    <section className="intake-success"><span className="intake-success-tick">✓</span><h1>Case registered successfully!</h1><p>Case ID</p><b className="intake-success-code">{created.code}</b>
      <dl><div><dt>Bank</dt><dd>{bankName(form.bankId) ?? '—'}</dd></div><div><dt>Received via</dt><dd>{INTAKE_SOURCE_LABELS[source]}</dd></div><div><dt>Files attached</dt><dd>{created.uploaded}</dd></div></dl>
      {created.failed.length > 0 && <p role="alert" className="intake-success-warn">Some files did not upload: {created.failed.join('; ')}. Add them from the Document Vault.</p>}
      <div className="intake-success-actions"><Link to={`/assignments/${created.id}`} className="intake-outline-button">View case</Link><Link to={`/assignments/${created.id}/documents`} className="intake-primary">Go to Document Vault <span>→</span></Link></div>
      <Link to="/assignments/new" reloadDocument className="intake-view-link">Register another case</Link>
    </section></div>

  // Marks a field the deed was read for: filled from the deed, or not found and left to type.
  const tag = (key: DeedField) => reading ? <em className={`intake-confidence is-${confidenceLabel(reading.fields[key]).replace(' ', '-').toLowerCase()}`}>{reading.fields[key] ? `From deed · ${confidenceLabel(reading.fields[key])}` : 'Not in deed · type it'}</em> : null
  const person = (id: string) => staff.data?.find((p) => p.id === id)?.fullName ?? 'Not assigned'
  const dueText = form.dueDate ? new Date(`${form.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'
  const toggleScope = (item: string) => setE('scope', extra.scope.includes(item) ? extra.scope.filter((x) => x !== item) : [...extra.scope, item])

  return <div className="intake-shell">
    <div className="intake-topline"><Link to="/assignments" className="intake-back">← <span>Case Register</span></Link><span className="intake-save-note"><i /> Secure workspace</span></div>
    <nav className="intake-stepper" aria-label="Case registration steps">{stages.map(([label, note], index) => <button key={label} type="button" onClick={() => index + 1 < step && setStep(index + 1)} className={`intake-step ${step === index + 1 ? 'is-current' : step > index + 1 ? 'is-done' : ''}`}><span className="intake-step-number">{step > index + 1 ? '✓' : `0${index + 1}`}</span><span className="intake-step-copy"><b>{label}</b><small>{note}</small></span></button>)}</nav>
    <ErrorText message={error ?? banks.error ?? staff.error} />
    {draft && step === 1 && <div className="intake-draft-banner"><span>You have a saved draft{typeof draft.savedAt === 'string' ? ` from ${new Date(draft.savedAt).toLocaleString('en-IN')}` : ''}. Files are not saved in a draft; add them again if needed.</span><button type="button" className="intake-outline-button" onClick={resumeDraft}>Resume draft</button><button type="button" className="intake-outline-button" onClick={discardDraft}>Discard</button></div>}

    {step === 1 && <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Registration details</h3><p>Who asked for the valuation and why. Everything here is typed in.</p></div><span className="intake-form-step">REGISTRATION</span></div><div className="intake-fields-grid">
      <label>Receipt mode *<select className={inputClass} value={source} onChange={(e) => setSource(e.target.value as IntakeSource)}>{INTAKE_SOURCES.map((value) => <option key={value} value={value}>{INTAKE_SOURCE_LABELS[value]}</option>)}</select></label>
      <label>Date received *<input className={inputClass} type="date" value={form.instructionDate} onChange={(e) => setForm({ ...form, instructionDate: e.target.value })} /></label>
      <label>Bank name *<select className={inputClass} value={form.bankId} onChange={(e) => setForm({ ...form, bankId: e.target.value, branchId: '' })}><option value="">Choose bank…</option>{banks.data?.items.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
      <label>Branch name &amp; code<select className={inputClass} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">Optional</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Bank officer name<input className={inputClass} placeholder="e.g. Mr. Rajesh Verma (Chief Mgr)" value={extra.officer} onChange={(e) => setE('officer', e.target.value)} /></label>
      <label>Officer mobile<input className={inputClass} placeholder="+91-98110-XXXXX" value={extra.officerMobile} onChange={(e) => setE('officerMobile', e.target.value)} /></label>
      <label className="intake-field-wide">Valuation purpose *<input className={inputClass} list="intake-purposes" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /><datalist id="intake-purposes">{PURPOSES.map((p) => <option key={p} value={p} />)}</datalist></label>
      <fieldset className="intake-field-wide"><legend>Scope of service requested</legend><div className="intake-scope">{SCOPE_ITEMS.map((item) => <label key={item}><input type="checkbox" checked={extra.scope.includes(item)} onChange={() => toggleScope(item)} /> {item}</label>)}</div></fieldset>
    </div></section>}

    {step === 2 && <>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Documents from the bank</h3><p>Upload everything received. The sale deed fills the applicant and property details below; whatever it does not give, type in.</p></div><span className="intake-form-step">DOCUMENTS</span></div>
        <label className="intake-dropzone"><input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setReading(null) }} /><span className="intake-cloud">⇧</span><b>Drop the documents here or <em>browse</em></b><small>PDF, JPG or PNG · up to 25 MB per file</small></label>
        {files.length > 0 && <div className="intake-file-list">{files.map((file) => <div className="intake-file-row" key={fileKey(file)}><span className="intake-file-icon">{file.type.includes('pdf') ? 'PDF' : 'IMG'}</span><span className="intake-file-info"><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span>
          <select className={inputClass} aria-label={`Type of ${file.name}`} value={typeOf(file)} onChange={(e) => { setFileTypes({ ...fileTypes, [fileKey(file)]: e.target.value as DocumentType }); setReading(null) }}>{DOCUMENT_TYPES.map((value) => <option key={value} value={value}>{DOCUMENT_TYPE_LABELS[value]}</option>)}</select>
          <button aria-label={`Remove ${file.name}`} type="button" onClick={() => { setFiles(files.filter((candidate) => candidate !== file)); setReading(null) }}>×</button></div>)}
          <button type="button" className="intake-outline-button" disabled={readBusy || deedFiles.length === 0} onClick={() => void readDeed()}>{readBusy ? 'Reading the deed…' : deedFiles.length === 0 ? 'Mark a file as Sale deed to read it' : 'Read sale deed and fill details'}</button></div>}
        {reading && reading.files.map((file) => <p key={file.name} className={`intake-read-row is-${file.status.toLowerCase()}`}><b>{file.name}</b><span>{file.status === 'READ' ? 'Text read. Check the details below.' : file.note ?? 'Could not be read'}</span></p>)}
      </section>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Applicant</h3><p>The buyer named in the sale deed.</p></div><span className="intake-form-step">APPLICANT</span></div><div className="intake-fields-grid">
        <label>Applicant name * {tag('borrowerName')}<input className={inputClass} placeholder="Mr. Ramesh Kumar Gupta" value={form.borrowerName} onChange={(e) => setForm({ ...form, borrowerName: e.target.value })} /></label>
        <label>Father / husband name {tag('fatherName')}<input className={inputClass} value={extra.father} onChange={(e) => setE('father', e.target.value)} /></label>
        <label>Primary mobile<input className={inputClass} placeholder="+91-98110-XXXXX" value={extra.mobile} onChange={(e) => setE('mobile', e.target.value)} /></label>
        <label>Email address<input className={inputClass} type="email" value={extra.email} onChange={(e) => setE('email', e.target.value)} /></label>
      </div></section>
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Property &amp; GPS</h3><p>Where the property is. Everything the deed gives is filled in; type what it does not.</p></div><span className="intake-form-step">PROPERTY</span></div>
        <div className="intake-fields-grid">
          <label>Property type * {tag('propertyClass')}<select className={inputClass} value={property.propertyClass} onChange={(e) => setProperty({ ...property, propertyClass: e.target.value as PropertyClass })}>{PROPERTY_CLASSES.map((value) => <option key={value} value={value}>{PROPERTY_CLASS_LABELS[value]}</option>)}</select></label>
          <label>Approximate land area {tag('area')}<span className="intake-area"><input className={inputClass} type="number" min="0" step="0.01" value={extra.areaValue} onChange={(e) => setE('areaValue', e.target.value)} /><select className={inputClass} value={extra.areaUnit} onChange={(e) => setE('areaUnit', e.target.value as AreaUnit)}>{(Object.keys(AREA_UNITS) as AreaUnit[]).map((u) => <option key={u} value={u}>{u}</option>)}</select></span></label>
          <label className="intake-field-wide">Full structured property address * {tag('address')}<input className={inputClass} placeholder="House / plot number, street, locality, city" value={property.addressLine} onChange={(e) => setProperty({ ...property, addressLine: e.target.value })} /></label>
          <label>Khasra / plot no. {tag('khasra')}<input className={inputClass} placeholder="Comma separated" value={property.khasra} onChange={(e) => setProperty({ ...property, khasra: e.target.value })} /></label>
          <label>Colony / sector {tag('locality')}<input className={inputClass} value={property.locality} onChange={(e) => setProperty({ ...property, locality: e.target.value })} /></label>
          <label>District {tag('district')}<input className={inputClass} value={property.district} onChange={(e) => setProperty({ ...property, district: e.target.value })} /></label>
        </div>
        <div className="intake-gps"><div><b>GPS coordinates</b><small>{extra.lat && extra.lon ? `${extra.lat}, ${extra.lon}` : 'Not captured. Capture it from the property, or type it.'}</small></div>
          <input className={inputClass} placeholder="Latitude" value={extra.lat} onChange={(e) => setE('lat', e.target.value)} /><input className={inputClass} placeholder="Longitude" value={extra.lon} onChange={(e) => setE('lon', e.target.value)} /><button type="button" className="intake-outline-button" onClick={captureGps}>◎ Re-pin location</button></div>
      </section>
    </>}

    {step === 3 && <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Assign staff &amp; terms</h3><p>Who prepares the documents, who visits the site, and by when.</p></div><span className="intake-form-step">ASSIGN</span></div><div className="intake-fields-grid">
      <label>Assign drafter (document layer)<select className={inputClass} value={extra.drafterId} onChange={(e) => setE('drafterId', e.target.value)}><option value="">Decide later</option>{drafters.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></label>
      <label>Assign inspector (site layer)<select className={inputClass} value={extra.inspectorId} onChange={(e) => setE('inspectorId', e.target.value)}><option value="">Decide later</option>{inspectors.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.role.toLowerCase().replace('_', ' ')})</option>)}</select></label>
      <label>Due date *<input className={inputClass} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
      <label>Priority level<select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AssignmentPriority })}>{ASSIGNMENT_PRIORITIES.map((value) => <option key={value} value={value}>{SLA[value]}</option>)}</select></label>
      <label>Agreed fee (₹)<input className={inputClass} type="number" min="0" step="0.01" placeholder="Leave empty for the bank’s default fee" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></label>
      <label>Billing arrangement<select className={inputClass} value={extra.billing} onChange={(e) => setE('billing', e.target.value)}>{BILLING.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
      <label className="intake-field-wide">Special bank instructions / red flags<textarea className={inputClass} rows={3} placeholder="e.g. Verify road width carefully; boundary wall dispute flagged by the branch officer" value={extra.special} onChange={(e) => setE('special', e.target.value)} /></label>
    </div></section>}

    {step === 4 && <section className="intake-summary-card intake-confirm"><div className="intake-confirm-head"><span className="intake-summary-label">CASE INTAKE SUMMARY CARD</span><em>Ready for creation</em></div>
      <dl><div><dt>Client / applicant</dt><dd>{form.borrowerName || '—'}</dd></div><div><dt>Bank / branch</dt><dd>{bankName(form.bankId) ?? '—'}{branches.find((b) => b.id === form.branchId) ? ` (${branches.find((b) => b.id === form.branchId)?.name})` : ''}</dd></div>
        <div className="is-wide"><dt>Property</dt><dd>{property.addressLine || '—'}{areaSqm > 0 ? ` (${extra.areaValue} ${extra.areaUnit})` : ''}</dd></div>
        <div><dt>Assigned drafter</dt><dd>{extra.drafterId ? person(extra.drafterId) : 'Decide later'}</dd></div><div><dt>Assigned inspector</dt><dd>{extra.inspectorId ? person(extra.inspectorId) : 'Decide later'}</dd></div>
        <div><dt>Agreed fee</dt><dd>{form.fee ? `₹ ${formatInr(form.fee)}` : 'Bank default'}</dd></div><div><dt>Target due date</dt><dd>{dueText}</dd></div>
        <div><dt>Documents</dt><dd>{files.length}</dd></div></dl>
      <div className="intake-governance"><b>ValuerPro core governance rule</b><p>Creating this case sets up separate document and site evidence layers. Staff cannot overwrite each other’s field observations.</p></div>
    </section>}

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
