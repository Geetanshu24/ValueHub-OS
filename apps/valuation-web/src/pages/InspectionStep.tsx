import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AREA_FIELD_KEYS, AREA_TOLERANCE_PERCENT, ASSIGNMENT_STATUS_LABELS, DISCREPANCY_RESOLUTIONS, MEASUREMENT_LABELS, MEASUREMENT_METHODS, OBSERVATION_SECTIONS, PHOTO_CATEGORIES, factLabel,
  type DiscrepancyStatus, type InspectionStatus,
} from '@value-hub/valuation-shared'
import { ReadyCard, StageBanner, StepHeader, STEP_OF_STATUS, stepPath, type AssignmentHead, type Readiness } from '../components/WorkflowParts.tsx'
import { ErrorText, errorMessage } from '../components/ui.tsx'
import { api, fileBlobUrl } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Staff { id: string; fullName: string; role: string }
interface Measurement { id: string; label: string; fieldKey: string | null; areaSqm: string; method: string; note: string | null }
interface Photo { id: string; caption: string | null; category: string | null; captionConfirmed: boolean; takenAt: string | null }
interface Visit {
  id: string; visitedAt: string; status: InspectionStatus; latitude: string | null; longitude: string | null; observations: Record<string, string> | null
  inspector: { id: string; fullName: string }; measurements: Measurement[]; photos: Photo[]
}
interface Discrepancy { id: string; fieldKey: string; description: string; sourceA: string; sourceB: string; material: boolean; status: DiscrepancyStatus; resolutionNote: string | null }
interface Documented { fieldKey: string; value: number; state: string; source: string; documentType: string }
interface Context { documentedAreas: Documented[]; readiness: Readiness }

