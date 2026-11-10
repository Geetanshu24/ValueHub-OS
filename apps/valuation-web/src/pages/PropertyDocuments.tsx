import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, INTAKE_SOURCE_LABELS, PROPERTY_CLASSES, PROPERTY_CLASS_LABELS, documentChecklist, factLabel,
  type DocumentType, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import DocumentDrawer, { type DocFact } from '../components/DocumentDrawer.tsx'
import { StepHeader, type AssignmentHead, type Readiness } from '../components/WorkflowParts.tsx'
import { ErrorText, errorMessage } from '../components/ui.tsx'
import { api, openFile, type Paginated } from '../lib/api.ts'
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

const TYPE_GLYPH: Record<DocumentType, string> = { BANK_INSTRUCTION: '✉', SALE_DEED: '§', APPROVED_PLAN: '▦', REVENUE_RECORD: '☷', TAX_RECEIPT: '₹', OCCUPATION_CERTIFICATE: '✓', SHAJRA_PLAN: '▦', WATER_BILL: '≋', MAGISTRATE_CERTIFICATE: '§', PATWARI_REPORT: '☷', LAYOUT_PLAN: '▤', COMPLETION_CERTIFICATE: '✓', ELECTRICITY_BILL: '⚡', PROPERTY_TAX: '₹', REGISTRY_PAPERS: '§', OTHER: '▤' }
const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export default function PropertyDocuments() {
  const { id = '' } = useParams()
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
  const [filter, setFilter] = useState<'all' | 'mine' | 'review'>('all')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [otherType, setOtherType] = useState<DocumentType>('OTHER')
  const advanced = useRef(false)

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
  }, [docKey])

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

  const p = property.data
  const checklist = a ? documentChecklist(a.property.propertyClass) : []
  const list = (documents ?? []).filter((d) => filter === 'all' || (filter === 'mine' ? d.assignmentId === id : d.facts.unverified > 0))
  const missing = p ? ([['locality', p.locality], ['district', p.district], ['state', p.state], ['pinCode', p.pinCode]] as const).filter(([, v]) => !v).length : 0
  const fieldRow = (label: string, value: string | null | undefined) => <div className="pd-kv"><dt>{label}</dt><dd className={value ? '' : 'is-empty'}>{value || 'Not recorded'}</dd></div>

  if (assignment.error) return <div className="pd-shell"><ErrorText message={assignment.error} /><Link to="/assignments" className="pd-back">← Assignment Inbox</Link></div>
  if (!a) return <div className="pd-shell"><p className="pd-muted">Loading assignment…</p></div>

  return <div className="pd-shell">
    <StepHeader a={a} here={1} eyebrow="STEP 2 · PROPERTY & DOCUMENTS" title="Property & Documents" subtitle="Confirm who and what is being valued, collect the papers, and verify what they say before the site visit." />

    {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
    <ErrorText message={error ?? property.error ?? docs.error ?? readiness.error} />

    <div className="pd-grid is-single">
      <div className="pd-main">
        <section className="pd-card" aria-labelledby="pd-docs-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">B</span><div><h2 id="pd-docs-h">Document checklist</h2><p>Drop a file on a card or use Upload. Files stay with the property for future work.</p></div></div>{canEdit && <label className="pd-switch"><input type="checkbox" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} /><span /> Read text on upload</label>}</div>
          {uploading && <p className="pd-uploading"><i /> Uploading {uploading}…</p>}
          <div className="pd-checklist">{checklist.map((entry) => {
            const have = (documents ?? []).filter((d) => d.type === entry.type)
            const pending = have.reduce((n, d) => n + d.facts.unverified, 0)
            const read = have.reduce((n, d) => n + d.facts.total, 0)
            return <div key={entry.type} className={`pd-slot ${have.length ? 'is-have' : entry.level === 'required' ? 'is-need' : ''} ${dragOver === entry.type ? 'is-over' : ''}`} onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(entry.type) } }} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop(e, entry.type)}>
              <span className="pd-slot-glyph">{have.length ? '✓' : TYPE_GLYPH[entry.type]}</span>
              <div className="pd-slot-body"><b>{DOCUMENT_TYPE_LABELS[entry.type]}</b><span className={`pd-pill is-${entry.level}`}>{entry.level === 'required' ? 'Required' : 'Recommended'}</span><small>{entry.hint}</small>
                <small className="pd-slot-state">{have.length ? `${have.length} file${have.length === 1 ? '' : 's'}${pending ? ` · ${pending} to review` : read ? ' · reviewed' : ' · no facts read yet'}` : 'Not uploaded'}</small></div>
              {canEdit && <label className="pd-btn is-ghost pd-upload"><input type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { void upload(Array.from(e.target.files ?? []), entry.type); e.target.value = '' }} />{have.length ? 'Add more' : 'Upload'}</label>}
            </div>
          })}
            {canEdit && <div className={`pd-slot is-other ${dragOver === 'OTHER' ? 'is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver('OTHER') }} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop(e, otherType)}>
              <span className="pd-slot-glyph">＋</span><div className="pd-slot-body"><b>Any other document</b><small>Photos, letters, NOCs, anything that supports the valuation</small><select value={otherType} onChange={(e) => setOtherType(e.target.value as DocumentType)} aria-label="Type for other documents">{DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{DOCUMENT_TYPE_LABELS[v]}</option>)}</select></div>
              <label className="pd-btn is-ghost pd-upload"><input type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { void upload(Array.from(e.target.files ?? []), otherType); e.target.value = '' }} />Upload</label></div>}
          </div>
        </section>

        <details className="br-sec"><summary><b>Property details</b><span className="br-badge">{p ? [p.addressLine, p.district, p.state].filter(Boolean).join(', ') : '…'}</span></summary>
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
        </details>
        <details className="br-sec"><summary><b>Check what each document says</b><span className="br-badge">optional</span></summary>
        <section className="pd-card" aria-labelledby="pd-lib-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">C</span><div><h2 id="pd-lib-h">Verify documents</h2><p>Open a file to see it beside the facts read from it, then verify, correct or mark each one unknown.</p></div></div>
            <div className="pd-segment" role="group" aria-label="Filter documents">{([['all', 'All'], ['mine', 'This assignment'], ['review', 'To review']] as const).map(([key, label]) => <button key={key} type="button" className={filter === key ? 'is-on' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
          {list.length === 0 ? <div className="pd-empty"><b>{documents?.length ? 'Nothing matches this filter' : 'No documents yet'}</b><p>{documents?.length ? 'Try another filter.' : 'Upload the bank instruction and title papers above to begin.'}</p></div> : <div className="pd-doclist">{list.map((d) => <article key={d.id} className="pd-doc">
            <span className="pd-doc-glyph">{TYPE_GLYPH[d.type]}</span>
            <div className="pd-doc-main"><b title={d.fileName}>{d.fileName}</b><small>{sizeLabel(d.sizeBytes)} · {new Date(d.uploadedAt).toLocaleDateString('en-IN')} · {INTAKE_SOURCE_LABELS[d.source]}</small></div>
            <span className={`pd-pill ${d.assignmentId === id ? 'is-mine' : 'is-earlier'}`}>{d.assignmentId === id ? 'This assignment' : 'Earlier work'}</span>
            {canEdit ? <select className="pd-type-select" value={d.type} onChange={(e) => void reclassify(d, e.target.value as DocumentType)} aria-label={`Type of ${d.fileName}`}>{DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{DOCUMENT_TYPE_LABELS[v]}</option>)}</select> : <span className="pd-pill is-type">{DOCUMENT_TYPE_LABELS[d.type]}</span>}
            <span className={`pd-pill ${d.facts.unverified ? 'is-warn' : d.facts.total ? 'is-verified' : 'is-none'}`}>{d.facts.unverified ? `${d.facts.unverified} to review` : d.facts.total ? 'Verified' : d.ocrStatus === 'NO_TEXT' ? 'No text found' : d.ocrStatus === 'FAILED' ? 'Read failed' : 'No facts yet'}</span>
            <div className="pd-doc-actions"><button type="button" className="pd-btn is-primary" onClick={() => setOpenDoc(d.id)}>Review</button><button type="button" className="pd-btn is-ghost" aria-label={`Open ${d.fileName}`} onClick={() => void openFile(`/documents/${d.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>↗</button></div>
          </article>)}</div>}
        </section>
        </details>
      </div>

      <div className="pd-done"><Link to={`/assignments/${a.id}`} className="pd-btn is-primary">Done — back to the case →</Link></div>
    </div>
    {openDoc && <DocumentDrawer documentId={openDoc} canEdit={canEdit} canReview={canReview} onClose={() => setOpenDoc(null)} onChanged={reloadAll} />}
  </div>
}
