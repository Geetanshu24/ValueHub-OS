import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ASSIGNMENT_PRIORITIES, ASSIGNMENT_PRIORITY_LABELS, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, INTAKE_SOURCE_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS,
  type AssignmentPriority, type DocumentType, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import { ErrorText, errorMessage, formatInr, inputClass } from '../components/ui.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useFetch } from '../lib/useFetch.ts'

interface Bank { id: string; name: string; branches: { id: string; name: string; city: string | null; district: string | null; state: string | null }[] }
interface Staff { id: string; fullName: string; role: string }
interface Property { id: string; code: string; addressLine: string; propertyClass: PropertyClass; locality?: string | null; district?: string | null; state?: string | null }
interface Assignment { id: string; code: string; purpose: string; dueDate: string; status: string; bank: { name: string }; property: { code: string; addressLine: string } }
interface PreviousReport { id: string; reportNumber: string; createdAt: string; totalValue: string; assignment: { id: string; code: string; purpose: string; bank: { id: string; name: string }; property: Property } }
interface Guess<T = string> { value: T; confidence: number }
interface ExtractResult {
  files: { name: string; status: 'READ' | 'NO_TEXT' | 'FAILED'; note?: string }[]
  fields: { bankId?: Guess; purpose?: Guess; address?: Guess; propertyClass?: Guess<PropertyClass>; instructionDate?: Guess; borrowerName?: Guess }
}
interface Details { bankId: string; purpose: string; address: string; propertyClass: PropertyClass; instructionDate: string; borrowerName: string }
interface Reuse { assignmentId: string; reportNumber: string }
interface Filters { q: string; bankId: string; state: string; district: string; locality: string; propertyClass: '' | PropertyClass; years: string }