const AMENITIES = ['Electricity', 'Municipal water', 'Sewerage', 'Boundary wall', 'Covered parking', 'Lift / elevator', 'Power backup', 'Security guard', 'Common park', 'Overhead tank']
const FLOOR_LEVELS = ['Basement', 'Ground floor', 'First floor', 'Second floor', 'Third floor', 'Terrace / mumty']
interface FloorRow { level: string; use: string; length: string; width: string; condition: string; remarks: string }
const blankFloor: FloorRow = { level: 'Ground floor', use: 'Residential', length: '', width: '', condition: 'Good', remarks: '' }
const SQFT_PER_SQM = 10.7639104
const parseFloors = (text: string | undefined): FloorRow[] => { try { const v = JSON.parse(text ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const STAGES: [InspectionStatus, string][] = [['SCHEDULED', 'Scheduled'], ['IN_PROGRESS', 'On site'], ['SUBMITTED', 'Submitted'], ['REVIEWED', 'Field-reviewed']]
const UNITS = { sqm: { label: 'sq. m', perSqm: 1 }, sqft: { label: 'sq. ft', perSqm: 0.09290304 }, sqyd: { label: 'sq. yd', perSqm: 0.83612736 } } as const
type Unit = keyof typeof UNITS
const locked = (status: InspectionStatus) => status === 'SUBMITTED' || status === 'REVIEWED'
const fmt = (n: number) => String(Number(n.toFixed(2)))
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const toLocalInput = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

function PhotoThumb({ id, alt, onOpen }: { id: string; alt: string; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null; let cancelled = false
    fileBlobUrl(`/inspection-photos/${id}/file`).then((f) => { if (cancelled) URL.revokeObjectURL(f.url); else { url = f.url; setSrc(f.url) } }).catch(() => { /* tile shows its placeholder */ })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [id])
  return <button type="button" className="in-thumb" onClick={onOpen} aria-label={`Open photo: ${alt}`}>{src ? <img src={src} alt={alt} /> : <span>…</span>}</button>
}

function Lightbox({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null; let cancelled = false
    fileBlobUrl(`/inspection-photos/${photo.id}/file`).then((f) => { if (cancelled) URL.revokeObjectURL(f.url); else { url = f.url; setSrc(f.url) } }).catch(() => { /* closes on click */ })
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); window.removeEventListener('keydown', key) }
  }, [photo.id, onClose])
  return createPortal(<div className="in-lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><figure>{src ? <img src={src} alt={photo.caption ?? 'Site photo'} /> : <p>Loading…</p>}<figcaption><b>{photo.category ?? 'Photo'}</b> {photo.caption}</figcaption></figure><button type="button" className="pd-icon-btn" aria-label="Close" onClick={onClose}>×</button></div>, document.body)
}

export default function InspectionStep() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canPlan = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canField = canPlan || user?.role === 'INSPECTOR'
  const canReview = canPlan || user?.role === 'REVIEWER'
  const assignment = useFetch<AssignmentHead>(`/assignments/${id}`)
  const context = useFetch<Context>(`/assignments/${id}/inspection-context`)
  const visits = useFetch<Visit[]>(`/assignments/${id}/inspections`)
  const discrepancies = useFetch<Discrepancy[]>(`/assignments/${id}/discrepancies`)
  const staff = useFetch<Staff[]>(canPlan ? '/users/staff' : null)
  const a = assignment.data
  const [pick, setPick] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [plan, setPlan] = useState({ inspectorId: '', visitedAt: '' })
  const [moving, setMoving] = useState<{ inspectorId: string; visitedAt: string } | null>(null)
  const [obs, setObs] = useState<Record<string, string>>({})
  const [obsDirty, setObsDirty] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({ use: true })
  const [unit, setUnit] = useState<Unit>('sqm')
  const [m, setM] = useState({ label: 'Plot', fieldKey: 'plot_area_sqm', area: '', method: MEASUREMENT_METHODS[0] as string, note: '' })
  const [category, setCategory] = useState<string>(PHOTO_CATEGORIES[0])
  const [uploading, setUploading] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [lightbox, setLightbox] = useState<Photo | null>(null)
  const [resolving, setResolving] = useState<{ id: string; outcome: (typeof DISCREPANCY_RESOLUTIONS)[number]; note: string } | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const advanced = useRef(false)
  const [floor, setFloor] = useState<FloorRow>(blankFloor)
  const [certified, setCertified] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const list = visits.data ?? []
  const visit = list.find((v) => v.id === pick) ?? list.find((v) => !locked(v.status)) ?? list[0] ?? null
  const isLocked = visit ? locked(visit.status) : false
  const editable = !!visit && !isLocked && canField
  const reloadAll = () => { assignment.reload(); context.reload(); visits.reload(); discrepancies.reload() }

  // Arriving here with the documents in place moves the assignment on to inspection.
  useEffect(() => {
    if (!a || advanced.current || a.status !== 'DOCUMENTS' || !canPlan) return
    advanced.current = true
    api.patch(`/assignments/${id}/status`, { status: 'INSPECTION' }).then(() => assignment.reload()).catch(() => { /* documents may still be missing */ })
  }, [a, canPlan, id, assignment])

  useEffect(() => { setObs((visit?.observations as Record<string, string> | null) ?? {}); setObsDirty(false); setMoving(null); setConfirmSubmit(false) }, [visit?.id, visit?.observations]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<unknown>, ok?: string) {
    setError(null); setNotice(null); setBusy(true)
    try { await action(); if (ok) setNotice(ok); reloadAll() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const schedule = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const made = await api.post<{ id: string }>(`/assignments/${id}/inspections`, { inspectorId: plan.inspectorId, visitedAt: new Date(plan.visitedAt).toISOString() })
      setPick(made.id); setScheduling(false); setPlan({ inspectorId: '', visitedAt: '' })
    }, 'Visit scheduled.')
  }
  const reschedule = (event: FormEvent) => {
    event.preventDefault()
    if (!visit || !moving) return
    void run(async () => { await api.patch(`/inspections/${visit.id}`, { inspectorId: moving.inspectorId, visitedAt: new Date(moving.visitedAt).toISOString() }); setMoving(null) }, 'Visit updated.')
  }
  const saveObservations = () => visit && run(async () => {
    const cleaned = Object.fromEntries(Object.entries(obs).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]))
    await api.patch(`/inspections/${visit.id}`, { observations: cleaned }); setObsDirty(false)
  }, 'Observations saved.')
  const captureLocation = () => {
    if (!visit) return
    if (!navigator.geolocation) { setError('This browser cannot give a location.'); return }
    setBusy(true); setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(false); void run(() => api.patch(`/inspections/${visit.id}`, { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) }), `Location captured (accurate to about ${Math.round(pos.coords.accuracy)} m).`) },
      (failure) => { setBusy(false); setError(failure.code === failure.PERMISSION_DENIED ? 'Location access was blocked. Allow it for this site in the browser and try again.' : 'Could not get a location fix. Try again outdoors.') },
      { enableHighAccuracy: true, timeout: 20000 },
    )
  }

  const areaSqm = Number(m.area) > 0 ? Number(m.area) * UNITS[unit].perSqm : 0
  const refs = (key: string | null) => (key ? context.data?.documentedAreas.filter((d) => d.fieldKey === key) ?? [] : [])
  const compare = (key: string | null, sqm: number) => {
    const r = refs(key); if (!r.length || sqm <= 0) return null
    const nearest = r.reduce((best, d) => (Math.abs(d.value - sqm) < Math.abs(best.value - sqm) ? d : best))
    const pct = ((sqm - nearest.value) / nearest.value) * 100
    return { nearest, pct, within: Math.abs(pct) <= AREA_TOLERANCE_PERCENT }
  }
  const live = compare(m.fieldKey || null, areaSqm)
  const addMeasurement = (event: FormEvent) => {
    event.preventDefault()
    if (!visit || areaSqm <= 0) return
    void run(async () => {
      await api.post(`/inspections/${visit.id}/measurements`, { label: m.label.trim(), areaSqm: Number(areaSqm.toFixed(2)), method: m.method.trim(), ...(m.fieldKey && { fieldKey: m.fieldKey }), ...(m.note.trim() && { note: m.note.trim() }) })
      setM({ ...m, area: '', note: '' })
    })
  }

  async function uploadPhotos(files: File[]) {
    if (!visit || !editable) return
    setError(null); setNotice(null)
    const problems: string[] = []; let stored = 0
    for (const file of files) {
      setUploading(file.name)
      try {
        const form = new FormData(); form.set('file', file); form.set('category', category)
        if (file.lastModified) form.set('takenAt', new Date(file.lastModified).toISOString())
        await api.upload(`/inspections/${visit.id}/photos`, form); stored += 1
      } catch (caught) { problems.push(`${file.name}: ${errorMessage(caught)}`) }
    }
    setUploading(null)
    if (stored) setNotice(`${stored} photo${stored === 1 ? '' : 's'} added. Confirm each caption before submitting.`)
    if (problems.length) setError(problems.join('; '))
    reloadAll()
  }
  const drop = (event: DragEvent) => { event.preventDefault(); setOver(false); void uploadPhotos(Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'))) }
  const patchPhoto = (photo: Photo, body: Record<string, unknown>) => run(() => api.patch(`/inspection-photos/${photo.id}`, body))

  const submitVisit = () => visit && run(async () => {
    const result = await api.post<{ discrepanciesFlagged: number }>(`/inspections/${visit.id}/submit`, {})
    setConfirmSubmit(false)
    setNotice(result.discrepanciesFlagged > 0 ? `Visit submitted. ${result.discrepanciesFlagged} area difference${result.discrepanciesFlagged === 1 ? '' : 's'} flagged below for your decision.` : 'Visit submitted. No area differences found.')
  })
  const resolveNow = (event: FormEvent) => {
    event.preventDefault()
    if (!resolving) return
    void run(async () => { await api.patch(`/discrepancies/${resolving.id}/resolve`, { outcome: resolving.outcome, resolutionNote: resolving.note.trim() }); setResolving(null) }, 'Decision recorded.')
  }
  async function advance() {
    if (!a) return
    setBusy(true); setError(null)
    try { if (a.status === 'DOCUMENTS') await api.patch(`/assignments/${a.id}/status`, { status: 'INSPECTION' }); await api.patch(`/assignments/${a.id}/status`, { status: 'VALUATION' }); navigate(stepPath(3, a.id)) }
    catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }

  const r = context.data?.readiness ?? null
  const answered = useMemo(() => OBSERVATION_SECTIONS.reduce((n, s) => n + s.fields.filter((f) => (obs[f.key] ?? '').trim() !== '').length, 0), [obs])
  const totalFields = OBSERVATION_SECTIONS.reduce((n, s) => n + s.fields.length, 0)
  const unconfirmedCaptions = visit ? visit.photos.filter((p) => !p.captionConfirmed).length : 0
  const stageIndex = visit ? STAGES.findIndex(([s]) => s === visit.status) : -1
  const floors = parseFloors(obs.floors)
  const setFloors = (rows: FloorRow[]) => { setObs({ ...obs, floors: JSON.stringify(rows) }); setObsDirty(true) }
  const amenities = (obs.amenities ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const setAmenities = (list: string[]) => { setObs({ ...obs, amenities: list.join(', ') }); setObsDirty(true) }
  const totalCovered = floors.reduce((n, row) => n + Number(row.length) * Number(row.width), 0)
  const stepNow = a ? STEP_OF_STATUS[a.status] : 2
  const pending = (discrepancies.data ?? []).filter((d) => d.status === 'UNRESOLVED' || d.status === 'ESCALATED')

  if (assignment.error) return <div className="pd-shell"><ErrorText message={assignment.error} /><Link to="/assignments" className="pd-back">← Assignment Inbox</Link></div>
  if (!a) return <div className="pd-shell"><p className="pd-muted">Loading assignment…</p></div>

  return <div className="pd-shell">
    <StageBanner icon="⛑" title={`${visit?.inspector.fullName ?? a.assignedValuer.fullName} · Field Site Inspector`} tag={visit && locked(visit.status) ? 'Field Certified' : undefined} line={`Case Ref: ${a.code}${visit ? ` · Scheduled: ${when(visit.visitedAt)}` : ''}`} asideLabel="Inspection Progress" aside={visit ? (STAGES.find(([k]) => k === visit.status)?.[1] ?? visit.status) : 'Not scheduled'}>{editable && <button type="button" className="stage-sync" disabled={busy || !obsDirty} onClick={() => void saveObservations()} title="Saves the observations and floor details"><i className={online ? 'is-on' : ''} /> {online ? (obsDirty ? 'Sync now' : 'Live sync: all saved') : 'Offline: will sync when back'}</button>}</StageBanner>
    <StepHeader a={a} here={2} eyebrow="STEP 3 · SITE INSPECTION" title="Site Inspection" subtitle="Visit the property, measure it, photograph it and record what you see. Differences from the documents are flagged, never overwritten." />
    {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
    <div className="brief-card"><div className="brief-card-head"><b>Pre-filled case briefing (from documents, for reference only)</b><span>Strict rule: record ACTUAL site observations independently</span></div>
      <div className="brief-grid"><div><small>Property as per documents</small><b>{a.property.addressLine}</b></div>
        <div><small>Documented areas</small><b>{(context.data?.documentedAreas ?? []).length ? (context.data?.documentedAreas ?? []).map((d) => `${factLabel(d.fieldKey)}: ${fmt(d.value)} sq m`).join(' · ') : 'None verified yet'}</b></div>
        <div><small>Borrower</small><b>{a.borrowerName ?? 'Not recorded'}</b></div><div><small>Bank</small><b>{a.bank.name}</b></div></div></div>
    <ErrorText message={error ?? assignment.error ?? context.error ?? visits.error ?? discrepancies.error} />

    <div className="pd-grid">
      <div className="pd-main">
        <section className="pd-card" aria-labelledby="in-visits-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">⛑</span><div><h2 id="in-visits-h">Site visits</h2><p>Plan who goes and when. Each visit has its own measurements, photos and notes.</p></div></div>{canPlan && !scheduling && <button type="button" className="pd-btn is-primary" onClick={() => { setScheduling(true); setPlan({ inspectorId: a.assignedValuer ? staff.data?.find((s) => s.fullName === a.assignedValuer.fullName)?.id ?? '' : '', visitedAt: '' }) }}>＋ Schedule a visit</button>}</div>
          {scheduling && <form className="in-inline-form" onSubmit={schedule}>
            <label>Who will go<select required value={plan.inspectorId} onChange={(e) => setPlan({ ...plan, inspectorId: e.target.value })}><option value="">Choose…</option>{staff.data?.filter((s) => s.role === 'INSPECTOR' || s.role === 'VALUER').map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.role.toLowerCase()})</option>)}</select></label>
            <label>Date &amp; time<input type="datetime-local" required value={plan.visitedAt} onChange={(e) => setPlan({ ...plan, visitedAt: e.target.value })} /></label>
            <div><button type="button" className="pd-btn is-ghost" onClick={() => setScheduling(false)}>Cancel</button><button className="pd-btn is-primary" disabled={busy}>Schedule</button></div>
          </form>}
          {list.length === 0 ? <div className="pd-empty"><b>No visit scheduled yet</b><p>{canPlan ? 'Schedule the first site visit to begin.' : 'A valuer will schedule the visit.'}</p></div> : <div className="in-visits">{list.map((v) => <button key={v.id} type="button" className={`in-visit ${visit?.id === v.id ? 'is-on' : ''}`} onClick={() => setPick(v.id)}><b>{when(v.visitedAt)}</b><span>{v.inspector.fullName}</span><em className={`pd-pill is-${v.status.toLowerCase()}`}>{STAGES.find(([s]) => s === v.status)?.[1]}</em></button>)}</div>}
        </section>

        {visit && <>
          <section className="pd-card" aria-labelledby="in-visit-h">
            <div className="pd-card-head"><div><span className="pd-step-tag">A</span><div><h2 id="in-visit-h">Identification &amp; GPS arrival</h2><p>{visit.inspector.fullName} · {when(visit.visitedAt)}</p></div></div>
              {canPlan && !isLocked && !moving && <button type="button" className="pd-btn is-ghost" onClick={() => setMoving({ inspectorId: visit.inspector.id, visitedAt: toLocalInput(visit.visitedAt) })}>Reschedule</button>}</div>
            <ol className="in-timeline">{STAGES.map(([key, label], index) => <li key={key} className={index < stageIndex ? 'is-done' : index === stageIndex ? 'is-now' : ''}><span>{index < stageIndex ? '✓' : index + 1}</span>{label}</li>)}</ol>
            {moving && <form className="in-inline-form" onSubmit={reschedule}>
              <label>Who will go<select required value={moving.inspectorId} onChange={(e) => setMoving({ ...moving, inspectorId: e.target.value })}>{staff.data?.filter((s) => s.role === 'INSPECTOR' || s.role === 'VALUER').map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></label>
              <label>Date &amp; time<input type="datetime-local" required value={moving.visitedAt} onChange={(e) => setMoving({ ...moving, visitedAt: e.target.value })} /></label>
              <div><button type="button" className="pd-btn is-ghost" onClick={() => setMoving(null)}>Cancel</button><button className="pd-btn is-primary" disabled={busy}>Save</button></div>
            </form>}
            <div className="in-gps">
              <div><small>GPS geolocation lock</small><b>{visit.latitude && visit.longitude ? `${Number(visit.latitude).toFixed(4)}° N, ${Number(visit.longitude).toFixed(4)}° E` : 'Not captured'}</b></div>
              <div><small>Visit time</small><b>{when(visit.visitedAt)}</b></div>
              <div><small>Inspector</small><b>{visit.inspector.fullName}</b><span className={visit.latitude ? 'is-ok' : ''}>{visit.latitude ? '✅ Verified on site' : '⚠ Capture location on arrival'}</span></div>
            </div>
            <div className="in-location">
              <span className="in-pin">⌖</span>
              <div><b>{visit.latitude && visit.longitude ? `${visit.latitude}, ${visit.longitude}` : 'Location not captured'}</b><small>{visit.latitude && visit.longitude ? <a href={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}`} target="_blank" rel="noreferrer noopener">Open in maps ↗</a> : 'Capture it while you are standing at the property.'}</small></div>
              {editable && <button type="button" className="pd-btn" disabled={busy} onClick={captureLocation}>{visit.latitude ? 'Capture again' : '◎ Capture my location'}</button>}
            </div>
          </section>

          <section className="pd-card" aria-labelledby="in-photo-h">
            <div className="pd-card-head"><div><span className="pd-step-tag">A</span><div><h2 id="in-photo-h">Photographic evidence</h2><p>{visit.photos.length} photo{visit.photos.length === 1 ? '' : 's'}. Confirm each caption: it becomes part of the evidence.</p></div></div></div>
            {editable && <>
              <div className="in-chips" role="group" aria-label="Photo category">{PHOTO_CATEGORIES.map((c) => <button key={c} type="button" className={category === c ? 'is-on' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>
              <label className={`in-drop ${over ? 'is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}><input type="file" hidden multiple accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => { void uploadPhotos(Array.from(e.target.files ?? [])); e.target.value = '' }} /><span>▣</span><b>{uploading ? `Uploading ${uploading}…` : <>Take or drop photos as <em>{category}</em></>}</b><small>JPG, PNG or WebP · up to 10 MB each</small></label>
            </>}
            {visit.photos.length > 0 && <div className="in-photos">{visit.photos.map((p) => <article key={p.id} className={`in-photo ${p.captionConfirmed ? 'is-ok' : ''}`}>
              <PhotoThumb id={p.id} alt={p.caption ?? p.category ?? 'Site photo'} onOpen={() => setLightbox(p)} />
              <div className="in-photo-body">
                {editable ? <select aria-label="Category" value={p.category ?? ''} onChange={(e) => void patchPhoto(p, { category: e.target.value, captionConfirmed: false })}><option value="">No category</option>{PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select> : <span className="pd-pill is-type">{p.category ?? 'Photo'}</span>}
                {editable ? <input aria-label="Caption" defaultValue={p.caption ?? ''} placeholder="Describe what it shows" maxLength={300} onBlur={(e) => { if (e.target.value.trim() !== (p.caption ?? '')) void patchPhoto(p, { caption: e.target.value.trim(), captionConfirmed: false }) }} /> : <p>{p.caption ?? '(no caption)'}</p>}
                <div className="in-photo-actions">{editable ? <><button type="button" className={`pd-btn ${p.captionConfirmed ? 'is-ok' : 'is-primary'}`} disabled={busy || (!p.captionConfirmed && !(p.caption ?? '').trim())} title={!(p.caption ?? '').trim() ? 'Add a caption first' : undefined} onClick={() => void patchPhoto(p, { captionConfirmed: !p.captionConfirmed })}>{p.captionConfirmed ? '✓ Confirmed' : 'Confirm caption'}</button><button type="button" className="pd-btn is-ghost" aria-label="Remove photo" onClick={() => void run(() => api.delete(`/inspection-photos/${p.id}`))}>Remove</button></> : <span className={`pd-pill ${p.captionConfirmed ? 'is-verified' : 'is-warn'}`}>{p.captionConfirmed ? 'Confirmed' : 'Unconfirmed'}</span>}</div>
              </div></article>)}</div>}
          </section>
          <section className="pd-card" aria-labelledby="in-meas-h">
            <div className="pd-card-head"><div><span className="pd-step-tag">B</span><div><h2 id="in-meas-h">Boundaries, dimensions &amp; measurements</h2><p>Link a measurement to a documented area and any difference is flagged when you submit.</p></div></div></div>
            {(context.data?.documentedAreas.length ?? 0) > 0 && <div className="in-docref"><b>Areas the documents claim</b>{context.data?.documentedAreas.map((d, i) => <span key={i}><em>{factLabel(d.fieldKey)}</em> {fmt(d.value)} sq. m <small>{d.source} · {d.state === 'UNVERIFIED' ? 'not yet verified' : 'verified'}</small></span>)}</div>}
            {visit.measurements.length === 0 ? <div className="pd-empty"><b>Nothing measured yet</b><p>{editable ? 'Add the plot and each floor you measure below.' : 'No measurements were recorded.'}</p></div> : <div className="in-table-wrap"><table className="in-table"><thead><tr><th>Part</th><th>Compared with</th><th className="is-num">Measured</th><th className="is-num">Documented</th><th>Difference</th><th>Method</th><th /></tr></thead><tbody>
              {visit.measurements.map((row) => { const c = compare(row.fieldKey, Number(row.areaSqm)); return <tr key={row.id}><td><b>{row.label}</b>{row.note && <small>{row.note}</small>}</td><td>{row.fieldKey ? factLabel(row.fieldKey) : <span className="pd-muted">Not compared</span>}</td><td className="is-num">{fmt(Number(row.areaSqm))}</td><td className="is-num">{c ? fmt(c.nearest.value) : '—'}</td><td>{c ? <span className={`pd-pill ${c.within ? 'is-verified' : 'is-warn'}`}>{c.within ? 'Within tolerance' : `${c.pct > 0 ? '+' : ''}${c.pct.toFixed(1)}%`}</span> : '—'}</td><td>{row.method}</td><td>{editable && <button type="button" className="pd-btn is-ghost" aria-label={`Remove ${row.label}`} onClick={() => void run(() => api.delete(`/inspection-measurements/${row.id}`))}>Remove</button>}</td></tr> })}
            </tbody></table></div>}
            {editable && <form className="in-measure-form" onSubmit={addMeasurement}>
              <h4>Add a measurement</h4>
              <div className="in-measure-grid">
                <label>Part measured<input list="in-labels" required value={m.label} onChange={(e) => setM({ ...m, label: e.target.value })} /><datalist id="in-labels">{MEASUREMENT_LABELS.map((l) => <option key={l} value={l} />)}</datalist></label>
                <label>Compare with<select value={m.fieldKey} onChange={(e) => setM({ ...m, fieldKey: e.target.value })}><option value="">Not compared</option>{AREA_FIELD_KEYS.map((k) => <option key={k} value={k}>{factLabel(k)}</option>)}</select></label>
                <label>Area<span className="in-area"><input type="number" step="0.01" min="0.01" required placeholder="0" value={m.area} onChange={(e) => setM({ ...m, area: e.target.value })} /><select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}</select></span></label>
                <label>Method<input list="in-methods" required minLength={2} value={m.method} onChange={(e) => setM({ ...m, method: e.target.value })} /><datalist id="in-methods">{MEASUREMENT_METHODS.map((x) => <option key={x} value={x} />)}</datalist></label>
                <label className="is-wide">Note<input placeholder="Optional, e.g. excludes staircase" value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} /></label>
              </div>
              <div className="in-measure-foot"><p>{areaSqm > 0 ? <>= <b>{fmt(areaSqm)} sq. m</b>{live && <> · <span className={live.within ? 'is-ok' : 'is-bad'}>{live.within ? 'matches' : `${live.pct > 0 ? '+' : ''}${live.pct.toFixed(1)}% vs`} the documented {fmt(live.nearest.value)} sq. m</span></>}</> : 'Type the area in the unit you measured. It is stored in sq. m.'}</p><button className="pd-btn is-primary" disabled={busy || areaSqm <= 0}>Add measurement</button></div>
            </form>}
          </section>

          <section className="pd-card" aria-labelledby="in-obs-h">
            <div className="pd-card-head"><div><span className="pd-step-tag">C</span><div><h2 id="in-obs-h">Structure, services, locality &amp; remarks</h2><p>{answered} of {totalFields} answered. Only fill what you actually saw.</p></div></div>{editable && <button type="button" className={`pd-btn ${obsDirty ? 'is-primary' : 'is-ghost'}`} disabled={busy || !obsDirty} onClick={() => void saveObservations()}>{obsDirty ? 'Save observations' : 'Saved'}</button>}</div>
            <div className="in-acc">{OBSERVATION_SECTIONS.map((section) => {
              const filled = section.fields.filter((f) => (obs[f.key] ?? '').trim() !== '').length
              const isOpen = open[section.id] ?? false
              return <div key={section.id} className={`in-acc-item ${isOpen ? 'is-open' : ''}`}>
                <button type="button" className="in-acc-head" aria-expanded={isOpen} onClick={() => setOpen((current) => ({ ...current, [section.id]: !(current[section.id] ?? false) }))}><span><b>{section.title}</b><small>{section.hint}</small></span><em className={filled === section.fields.length ? 'is-full' : ''}>{filled}/{section.fields.length}</em><i aria-hidden>{isOpen ? '−' : '+'}</i></button>
                {isOpen && <div className="in-obs-grid">{section.fields.map((f) => <label key={f.key} className={f.type === 'textarea' ? 'is-wide' : ''}>{f.label}{f.unit ? ` (${f.unit})` : ''}
                  {f.type === 'select' ? <select disabled={!editable} value={obs[f.key] ?? ''} onChange={(e) => { setObs({ ...obs, [f.key]: e.target.value }); setObsDirty(true) }}><option value="">—</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : f.type === 'textarea' ? <textarea rows={3} disabled={!editable} value={obs[f.key] ?? ''} maxLength={1000} onChange={(e) => { setObs({ ...obs, [f.key]: e.target.value }); setObsDirty(true) }} />
                    : <input type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} disabled={!editable} value={obs[f.key] ?? ''} maxLength={200} onChange={(e) => { setObs({ ...obs, [f.key]: e.target.value }); setObsDirty(true) }} />}
                </label>)}</div>}
              </div>
            })}</div>
            <div className="in-floors">
              <div className="in-floors-head"><b>Floor-wise built-up details</b><small>Covered area = length × width in feet. Carpet is estimated at 85% of covered.</small></div>
              {floors.length > 0 && <div className="in-table-wrap"><table className="in-table"><thead><tr><th>Floor</th><th>Use</th><th className="is-num">L (ft)</th><th className="is-num">W (ft)</th><th className="is-num">Covered (sq ft)</th><th className="is-num">Carpet est.</th><th>Condition</th><th>Remarks</th><th /></tr></thead><tbody>
                {floors.map((row, i) => { const covered = Number(row.length) * Number(row.width); return <tr key={i}><td><b>{row.level}</b></td><td>{row.use}</td><td className="is-num">{row.length}</td><td className="is-num">{row.width}</td><td className="is-num">{fmt(covered)}</td><td className="is-num">{fmt(covered * 0.85)}</td><td>{row.condition}</td><td>{row.remarks}</td><td>{editable && <button type="button" className="pd-btn is-ghost" aria-label={`Remove ${row.level}`} onClick={() => setFloors(floors.filter((_, k) => k !== i))}>×</button>}</td></tr> })}
                <tr className="in-floors-total"><td colSpan={4}>Total built-up</td><td className="is-num">{fmt(totalCovered)} sq ft</td><td className="is-num">{fmt(totalCovered * 0.85)}</td><td colSpan={3}>{fmt(totalCovered / SQFT_PER_SQM)} sq m covered</td></tr></tbody></table></div>}
              {editable && <div className="in-floor-form">
                <select aria-label="Floor level" value={floor.level} onChange={(e) => setFloor({ ...floor, level: e.target.value })}>{FLOOR_LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                <select aria-label="Use" value={floor.use} onChange={(e) => setFloor({ ...floor, use: e.target.value })}>{['Residential', 'Commercial', 'Industrial', 'Vacant', 'Storage / parking'].map((u) => <option key={u}>{u}</option>)}</select>
                <input type="number" min="0" step="0.01" placeholder="Length ft" value={floor.length} onChange={(e) => setFloor({ ...floor, length: e.target.value })} />
                <input type="number" min="0" step="0.01" placeholder="Width ft" value={floor.width} onChange={(e) => setFloor({ ...floor, width: e.target.value })} />
                <select aria-label="Condition" value={floor.condition} onChange={(e) => setFloor({ ...floor, condition: e.target.value })}>{['Good', 'Average', 'Poor'].map((c) => <option key={c}>{c}</option>)}</select>
                <input placeholder="Remarks" value={floor.remarks} onChange={(e) => setFloor({ ...floor, remarks: e.target.value })} />
                <button type="button" className="pd-btn is-primary" disabled={!(Number(floor.length) > 0 && Number(floor.width) > 0)} onClick={() => { setFloors([...floors, floor]); setFloor({ ...blankFloor, level: FLOOR_LEVELS[Math.min(FLOOR_LEVELS.length - 1, floors.length + 1)] }) }}>＋ Add floor</button>
              </div>}
            </div>
            <div className="in-amenities"><b>Amenities and services seen</b><div>{AMENITIES.map((item) => <label key={item}><input type="checkbox" disabled={!editable} checked={amenities.includes(item)} onChange={() => setAmenities(amenities.includes(item) ? amenities.filter((x) => x !== item) : [...amenities, item])} /> {item}</label>)}</div></div>
          </section>

        </>}

        {visit && editable && <section className="pd-card in-sign" aria-labelledby="in-sign-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">✍</span><div><h2 id="in-sign-h">Field certification</h2><p>Signing locks this visit and flags any difference from the documents.</p></div></div></div>
          <label className="in-sign-check"><input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} /> I visited the property in person and recorded only what I actually saw and measured.</label>
          <button type="button" className="pd-btn is-primary" disabled={!certified || busy || visit.measurements.length === 0 || unconfirmedCaptions > 0 || obsDirty} onClick={() => void submitVisit()}>{obsDirty ? 'Save observations first' : visit.measurements.length === 0 ? 'Add a measurement first' : unconfirmedCaptions > 0 ? `Confirm ${unconfirmedCaptions} caption(s) first` : 'Sign & submit inspection'}</button>
        </section>}

        {(discrepancies.data?.length ?? 0) > 0 && <section className="pd-card" aria-labelledby="in-disc-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">D</span><div><h2 id="in-disc-h">Differences found</h2><p>Both values are kept. You decide whether a difference is resolved, disclosed in the report, or escalated.</p></div></div></div>
          <div className="in-disc">{discrepancies.data?.map((d) => <article key={d.id} className={`in-disc-item is-${d.status.toLowerCase()}`}>
            <div><b>{factLabel(d.fieldKey)}</b><p>{d.description}</p><small>{d.sourceA} ↔ {d.sourceB}</small>{d.resolutionNote && <blockquote>{d.resolutionNote}</blockquote>}</div>
            <span className={`pd-pill ${d.status === 'RESOLVED' || d.status === 'DISCLOSED' ? 'is-verified' : 'is-warn'}`}>{d.status.toLowerCase()}</span>
            {canReview && (d.status === 'UNRESOLVED' || d.status === 'ESCALATED') && <div className="in-disc-actions">{DISCREPANCY_RESOLUTIONS.map((o) => <button key={o} type="button" className="pd-btn is-ghost" onClick={() => setResolving({ id: d.id, outcome: o, note: '' })}>{o === 'RESOLVED' ? 'Resolve' : o === 'DISCLOSED' ? 'Disclose' : 'Escalate'}</button>)}</div>}
          </article>)}</div>
        </section>}
      </div>

      <aside className="pd-aside"><ReadyCard title={visit && !isLocked ? 'Ready to submit?' : 'Ready for valuation?'} readiness={r} summary={!r ? '' : r.canProceed ? (r.complete ? 'Everything is in order.' : 'You can proceed, but some items are open.') : 'Submit a visit to unlock valuation.'}>
        {visit && editable && (confirmSubmit
          ? <div className="pd-confirm"><b>Submit this visit?</b><p>It locks the measurements, photos and notes. Any area that differs from the documents is flagged for a decision.{r?.items.some((i) => i.state === 'warn') ? ' Some guidance items are still open.' : ''}</p><div><button type="button" className="pd-btn is-ghost" onClick={() => setConfirmSubmit(false)}>Not yet</button><button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void submitVisit()}>{busy ? 'Submitting…' : 'Submit visit'}</button></div></div>
          : <button type="button" className="pd-btn is-primary is-block" disabled={visit.measurements.length === 0 || unconfirmedCaptions > 0 || busy} onClick={() => setConfirmSubmit(true)}>{visit.measurements.length === 0 ? 'Add a measurement to submit' : unconfirmedCaptions > 0 ? `Confirm ${unconfirmedCaptions} caption${unconfirmedCaptions === 1 ? '' : 's'} to submit` : 'Submit inspection…'}</button>)}
        {visit?.status === 'SUBMITTED' && canReview && <button type="button" className="pd-btn is-block in-gap" disabled={busy} onClick={() => void run(() => api.post(`/inspections/${visit.id}/review`, {}), 'Marked field-reviewed.')}>Mark field-reviewed</button>}
        {a.status === 'INSPECTION' || a.status === 'DOCUMENTS' ? (canPlan ? <button type="button" className="pd-btn is-primary is-block in-gap" disabled={!r?.canProceed || busy} onClick={() => void advance()}>{r?.canProceed ? (pending.length ? `Continue to Valuation (${pending.length} difference${pending.length === 1 ? '' : 's'} open)` : 'Continue to Valuation →') : 'Continue to Valuation'}</button> : <p className="pd-muted in-gap">Only a valuer or admin can move this assignment forward.</p>)
          : stepNow > 2 ? <div className="pd-moved in-gap"><b>Already in {ASSIGNMENT_STATUS_LABELS[a.status]}</b><Link to={stepPath(Math.min(stepNow, 5), a.id)} className="pd-btn is-primary">Open next step →</Link></div> : null}
        <Link to={stepPath(1, a.id)} className="pd-save-exit">← Back to Property &amp; Documents</Link>
      </ReadyCard></aside>
    </div>

    {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />}
    {resolving && createPortal(<div className="pd-drawer-backdrop in-center" onMouseDown={(e) => { if (e.target === e.currentTarget) setResolving(null) }}><form className="in-modal" onSubmit={resolveNow}>
      <h3>{resolving.outcome === 'RESOLVED' ? 'Resolve this difference' : resolving.outcome === 'DISCLOSED' ? 'Disclose in the report' : 'Escalate for more evidence'}</h3>
      <p>{resolving.outcome === 'RESOLVED' ? 'State which value is right and why.' : resolving.outcome === 'DISCLOSED' ? 'The difference stays and will be disclosed. Say how.' : 'It keeps blocking quality review until further evidence is in.'} The original values are not changed.</p>
      <textarea autoFocus required minLength={10} rows={4} placeholder="Basis for this decision (at least 10 characters)" value={resolving.note} onChange={(e) => setResolving({ ...resolving, note: e.target.value })} />
      <div><button type="button" className="pd-btn is-ghost" onClick={() => setResolving(null)}>Cancel</button><button className="pd-btn is-primary" disabled={busy || resolving.note.trim().length < 10}>Record decision</button></div>
    </form></div>, document.body)}
  </div>
}
