import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ASSIGNMENT_STATUS_LABELS, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, INTAKE_SOURCE_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS, documentChecklist, factLabel,
  type DocumentType, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import DocumentDrawer, { type DocFact } from '../components/DocumentDrawer.tsx'
import { ReadyCard, StepHeader, STEP_OF_STATUS, stepPath, type AssignmentHead, type Readiness } from '../components/WorkflowParts.tsx'
import { ErrorText, errorMessage } from '../components/ui.tsx'
import { api, fileBlobUrl, openFile, type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

type Assignment = AssignmentHead
interface Boundaries { north?: string; south?: string; east?: string; west?: string }
interface Property {
  id: string; code: string; propertyClass: PropertyClass; addressLine: string; unitDetail: string | null; locality: string | null; village: string | null; tehsil: string | null
  district: string | null; state: string | null; pinCode: string | null; latitude: string | null; longitude: string | null; khasraNumbers: string[]; boundaries: Boundaries | null
}
interface DocRow {
  id: string; type: DocumentType; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; assignmentId: string | null; source: IntakeSource
  ocrStatus: 'NOT_RUN' | 'DONE' | 'NO_TEXT' | 'FAILED'; facts: { total: number; unverified: number }
}
interface Suggestion { id: string; label: string; value: string; from: string; patch: Record<string, unknown> }

const CATEGORY: Record<DocumentType, string> = {
  BANK_INSTRUCTION: 'Bank instruction', SALE_DEED: 'Ownership / title', MAGISTRATE_CERTIFICATE: 'Ownership / title', REVENUE_RECORD: 'Revenue records', PATWARI_REPORT: 'Revenue records',
  SHAJRA_PLAN: 'Layout / location', APPROVED_PLAN: 'Layout / location', OCCUPATION_CERTIFICATE: 'Layout / location', TAX_RECEIPT: 'Utilities & tax', WATER_BILL: 'Utilities & tax', OTHER: 'Other',
}
const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export default function PropertyDocuments() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canReview = canEdit || user?.role === 'REVIEWER'
  const assignment = useFetch<Assignment>(`/assignments/${id}`)
  const a = assignment.data
  const property = useFetch<Property>(a ? `/properties/${a.property.id}` : null)
  const docs = useFetch<Paginated<DocRow>>(a ? `/documents?propertyId=${a.property.id}&pageSize=100` : null)
  const readiness = useFetch<Readiness>(`/assignments/${id}/readiness`)
  const [facts, setFacts] = useState<DocFact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [autoRead, setAutoRead] = useState(true)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [moving, setMoving] = useState(false)
  const [otherType, setOtherType] = useState<DocumentType>('OTHER')
  const advanced = useRef(false)
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'verified' | 'pending'>('all')
  const [view, setView] = useState<{ url: string; type: string } | null>(null)
  const [pageNo, setPageNo] = useState(1)
  const [factsTick, setFactsTick] = useState(0)
  const [editFact, setEditFact] = useState<{ id: string; value: string } | null>(null)

  const reloadAll = () => { assignment.reload(); property.reload(); docs.reload(); readiness.reload() }
  const documents = docs.data?.items
  const docKey = documents?.map((d) => `${d.id}:${d.facts.total}:${d.facts.unverified}`).join(',')

  // Entering this step moves a fresh assignment from intake to documents.
  useEffect(() => {
    if (!a || advanced.current || a.status !== 'INTAKE' || !canEdit) return
    advanced.current = true
    api.patch(`/assignments/${id}/status`, { status: 'DOCUMENTS' }).then(() => assignment.reload()).catch(() => { /* the page still works */ })
  }, [a, canEdit, id, assignment])

  // Facts from every document, so verified ones can suggest property details.
  useEffect(() => {
    if (!documents) return
    let cancelled = false
    Promise.all(documents.map((d) => api.get<DocFact[]>(`/documents/${d.id}/fields`))).then((all) => { if (!cancelled) setFacts(all.flat()) }).catch(() => { if (!cancelled) setFacts([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, factsTick])

  const selected = documents?.find((d) => d.id === sel) ?? documents?.[0] ?? null
  const selectedId = selected?.id
  const detail = useFetch<{ pageCount: number | null }>(selectedId ? `/documents/${selectedId}` : null)
  const pageCount = detail.data?.pageCount ?? null
  useEffect(() => { setPageNo(1); setEditFact(null) }, [selectedId])
  useEffect(() => {
    if (!selectedId) { setView(null); return }
    let url: string | null = null; let cancelled = false
    fileBlobUrl(`/documents/${selectedId}/file`).then((v) => { url = v.url; if (cancelled) URL.revokeObjectURL(v.url); else setView(v) }).catch(() => { if (!cancelled) setView(null) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [selectedId])

  const docName = (docId: string) => { const d = documents?.find((row) => row.id === docId); return d ? DOCUMENT_TYPE_LABELS[d.type] : 'a document' }
  const suggestions = useMemo<Suggestion[]>(() => {
    const p = property.data
    if (!p) return []
    const out: Suggestion[] = []
    for (const fact of facts) {
      if (fact.state !== 'VERIFIED' && fact.state !== 'CORRECTED') continue
      const value = (fact.verifiedValue ?? fact.extractedValue).trim()
      const from = docName(fact.documentId)
      if (fact.fieldKey === 'plot_number' && value !== (p.unitDetail ?? '')) out.push({ id: fact.id, label: 'Unit / plot', value, from, patch: { unitDetail: value } })
      if (fact.fieldKey === 'khasra_numbers') {
        const numbers = value.split(/[,;]/).map((n) => n.trim()).filter(Boolean)
        if (numbers.some((n) => !p.khasraNumbers.includes(n))) out.push({ id: fact.id, label: 'Khasra numbers', value: numbers.join(', '), from, patch: { khasraNumbers: [...new Set([...p.khasraNumbers, ...numbers])] } })
      }
      const side = /^boundary_(north|south|east|west)$/.exec(fact.fieldKey)?.[1] as keyof Boundaries | undefined
      if (side && value !== (p.boundaries?.[side] ?? '')) out.push({ id: fact.id, label: factLabel(fact.fieldKey), value, from, patch: { boundaries: { ...p.boundaries, [side]: value } } })
    }
    return out
  }, [facts, property.data, documents]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(files: File[], type: DocumentType) {
    if (!a || files.length === 0) return
    setError(null); setNotice(null)
    const problems: string[] = []; let stored = 0
    for (const file of files) {
      setUploading(file.name)
      try {
        const form = new FormData(); form.set('type', type); form.set('source', 'DASHBOARD'); form.set('assignmentId', a.id); form.set('file', file)
        const made = await api.upload<{ id: string }>(`/properties/${a.property.id}/documents`, form)
        stored += 1
        if (autoRead) await api.post(`/documents/${made.id}/ocr`, {}).catch(() => problems.push(`${file.name}: stored, but its text could not be read`))
      } catch (caught) { problems.push(`${file.name}: ${errorMessage(caught)}`) }
    }
    setUploading(null)
    if (stored) setNotice(`${stored} document${stored === 1 ? '' : 's'} added${autoRead ? ' and read' : ''}.`)
    if (problems.length) setError(problems.join('; '))
    reloadAll()
  }
  const drop = (event: DragEvent, type: DocumentType) => { event.preventDefault(); setDragOver(null); if (canEdit) void upload(Array.from(event.dataTransfer.files), type) }

  async function reclassify(doc: DocRow, type: DocumentType) {
    setError(null)
    try { await api.patch(`/documents/${doc.id}`, { type }); reloadAll() } catch (caught) { setError(errorMessage(caught)) }
  }

  async function reviewFact(factId: string, body: { outcome: 'VERIFIED' | 'UNKNOWN' | 'CORRECTED'; verifiedValue?: string }) {
    setError(null)
    try { await api.patch(`/document-fields/${factId}/review`, body); setEditFact(null); setFactsTick((n) => n + 1); reloadAll() } catch (caught) { setError(errorMessage(caught)) }
  }

  function startEdit() {
    const p = property.data
    if (!p) return
    setDraft({
      propertyClass: p.propertyClass, addressLine: p.addressLine, unitDetail: p.unitDetail ?? '', locality: p.locality ?? '', village: p.village ?? '', tehsil: p.tehsil ?? '', district: p.district ?? '', state: p.state ?? '', pinCode: p.pinCode ?? '',
      latitude: p.latitude ?? '', longitude: p.longitude ?? '', khasra: p.khasraNumbers.join(', '),
      north: p.boundaries?.north ?? '', south: p.boundaries?.south ?? '', east: p.boundaries?.east ?? '', west: p.boundaries?.west ?? '',
    })
    setEditing(true)
  }
  async function saveProperty(event: FormEvent) {
    event.preventDefault()
    if (!draft || !a) return
    setSaving(true); setError(null)
    const text = (key: string) => draft[key].trim()
    try {
      await api.patch(`/properties/${a.property.id}`, {
        propertyClass: draft.propertyClass, addressLine: text('addressLine'),
        ...(['unitDetail', 'locality', 'village', 'tehsil', 'district', 'state', 'pinCode'] as const).reduce((acc, key) => (text(key) ? { ...acc, [key]: text(key) } : acc), {}),
        ...(text('latitude') && { latitude: Number(text('latitude')) }), ...(text('longitude') && { longitude: Number(text('longitude')) }),
        khasraNumbers: text('khasra').split(/[,;]/).map((n) => n.trim()).filter(Boolean),
        boundaries: { north: text('north'), south: text('south'), east: text('east'), west: text('west') },
      })
      setEditing(false); setNotice('Property details saved.'); reloadAll()
    } catch (caught) { setError(errorMessage(caught)) } finally { setSaving(false) }
  }
  async function applySuggestions(chosen: Suggestion[]) {
    if (!a || chosen.length === 0) return
    setError(null)
    // Several suggestions can touch the same list or the same boundaries object, so merge them into one update.
    const patch = chosen.reduce<Record<string, unknown>>((all, s) => {
      const next = { ...all, ...s.patch }
      if (all.boundaries && s.patch.boundaries) next.boundaries = { ...(all.boundaries as Boundaries), ...(s.patch.boundaries as Boundaries) }
      if (all.khasraNumbers && s.patch.khasraNumbers) next.khasraNumbers = [...new Set([...(all.khasraNumbers as string[]), ...(s.patch.khasraNumbers as string[])])]
      return next
    }, {})
    try { await api.patch(`/properties/${a.property.id}`, patch); setNotice(chosen.length === 1 ? `${chosen[0].label} updated from the verified fact.` : `${chosen.length} details updated from verified facts.`); property.reload(); readiness.reload() } catch (caught) { setError(errorMessage(caught)) }
  }

  async function advance() {
    if (!a) return
    setMoving(true); setError(null)
    try { await api.patch(`/assignments/${a.id}/status`, { status: 'INSPECTION' }); navigate(stepPath(2, a.id)) }
    catch (caught) { setError(errorMessage(caught)); setMoving(false) }
  }

  const p = property.data
  const checklist = a ? documentChecklist(a.property.propertyClass) : []
  const haveCount = checklist.filter((e) => (documents ?? []).some((d) => d.type === e.type)).length
  const verifiedCount = checklist.filter((e) => { const h = (documents ?? []).filter((d) => d.type === e.type); return h.length > 0 && h.every((d) => d.facts.total > 0 && d.facts.unverified === 0) }).length
  const extras = (documents ?? []).filter((d) => !checklist.some((e) => e.type === d.type))
  const selectedFacts = selected ? facts.filter((f) => f.documentId === selected.id) : []
  const stepNow = a ? STEP_OF_STATUS[a.status] : 1
  const r = readiness.data
  const todo = r?.items.filter((i) => i.state === 'todo' && !i.blocking) ?? []
  const missing = p ? ([['locality', p.locality], ['district', p.district], ['state', p.state], ['pinCode', p.pinCode]] as const).filter(([, v]) => !v).length : 0
  const fieldRow = (label: string, value: string | null | undefined) => <div className="pd-kv"><dt>{label}</dt><dd className={value ? '' : 'is-empty'}>{value || 'Not recorded'}</dd></div>

  if (assignment.error) return <div className="pd-shell"><ErrorText message={assignment.error} /><Link to="/assignments" className="pd-back">← Assignment Inbox</Link></div>
  if (!a) return <div className="pd-shell"><p className="pd-muted">Loading assignment…</p></div>

  return <div className="pd-shell">
    <StepHeader a={a} here={1} eyebrow="STEP 2 · PROPERTY & DOCUMENTS" title="Property & Documents" subtitle="Confirm who and what is being valued, collect the papers, and verify what they say before the site visit." />

    {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
    <ErrorText message={error ?? property.error ?? docs.error ?? readiness.error} />

        <section className="vault-bar">
          <div className="vault-bar-title"><b>Documents &amp; extraction</b><span>{(documents ?? []).length} file{(documents ?? []).length === 1 ? '' : 's'} on this property</span></div>
          <div className="vault-bar-actions">
            {canEdit && <label className="pd-switch"><input type="checkbox" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} /><span /> Read text on upload</label>}
            {canEdit && <label className="pd-btn is-primary pd-upload"><input type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { void upload(Array.from(e.target.files ?? []), otherType); e.target.value = '' }} />⬆ Upload Documents</label>}
          </div>
        </section>
        {uploading && <p className="pd-uploading"><i /> Uploading {uploading}…</p>}
        <div className="vault-grid">
          <div className="vault-pane vault-list">
            <div className="vault-pane-head"><div><h3>Required Documents</h3><span>{haveCount} of {checklist.length} received</span></div><em>{checklist.length ? Math.round((haveCount / checklist.length) * 100) : 0}% Ready</em></div>
            <div className="vault-tabs">{([['all', `All (${checklist.length})`], ['verified', `Verified (${verifiedCount})`], ['pending', `Pending (${checklist.length - verifiedCount})`]] as const).map(([key, label]) => <button key={key} type="button" className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
            <div className="vault-items">{checklist.map((entry, index) => {
              const have = (documents ?? []).filter((d) => d.type === entry.type)
              const verified = have.length > 0 && have.every((d) => d.facts.total > 0 && d.facts.unverified === 0)
              if (tab === 'verified' && !verified) return null
              if (tab === 'pending' && verified) return null
              const doc = have[0]
              const icon = !have.length ? (entry.level === 'required' ? '❌' : '⏳') : verified ? '✅' : '⏳'
              const heading = CATEGORY[entry.type] !== (index > 0 ? CATEGORY[checklist[index - 1].type] : null) ? <span className="vault-cat">{CATEGORY[entry.type]}</span> : null
              return <Fragment key={entry.type}>{heading}<div className={`vault-item ${doc && doc.id === selected?.id ? 'is-active' : ''} ${dragOver === entry.type ? 'is-over' : ''}`} onClick={() => doc && setSel(doc.id)} onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(entry.type) } }} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop(e, entry.type)}>
                <span className="vault-icon">{icon}</span>
                <div className="vault-item-body"><b>{DOCUMENT_TYPE_LABELS[entry.type]}</b><small className={have.length ? '' : entry.level === 'required' ? 'is-red' : 'is-amber'}>{have.length ? `${have.length} file${have.length === 1 ? '' : 's'} · ${verified ? 'Verified' : doc.facts.unverified ? `${doc.facts.unverified} to review` : 'No facts read yet'}` : entry.level === 'required' ? 'Required · not uploaded' : 'Recommended · not uploaded'}</small></div>
                {canEdit && <label className="vault-add" onClick={(e) => e.stopPropagation()} title={have.length ? 'Add another file' : 'Upload'}><input type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { void upload(Array.from(e.target.files ?? []), entry.type); e.target.value = '' }} />＋</label>}
              </div></Fragment>
            })}
              {tab === 'all' && extras.length > 0 && <><span className="vault-cat">Other documents</span>{extras.map((d) => <div key={d.id} className={`vault-item ${d.id === selected?.id ? 'is-active' : ''}`} onClick={() => setSel(d.id)}><span className="vault-icon">{d.facts.unverified ? '⏳' : '✅'}</span><div className="vault-item-body"><b>{DOCUMENT_TYPE_LABELS[d.type]}</b><small title={d.fileName}>{d.fileName}</small></div></div>)}</>}
              {canEdit && tab === 'all' && <div className={`vault-item is-other ${dragOver === 'OTHER' ? 'is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver('OTHER') }} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop(e, otherType)}>
                <span className="vault-icon">＋</span><div className="vault-item-body"><b>Any other document</b><select value={otherType} onChange={(e) => setOtherType(e.target.value as DocumentType)} aria-label="Type for other documents">{DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{DOCUMENT_TYPE_LABELS[v]}</option>)}</select></div>
              </div>}
            </div>
          </div>

          <div className="vault-pane vault-viewer">
            {!selected ? <div className="pd-empty"><b>No documents yet</b><p>Upload the bank instruction and title papers to begin.</p></div> : <>
              <div className="vault-pane-head"><div><h3 title={selected.fileName}>{selected.fileName}</h3><span>{DOCUMENT_TYPE_LABELS[selected.type]} · {sizeLabel(selected.sizeBytes)} · {new Date(selected.uploadedAt).toLocaleDateString('en-IN')} · {INTAKE_SOURCE_LABELS[selected.source]}</span></div>
                <div className="vault-viewer-actions"><span className={`pd-pill ${selected.assignmentId === id ? 'is-mine' : 'is-earlier'}`}>{selected.assignmentId === id ? 'This assignment' : 'Earlier work'}</span><button type="button" className="pd-btn is-ghost" aria-label={`Open ${selected.fileName}`} onClick={() => void openFile(`/documents/${selected.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>↗ Open</button></div></div>
              {view && !view.type.startsWith('image/') && <div className="vault-pager"><button type="button" className="pd-btn is-ghost" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>‹ Prev</button><span>Page <input type="number" min={1} max={pageCount ?? undefined} value={pageNo} onChange={(e) => setPageNo(Math.max(1, Number(e.target.value) || 1))} aria-label="Page number" /> of {pageCount ?? '?'}</span><button type="button" className="pd-btn is-ghost" disabled={pageCount !== null && pageNo >= pageCount} onClick={() => setPageNo(pageNo + 1)}>Next ›</button></div>}
              <div className="vault-frame">{!view ? <p className="pd-muted">Loading file…</p> : view.type.startsWith('image/') ? <img src={view.url} alt={selected.fileName} /> : <iframe key={pageNo} src={`${view.url}#page=${pageNo}&toolbar=0`} title={selected.fileName} />}<span className="vault-watermark">VERIFIED COPY · FOR VALUATION ONLY</span></div>
              {canEdit && <div className="vault-retype"><label>Document type<select className="pd-type-select" value={selected.type} onChange={(e) => void reclassify(selected, e.target.value as DocumentType)} aria-label={`Type of ${selected.fileName}`}>{DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{DOCUMENT_TYPE_LABELS[v]}</option>)}</select></label></div>}
            </>}
          </div>

          <div className="vault-pane vault-facts">
            <div className="vault-pane-head"><div><h3>Extracted Fields</h3><span>{selected ? `${selectedFacts.length} read from this document` : 'Select a document'}</span></div>{selected && <span className={`pd-pill ${selected.facts.unverified ? 'is-warn' : selected.facts.total ? 'is-verified' : 'is-none'}`}>{selected.facts.unverified ? `${selected.facts.unverified} to review` : selected.facts.total ? 'Verified' : selected.ocrStatus === 'NO_TEXT' ? 'No text found' : selected.ocrStatus === 'FAILED' ? 'Read failed' : 'No facts yet'}</span>}</div>
            <div className="vault-fields">{selectedFacts.length === 0 ? <p className="pd-muted">{selected ? 'No facts have been read from this document yet.' : ''}</p> : selectedFacts.map((f) => <div key={f.id} className="vault-field">
              <div className="vault-field-main"><div><small>{factLabel(f.fieldKey)}{f.pageNumber ? <button type="button" className="vault-page-link" onClick={() => setPageNo(f.pageNumber)}> p.{f.pageNumber}</button> : null}</small>
                {editFact?.id === f.id ? <input className="vault-edit" autoFocus value={editFact.value} onChange={(e) => setEditFact({ id: f.id, value: e.target.value })} /> : <b>{(f.verifiedValue ?? f.extractedValue) || '—'}</b>}</div>
                <span className={`badge-${f.state === 'UNVERIFIED' ? 'verify' : f.state === 'UNKNOWN' ? 'missing' : 'matched'}`}>{f.state === 'UNVERIFIED' ? 'To review' : f.state === 'CORRECTED' ? 'Corrected' : f.state === 'UNKNOWN' ? 'Unknown' : 'Verified'}</span></div>
              {canReview && <div className="vault-field-actions">{editFact?.id === f.id
                ? <><button type="button" className="pd-btn is-primary" disabled={!editFact.value.trim()} onClick={() => void reviewFact(f.id, { outcome: 'CORRECTED', verifiedValue: editFact.value.trim() })}>Save</button><button type="button" className="pd-btn is-ghost" onClick={() => setEditFact(null)}>Cancel</button></>
                : <><button type="button" className="pd-btn is-ok" disabled={f.state === 'VERIFIED'} onClick={() => void reviewFact(f.id, { outcome: 'VERIFIED' })}>✓ Verify</button><button type="button" className="pd-btn is-ghost" onClick={() => setEditFact({ id: f.id, value: f.verifiedValue ?? f.extractedValue })}>✎ Correct</button><button type="button" className="pd-btn is-ghost" disabled={f.state === 'UNKNOWN'} onClick={() => void reviewFact(f.id, { outcome: 'UNKNOWN' })}>? Unknown</button></>}</div>}
            </div>)}</div>
            {selected && <button type="button" className="pd-btn is-primary is-block" onClick={() => setOpenDoc(selected.id)}>{canReview ? 'Add a field / re-read text' : 'View fields'}</button>}
          </div>
        </div>
    <div className="pd-grid">
      <div className="pd-main">
        <section className="pd-card" aria-labelledby="pd-prop-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">A</span><div><h2 id="pd-prop-h">Property identity</h2><p>{p?.code} · stays the same across every assignment on this property</p></div></div>{canEdit && !editing && p && <button type="button" className="pd-btn is-ghost" onClick={startEdit}>✎ Edit details</button>}</div>
          {missing > 0 && !editing && <p className="pd-flag">{missing} detail{missing === 1 ? '' : 's'} missing: complete them so the property can be found and reused later.</p>}
          {suggestions.length > 0 && !editing && <div className="pd-suggest"><div className="pd-suggest-head"><b>From verified documents</b>{canEdit && suggestions.length > 1 && <button type="button" className="pd-btn is-ok" onClick={() => void applySuggestions(suggestions)}>Apply all {suggestions.length}</button>}</div>{suggestions.map((s) => <div key={`${s.id}-${s.label}`}><span><em>{s.label}</em> {s.value}<small> · {s.from}</small></span>{canEdit && <button type="button" className="pd-btn is-ok" onClick={() => void applySuggestions([s])}>Apply</button>}</div>)}</div>}
          {!p ? <p className="pd-muted">Loading property…</p> : editing && draft ? <form onSubmit={saveProperty} className="pd-form">
            <label>Property type<select value={draft.propertyClass} onChange={(e) => setDraft({ ...draft, propertyClass: e.target.value })}>{PROPERTY_CLASSES.map((v) => <option key={v} value={v}>{PROPERTY_CLASS_LABELS[v]}</option>)}</select></label>
            <label className="is-wide">Address *<input required minLength={3} value={draft.addressLine} onChange={(e) => setDraft({ ...draft, addressLine: e.target.value })} /></label>
            <label>Unit / plot / floor<input value={draft.unitDetail} onChange={(e) => setDraft({ ...draft, unitDetail: e.target.value })} /></label>
            <label>Locality / sector<input value={draft.locality} onChange={(e) => setDraft({ ...draft, locality: e.target.value })} /></label>
            <label>Village<input value={draft.village} onChange={(e) => setDraft({ ...draft, village: e.target.value })} /></label>
            <label>Tehsil<input value={draft.tehsil} onChange={(e) => setDraft({ ...draft, tehsil: e.target.value })} /></label>
            <label>District / city<input value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} /></label>
            <label>State<input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} /></label>
            <label>PIN code<input pattern="\d{6}" placeholder="6 digits" value={draft.pinCode} onChange={(e) => setDraft({ ...draft, pinCode: e.target.value })} /></label>
            <label>Khasra numbers<input placeholder="Comma separated" value={draft.khasra} onChange={(e) => setDraft({ ...draft, khasra: e.target.value })} /></label>
            <label>Latitude<input type="number" step="any" min={-90} max={90} value={draft.latitude} onChange={(e) => setDraft({ ...draft, latitude: e.target.value })} /></label>
            <label>Longitude<input type="number" step="any" min={-180} max={180} value={draft.longitude} onChange={(e) => setDraft({ ...draft, longitude: e.target.value })} /></label>
            <fieldset className="is-wide"><legend>Boundaries (as per documents)</legend><div className="pd-compass">{(['north', 'south', 'east', 'west'] as const).map((side) => <label key={side}>{side[0].toUpperCase() + side.slice(1)}<input value={draft[side]} onChange={(e) => setDraft({ ...draft, [side]: e.target.value })} /></label>)}</div></fieldset>
            <div className="pd-form-actions is-wide"><button type="button" className="pd-btn is-ghost" onClick={() => setEditing(false)}>Cancel</button><button className="pd-btn is-primary" disabled={saving}>{saving ? 'Saving…' : 'Save property'}</button></div>
          </form> : <dl className="pd-kvs">
            {fieldRow('Type', PROPERTY_CLASS_LABELS[p.propertyClass])}{fieldRow('Address', p.addressLine)}{fieldRow('Unit / plot', p.unitDetail)}{fieldRow('Locality', p.locality)}{fieldRow('Village', p.village)}{fieldRow('Tehsil', p.tehsil)}
            {fieldRow('District', p.district)}{fieldRow('State', p.state)}{fieldRow('PIN code', p.pinCode)}{fieldRow('Khasra', p.khasraNumbers.join(', '))}{fieldRow('Coordinates', p.latitude && p.longitude ? `${p.latitude}, ${p.longitude}` : null)}
            <div className="pd-kv is-wide"><dt>Boundaries</dt><dd className={p.boundaries && Object.values(p.boundaries).some(Boolean) ? '' : 'is-empty'}>{p.boundaries && Object.values(p.boundaries).some(Boolean) ? <span className="pd-bounds">{(['north', 'south', 'east', 'west'] as const).map((s) => <span key={s}><em>{s[0].toUpperCase()}</em>{p.boundaries?.[s] || '—'}</span>)}</span> : 'Not recorded'}</dd></div>
          </dl>}
        </section>

      </div>

      <aside className="pd-aside"><ReadyCard title="Ready for inspection?" readiness={r} summary={r?.complete ? 'Everything is in order.' : r?.canProceed ? 'You can proceed, but some items are open.' : 'Documents are needed before the site visit.'}>
        {a.status === 'INSPECTION' || STEP_OF_STATUS[a.status] > 2 ? <div className="pd-moved"><b>Already in {ASSIGNMENT_STATUS_LABELS[a.status]}</b><Link to={stepPath(Math.min(stepNow, 5), a.id)} className="pd-btn is-primary">Open next step →</Link></div>
          : !canEdit ? <p className="pd-muted">Only a valuer or admin can move this assignment forward.</p>
          : confirming ? <div className="pd-confirm"><b>Continue with open items?</b><p>{todo.length ? `Still required: ${todo.map((i) => i.label).join(', ')}.` : 'Some recommended items are still open.'} You can add them later, but inspection will start without them.</p><div><button type="button" className="pd-btn is-ghost" onClick={() => setConfirming(false)}>Not yet</button><button type="button" className="pd-btn is-primary" disabled={moving} onClick={() => void advance()}>{moving ? 'Moving…' : 'Continue anyway'}</button></div></div>
          : <button type="button" className="pd-btn is-primary is-block" disabled={!r?.canProceed || moving} onClick={() => (r?.complete ? void advance() : setConfirming(true))}>{moving ? 'Moving…' : r?.complete ? 'Continue to Site Inspection →' : 'Continue to Site Inspection…'}</button>}
        <Link to={`/assignments/${a.id}`} className="pd-save-exit">Save &amp; exit to assignment</Link>
      </ReadyCard></aside>
    </div>
    {openDoc && <DocumentDrawer documentId={openDoc} canEdit={canEdit} canReview={canReview} onClose={() => setOpenDoc(null)} onChanged={reloadAll} />}
  </div>
}