const DRAFT_KEY = 'valuehub-intake-draft'
const dateToday = new Date().toISOString().slice(0, 10)
const dueDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
const blankProperty = { propertyClass: 'HOUSE' as PropertyClass, addressLine: '', unitDetail: '', locality: '', district: '', state: '', pinCode: '' }
const blankDetails: Details = { bankId: '', purpose: '', address: '', propertyClass: 'HOUSE', instructionDate: dateToday, borrowerName: '' }
const blankFilters: Filters = { q: '', bankId: '', state: '', district: '', locality: '', propertyClass: '', years: '' }
const sourceOptions: { value: IntakeSource; note: string; icon: string }[] = [
  { value: 'WHATSAPP', note: 'Save attachment first', icon: '◉' },
  { value: 'EMAIL', note: 'Download attachments', icon: '✉' },
  { value: 'MOBILE_APP', note: 'Scan, then upload', icon: '▣' },
  { value: 'DASHBOARD', note: 'Upload from device', icon: '⇧' },
  { value: 'MANUAL', note: 'Type the details in', icon: '✎' },
]
const stages = [
  ['Instructions', 'Add the bank instruction'],
  ['Review details', 'Confirm what was read'],
  ['Existing work', 'Reuse earlier property work'],
  ['Assignment', 'Assign the valuation work'],
]

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
  const [source, setSource] = useState<IntakeSource>('DASHBOARD')
  const [files, setFiles] = useState<File[]>([])
  const [reading, setReading] = useState<ExtractResult | null>(null)
  const [details, setDetails] = useState<Details>(blankDetails)
  const [filters, setFilters] = useState<Filters>(blankFilters)
  const [reports, setReports] = useState<PreviousReport[]>([])
  const [matches, setMatches] = useState<Property[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<Property | null>(null)
  const [reuse, setReuse] = useState<Reuse | null>(null)
  const [previous, setPrevious] = useState<Assignment[]>([])
  const [property, setProperty] = useState(blankProperty)
  const [form, setForm] = useState({ bankId: '', branchId: '', assignedValuerId: '', assignedDrafterId: '', assignedInspectorId: '', clientPhone: '', purpose: '', scope: '', valuationDate: dateToday, instructionDate: dateToday, dueDate: dueDefault, priority: 'NORMAL' as AssignmentPriority, borrowerName: '', fee: '' })
  const [documentType, setDocumentType] = useState<DocumentType>('BANK_INSTRUCTION')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; code: string; uploaded: number; failed: string[] } | null>(null)
  const [draft, setDraft] = useState(readDraft)
  const branches = banks.data?.items.find((bank) => bank.id === form.bankId)?.branches ?? []
  const drafters = useMemo(() => staff.data?.filter((person) => person.role === 'DRAFTER') ?? [], [staff.data])
  const inspectors = useMemo(() => staff.data?.filter((person) => person.role === 'INSPECTOR' || person.role === 'VALUER') ?? [], [staff.data])
  const validStaff = useMemo(() => staff.data?.filter((person) => person.role === 'VALUER' || person.role === 'FIRM_ADMIN') ?? [], [staff.data])
  const bankName = (id: string) => banks.data?.items.find((bank) => bank.id === id)?.name

  // Step 1 -> 2: read the files (when there are any) and suggest the details.
  async function readInstruction() {
    setError(null); setReading(null)
    if (source === 'MANUAL' || files.length === 0) { setStep(2); return }
    setBusy(true)
    try {
      const data = new FormData()
      files.forEach((file) => data.append('files', file))
      const result = await api.upload<ExtractResult>('/intake/extract', data)
      setReading(result)
      const f = result.fields
      setDetails({
        ...blankDetails,
        bankId: f.bankId?.value ?? '', purpose: f.purpose?.value ?? '', address: f.address?.value ?? '',
        propertyClass: f.propertyClass?.value ?? 'HOUSE', instructionDate: f.instructionDate?.value ?? dateToday, borrowerName: f.borrowerName?.value ?? '',
      })
      setStep(2)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  // Step 2 -> 3: carry the confirmed details forward and look for earlier work.
  function confirmDetails() {
    setForm((current) => ({ ...current, bankId: details.bankId, branchId: '', purpose: details.purpose, instructionDate: details.instructionDate, borrowerName: details.borrowerName }))
    setProperty((current) => ({ ...current, addressLine: details.address, propertyClass: details.propertyClass }))
    const next = { ...blankFilters, locality: guessLocality(details.address), propertyClass: details.propertyClass }
    setFilters(next); setSelected(null); setReuse(null); setPrevious([])
    setStep(3); void search(next)
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

  async function chooseProperty(item: Property) {
    setSelected(item); setReuse(null); setError(null)
    try { setPrevious((await api.get<Paginated<Assignment>>('/assignments', { propertyId: item.id, pageSize: 20 })).items) }
    catch (caught) { setError(errorMessage(caught)) }
  }

  // "Use for New": the property and starting details come from the earlier
  // report; dates and the assignment itself are fresh, and the earlier report is untouched.
  function reuseReport(report: PreviousReport) {
    setSelected(report.assignment.property); setPrevious([])
    setReuse({ assignmentId: report.assignment.id, reportNumber: report.reportNumber })
    setForm((current) => ({ ...current, bankId: details.bankId || report.assignment.bank.id, branchId: '', purpose: details.purpose || report.assignment.purpose }))
    setStep(4)
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ source, details, form, property, selected, reuse, step: Math.max(step, 2), savedAt: new Date().toISOString() })); setDraft(readDraft()) } catch { setError('This browser cannot save drafts') }
  }
  function resumeDraft() {
    if (!draft) return
    const saved = draft as { source: IntakeSource; details: Details; form: typeof form; property: typeof property; selected: Property | null; reuse: Reuse | null; step: number }
    setSource(saved.source); setDetails(saved.details); setForm(saved.form); setProperty(saved.property); setSelected(saved.selected); setReuse(saved.reuse); setStep(saved.step); setDraft(null)
  }
  function discardDraft() { try { localStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ } setDraft(null) }

  async function create(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true)
    try {
      let propertyId = selected?.id
      if (!propertyId) {
        const made = await api.post<Property>('/properties', {
          propertyClass: property.propertyClass, addressLine: property.addressLine.trim(),
          ...(property.unitDetail && { unitDetail: property.unitDetail }), ...(property.locality && { locality: property.locality }),
          ...(property.district && { district: property.district }), ...(property.state && { state: property.state }), ...(property.pinCode && { pinCode: property.pinCode }),
        })
        propertyId = made.id
      }
      const assignment = await api.post<{ id: string; code: string }>('/assignments', {
        bankId: form.bankId, propertyId, assignedValuerId: form.assignedValuerId, purpose: form.purpose,
        valuationDate: form.valuationDate, dueDate: form.dueDate, intakeSource: source, priority: form.priority,
        ...(form.assignedDrafterId && { assignedDrafterId: form.assignedDrafterId }), ...(form.assignedInspectorId && { assignedInspectorId: form.assignedInspectorId }), ...(form.clientPhone.trim() && { clientPhone: form.clientPhone.trim() }),
        ...(form.instructionDate && { instructionDate: form.instructionDate }), ...(form.borrowerName.trim() && { borrowerName: form.borrowerName.trim() }),
        ...(reuse && { reusedFromId: reuse.assignmentId }),
        ...(form.branchId && { branchId: form.branchId }), ...(form.scope && { scope: form.scope }), ...(form.fee && { fee: Number(form.fee) }),
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
    <section className="intake-success"><span className="intake-success-tick">✓</span><h1>Assignment created successfully!</h1><p>Assignment ID</p><b className="intake-success-code">{created.code}</b>
      <dl><div><dt>Bank</dt><dd>{bankName(form.bankId) ?? '—'}</dd></div><div><dt>Source</dt><dd>{INTAKE_SOURCE_LABELS[source]}</dd></div><div><dt>Priority</dt><dd>{ASSIGNMENT_PRIORITY_LABELS[form.priority]}</dd></div><div><dt>Files attached</dt><dd>{created.uploaded}</dd></div></dl>
      {reuse && <p className="intake-success-note">Started from {reuse.reportNumber}. The earlier report is unchanged.</p>}
      {created.failed.length > 0 && <p role="alert" className="intake-success-warn">Some files did not upload: {created.failed.join('; ')}. Add them from the Document Desk.</p>}
      <div className="intake-success-actions"><Link to={`/assignments/${created.id}`} className="intake-outline-button">View assignment</Link><Link to={`/assignments/${created.id}/documents`} className="intake-primary">Go to next step: Property & Documents <span>→</span></Link></div>
      <Link to="/assignments/new" reloadDocument className="intake-view-link">Start another assignment</Link>
    </section></div>

  const guess = (key: keyof ExtractResult['fields']) => reading?.fields[key]
  const tag = (key: keyof ExtractResult['fields']) => reading ? <em className={`intake-confidence is-${confidenceLabel(guess(key)).replace(' ', '-').toLowerCase()}`}>{confidenceLabel(guess(key))}</em> : null

  return <div className="intake-shell">
    <div className="intake-topline"><Link to="/assignments" className="intake-back">← <span>Assignment Inbox</span></Link><span className="intake-save-note"><i /> Secure workspace</span></div>
    <header className="intake-heading">
      <div><p className="intake-eyebrow">VALUATION WORKFLOW <span>/</span> STEP 1 · ASSIGNMENT INTAKE</p><h1>Start a new assignment</h1><p>From any source to a new assignment, with reuse of previous work.</p></div>
      <div className="intake-heading-mark"><span>VH</span><div><b>Value Hub</b><small>Valuation Operating System</small></div></div>
    </header>
    <nav className="intake-stepper" aria-label="Assignment intake steps">{stages.map(([label, note], index) => <button key={label} type="button" onClick={() => index + 1 < step && setStep(index + 1)} className={`intake-step ${step === index + 1 ? 'is-current' : step > index + 1 ? 'is-done' : ''}`}><span className="intake-step-number">{step > index + 1 ? '✓' : `0${index + 1}`}</span><span className="intake-step-copy"><b>{label}</b><small>{note}</small></span></button>)}</nav>
    <ErrorText message={error ?? banks.error ?? staff.error} />
    {draft && step === 1 && <div className="intake-draft-banner"><span>You have a saved draft{typeof draft.savedAt === 'string' ? ` from ${new Date(draft.savedAt).toLocaleString('en-IN')}` : ''}. Files are not saved in a draft; add them again if needed.</span><button type="button" className="intake-outline-button" onClick={resumeDraft}>Resume draft</button><button type="button" className="intake-outline-button" onClick={discardDraft}>Discard</button></div>}

    {step === 1 && <>
      <div className="intake-section-title"><div><span className="intake-section-index">01</span><h2>Work arrives from any source</h2></div><span>Choose a source, then add its files</span></div>
      <div className="intake-main-grid">
        <section className="intake-panel intake-source-panel"><div className="intake-panel-heading"><div><h3>Choose an intake source</h3><p>The source is saved with the assignment and its files.</p></div><span className="intake-required-pill">REQUIRED</span></div>
          <div className="intake-source-grid">{sourceOptions.map((option) => <button key={option.value} type="button" onClick={() => setSource(option.value)} className={`intake-source-option ${source === option.value ? 'is-selected' : ''}`}><span className="intake-source-icon">{option.icon}</span><span><b>{INTAKE_SOURCE_LABELS[option.value]}</b><small>{option.note}</small></span><span className="intake-radio" /></button>)}</div>
          <div className="intake-integration-note"><span>i</span><p>WhatsApp and email are not connected yet. Download those attachments to your device and upload them here; the source you pick is recorded so your team knows how the work arrived.</p></div>
        </section>
        <section className="intake-panel intake-upload-panel"><div className="intake-panel-heading"><div><h3>{source === 'MANUAL' ? 'Attach files (optional)' : 'Upload and read documents'}</h3><p>Bank letter, photos and supporting documents are stored and read for you to confirm.</p></div><span className="intake-upload-glyph">↑</span></div>
          <label className="intake-dropzone"><input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><span className="intake-cloud">⇧</span><b>Drop files here or <em>browse</em></b><small>PDF, JPG or PNG · up to 25 MB per file</small><span className="intake-drop-hint">MULTIPLE FILES SUPPORTED</span></label>
          {files.length > 0 ? <div className="intake-file-list">{files.map((file) => <div className="intake-file-row" key={`${file.name}-${file.size}`}><span className="intake-file-icon">{file.type.includes('pdf') ? 'PDF' : 'IMG'}</span><span className="intake-file-info"><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB · Ready</small></span><button aria-label={`Remove ${file.name}`} type="button" onClick={() => setFiles(files.filter((candidate) => candidate !== file))}>×</button></div>)}<button type="button" className="intake-clear-files" onClick={() => setFiles([])}>Remove all files</button></div> : <div className="intake-empty-files"><span>↗</span><p>Your selected files will appear here.</p></div>}
        </section>
      </div>
      <footer className="intake-footer"><div><b>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} ready` : 'No files added yet'}</b><small>{source === 'MANUAL' || !files.length ? 'You will type the details in next.' : 'The files are read, not saved, until you create the assignment.'}</small></div><button type="button" className="intake-primary" disabled={busy} onClick={() => void readInstruction()}>{busy ? 'Reading documents…' : source === 'MANUAL' || !files.length ? 'Enter details' : 'Read documents'} <span>→</span></button></footer>
    </>}

    {step === 2 && <>
      <div className="intake-section-title"><div><span className="intake-section-index">02</span><h2>Extracted data for review</h2></div><span>Read from your files. Not verified until you confirm.</span></div>
      {reading && <section className="intake-panel intake-read-panel">{reading.files.map((file) => <p key={file.name} className={`intake-read-row is-${file.status.toLowerCase()}`}><b>{file.name}</b><span>{file.status === 'READ' ? 'Text read' : file.note ?? 'Could not be read'}</span></p>)}{Object.keys(reading.fields).length === 0 && <p className="intake-no-history">Nothing could be picked out of these files. Fill the details in below.</p>}</section>}
      <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>{reading ? 'Check and correct the details' : 'Enter the instruction details'}</h3><p>These carry into the property search and the assignment form.</p></div><span className="intake-form-step">DETAILS</span></div><div className="intake-fields-grid">
        <label>Bank {tag('bankId')}<select className={inputClass} value={details.bankId} onChange={(e) => setDetails({ ...details, bankId: e.target.value })}><option value="">Choose bank…</option>{banks.data?.items.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
        <label>Purpose {tag('purpose')}<input className={inputClass} placeholder="e.g. Loan Against Property (LAP)" value={details.purpose} onChange={(e) => setDetails({ ...details, purpose: e.target.value })} /></label>
        <label className="intake-field-wide">Property address {tag('address')}<input className={inputClass} placeholder="Plot / house number, locality, city" value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} /></label>
        <label>Property type {tag('propertyClass')}<select className={inputClass} value={details.propertyClass} onChange={(e) => setDetails({ ...details, propertyClass: e.target.value as PropertyClass })}>{PROPERTY_CLASSES.map((value) => <option key={value} value={value}>{PROPERTY_CLASS_LABELS[value]}</option>)}</select></label>
        <label>Instruction date {tag('instructionDate')}<input className={inputClass} type="date" value={details.instructionDate} onChange={(e) => setDetails({ ...details, instructionDate: e.target.value })} /></label>
        <label className="intake-field-wide">Borrower name {tag('borrowerName')}<input className={inputClass} value={details.borrowerName} onChange={(e) => setDetails({ ...details, borrowerName: e.target.value })} /></label>
      </div></section>
      <footer className="intake-footer"><button type="button" className="intake-back-button" onClick={() => setStep(1)}>← Back</button><button type="button" className="intake-primary" onClick={confirmDetails}>Confirm & continue <span>→</span></button></footer>
    </>}

    {step === 3 && <>
      <div className="intake-section-title"><div><span className="intake-section-index">03</span><h2>Check for existing work</h2></div><span>A property can have many assignments</span></div>
      <section className="intake-panel intake-search-panel"><form onSubmit={(event) => { event.preventDefault(); void search() }}>
        <div className="intake-search-form"><span>⌕</span><input placeholder="Search by address, locality, property ID or report no." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></div>
        <div className="intake-filters">
          <label>Bank<select className={inputClass} value={filters.bankId} onChange={(e) => setFilters({ ...filters, bankId: e.target.value })}><option value="">(Any)</option>{banks.data?.items.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
          <label>State<input className={inputClass} value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} /></label>
          <label>City / district<input className={inputClass} value={filters.district} onChange={(e) => setFilters({ ...filters, district: e.target.value })} /></label>
          <label>Locality / sector<input className={inputClass} value={filters.locality} onChange={(e) => setFilters({ ...filters, locality: e.target.value })} /></label>
          <label>Property type<select className={inputClass} value={filters.propertyClass} onChange={(e) => setFilters({ ...filters, propertyClass: e.target.value as Filters['propertyClass'] })}><option value="">(Any)</option>{PROPERTY_CLASSES.map((value) => <option key={value} value={value}>{PROPERTY_CLASS_LABELS[value]}</option>)}</select></label>
          <label>Date range<select className={inputClass} value={filters.years} onChange={(e) => setFilters({ ...filters, years: e.target.value })}><option value="">Any time</option><option value="1">Last year</option><option value="3">Last 3 years</option><option value="5">Last 5 years</option></select></label>
        </div>
        <button className="intake-primary intake-search-button" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form></section>

      {searched && (reports.length > 0 ? <section className="intake-panel intake-results-panel"><div className="intake-results-head"><div><h3>Matching reports found</h3><p>Previous reports for properties like this one. Reuse never changes the earlier report.</p></div><span className="intake-result-count">{reports.length} FOUND</span></div>
        <div className="intake-report-table" role="table"><div className="intake-report-row is-head" role="row"><span>Report no.</span><span>Address / property</span><span>Bank</span><span>Date</span><span>Value</span><span /></div>
          {reports.map((report) => <div className="intake-report-row" role="row" key={report.id}><b>{report.reportNumber}</b><span>{report.assignment.property.addressLine}<small>{report.assignment.property.code}</small></span><span>{report.assignment.bank.name}</span><span>{new Date(report.createdAt).toLocaleDateString('en-IN')}</span><span>₹ {formatInr(report.totalValue)}</span><span className="intake-report-actions"><Link className="intake-outline-button" to={`/assignments/${report.assignment.id}`} target="_blank">View ↗</Link><button type="button" className="intake-primary" onClick={() => reuseReport(report)}>Use for new</button></span></div>)}
        </div></section> : <section className="intake-empty-match"><span>⌕</span><div><b>No matching report</b><p>No approved or issued report matches these filters. {matches.length > 0 ? 'Pick a property below, or create' : 'You can create'} a new property record.</p></div></section>)}

      {searched && matches.length > 0 && <section className="intake-panel intake-results-panel"><div className="intake-results-head"><div><h3>Properties on record</h3><p>{matches.length} propert{matches.length === 1 ? 'y' : 'ies'} match. Choosing one reuses its identity only.</p></div></div><div className="intake-property-list">{matches.map((item) => <article key={item.id} className={`intake-property-row ${selected?.id === item.id ? 'is-selected' : ''}`}><span className="intake-property-avatar">⌂</span><div className="intake-property-main"><b>{item.addressLine}</b><small>{item.code} <span>·</span> {PROPERTY_CLASS_LABELS[item.propertyClass]}</small></div><div className="intake-property-location">{[item.locality, item.district, item.state].filter(Boolean).join(', ') || 'Location not recorded'}</div><button type="button" className={selected?.id === item.id ? 'intake-selected-button' : 'intake-outline-button'} onClick={() => void chooseProperty(item)}>{selected?.id === item.id ? '✓ Selected' : 'Use property'}</button></article>)}</div></section>}
      {selected && !reuse && previous.length > 0 && <section className="intake-panel intake-history-panel"><div className="intake-results-head"><div><h3>Earlier assignments for this property</h3><p>For reference. They are not copied.</p></div></div><div className="intake-history-list">{previous.map((item) => <article key={item.id} className="intake-history-row"><span className="intake-history-doc">▤</span><span className="intake-history-copy"><b>{item.code}</b><small>{item.bank.name} · {item.purpose}</small></span><span className="intake-status">{item.status.replaceAll('_', ' ')}</span><Link to={`/assignments/${item.id}`} target="_blank" className="intake-view-link">View ↗</Link></article>)}</div></section>}

      <section className="intake-new-property"><span className="intake-new-property-icon">＋</span><div><b>No matching report?</b><p>Create a new property record from the details you confirmed.</p></div><button type="button" className="intake-outline-button" onClick={() => { setSelected(null); setReuse(null); setStep(4) }}>Create new property <span>→</span></button></section>
      <footer className="intake-footer"><button type="button" className="intake-back-button" onClick={() => setStep(2)}>← Back to details</button>{selected && <button type="button" className="intake-primary" onClick={() => setStep(4)}>Continue with selected property <span>→</span></button>}</footer>
    </>}

    {step === 4 && <form onSubmit={create} className="intake-create-layout">
      <div className="intake-create-main">
        {reuse && <div className="intake-reuse-banner"><b>Starting from report {reuse.reportNumber}</b><span>The property is reused. Dates and details below are fresh, and the original report stays unchanged.</span><button type="button" className="intake-outline-button" onClick={() => setReuse(null)}>Don’t link</button></div>}
        {!selected && <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Create a property record</h3><p>Pre-filled from the instruction. Add what is missing.</p></div><span className="intake-form-step">PROPERTY</span></div><div className="intake-fields-grid">
          <label>Property type<select className={inputClass} value={property.propertyClass} onChange={(e) => setProperty({ ...property, propertyClass: e.target.value as PropertyClass })}>{PROPERTY_CLASSES.map((value) => <option key={value} value={value}>{PROPERTY_CLASS_LABELS[value]}</option>)}</select></label>
          <label className="intake-field-wide">Property address *<input className={inputClass} required minLength={3} value={property.addressLine} onChange={(e) => setProperty({ ...property, addressLine: e.target.value })} /></label>
          <label>Unit / plot / floor<input className={inputClass} placeholder="e.g. Plot 123" value={property.unitDetail} onChange={(e) => setProperty({ ...property, unitDetail: e.target.value })} /></label>
          <label>Locality / sector<input className={inputClass} value={property.locality} onChange={(e) => setProperty({ ...property, locality: e.target.value })} /></label>
          <label>District / city<input className={inputClass} value={property.district} onChange={(e) => setProperty({ ...property, district: e.target.value })} /></label>
          <label>State<input className={inputClass} value={property.state} onChange={(e) => setProperty({ ...property, state: e.target.value })} /></label>
          <label>PIN code<input className={inputClass} placeholder="6 digits" pattern="\d{6}" value={property.pinCode} onChange={(e) => setProperty({ ...property, pinCode: e.target.value })} /></label>
        </div></section>}
        <section className="intake-panel intake-form-panel"><div className="intake-panel-heading"><div><h3>Assignment details</h3><p>Bank, purpose, owner and dates for this valuation.</p></div><span className="intake-form-step">ASSIGNMENT</span></div><div className="intake-fields-grid">
          <label>Bank *<select className={inputClass} required value={form.bankId} onChange={(e) => setForm({ ...form, bankId: e.target.value, branchId: '' })}><option value="">Choose bank…</option>{banks.data?.items.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
          <label>Branch<select className={inputClass} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">Optional</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{[branch.name, branch.city, branch.district, branch.state].filter(Boolean).join(', ')}</option>)}</select></label>
          <label>Purpose *<input className={inputClass} required minLength={2} placeholder="e.g. Loan Against Property" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
          <label>Client name<input className={inputClass} value={form.borrowerName} onChange={(e) => setForm({ ...form, borrowerName: e.target.value })} /></label>
          <label>Client phone<input className={inputClass} type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} /></label>
          <label>Assigned valuer *<select className={inputClass} required value={form.assignedValuerId} onChange={(e) => setForm({ ...form, assignedValuerId: e.target.value })}><option value="">Choose valuer…</option>{validStaff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
          <label>Drafter<select className={inputClass} value={form.assignedDrafterId} onChange={(e) => setForm({ ...form, assignedDrafterId: e.target.value })}><option value="">Choose drafter…</option>{drafters.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
          <label>Site inspector<select className={inputClass} value={form.assignedInspectorId} onChange={(e) => setForm({ ...form, assignedInspectorId: e.target.value })}><option value="">Choose inspector…</option>{inspectors.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
          <label>Priority<select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AssignmentPriority })}>{ASSIGNMENT_PRIORITIES.map((value) => <option key={value} value={value}>{ASSIGNMENT_PRIORITY_LABELS[value]}</option>)}</select></label>
          <label>Instruction date<input className={inputClass} type="date" value={form.instructionDate} onChange={(e) => setForm({ ...form, instructionDate: e.target.value })} /></label>
          <label>Valuation date *<input className={inputClass} type="date" required value={form.valuationDate} onChange={(e) => setForm({ ...form, valuationDate: e.target.value })} /></label>
          <label>Due date *<input className={inputClass} type="date" required value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          <label>Professional fee (₹)<input className={inputClass} type="number" min="0" step="0.01" placeholder="Optional" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></label>
          <label className="intake-field-wide">Scope of work<input className={inputClass} placeholder="Optional" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} /></label>
        </div></section>
      </div>
      <aside className="intake-create-aside"><section className="intake-summary-card"><span className="intake-summary-label">ASSIGNMENT PREVIEW</span><div className="intake-summary-property"><span>⌂</span><div><b>{selected?.code ?? 'New property'}</b><small>{(selected?.addressLine ?? property.addressLine) || 'Property address'}</small></div></div><div className="intake-summary-rule"/><dl><div><dt>Source</dt><dd>{INTAKE_SOURCE_LABELS[source]}</dd></div><div><dt>Bank</dt><dd>{bankName(form.bankId) ?? 'Not selected'}</dd></div><div><dt>Purpose</dt><dd>{form.purpose || 'Not specified'}</dd></div><div><dt>Valuer</dt><dd>{validStaff.find((person) => person.id === form.assignedValuerId)?.fullName ?? 'Not assigned'}</dd></div><div><dt>Priority</dt><dd>{ASSIGNMENT_PRIORITY_LABELS[form.priority]}</dd></div><div><dt>Due date</dt><dd>{form.dueDate ? new Date(`${form.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'}</dd></div></dl><div className="intake-summary-docs"><span>▤</span><div><b>{files.length} instruction file{files.length === 1 ? '' : 's'}</b><small>Attached when you create the assignment</small></div></div></section><div className="intake-next-card"><b>What happens next?</b><p>The assignment gets its ID and your files are stored against it.</p><div><span>2</span> Property & Documents</div><div><span>3</span> Site Inspection</div><div><span>4</span> Valuation Workings</div></div></aside>
      {files.length > 0 && <section className="intake-panel intake-doc-type"><div><b>Classify instruction files</b><small>{files.length} file{files.length === 1 ? '' : 's'} will be stored once the assignment is created.</small></div><select className={inputClass} value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>{DOCUMENT_TYPES.map((value) => <option key={value} value={value}>{DOCUMENT_TYPE_LABELS[value]}</option>)}</select></section>}
      <footer className="intake-footer intake-create-footer"><button type="button" className="intake-back-button" onClick={() => setStep(3)}>← Back to existing work</button><span className="intake-footer-actions"><button type="button" className="intake-outline-button" onClick={saveDraft}>Save as draft</button><button type="submit" className="intake-primary" disabled={busy}>{busy ? 'Creating assignment…' : 'Create assignment'} <span>→</span></button></span></footer>
    </form>}
  </div>
}
