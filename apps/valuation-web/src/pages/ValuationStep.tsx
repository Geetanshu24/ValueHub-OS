import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ASSIGNMENT_STATUS_LABELS, PROPERTY_CLASS_LABELS, type PropertyClass } from '@value-hub/valuation-shared'
import { ReadyCard, StageBanner, StepHeader, STEP_OF_STATUS, stepPath, type AssignmentHead, type Readiness } from '../components/WorkflowParts.tsx'
import { ErrorText, errorMessage, formatInr } from '../components/ui.tsx'
import { api, ApiError } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { rupeesInWords } from '../lib/inr.ts'
import { useFetch } from '../lib/useFetch.ts'
import {
  AREA_BASES, TREATMENTS, USES, emptyAdjustment, emptyComponent, emptyExtra, emptyFloor, emptyPlant, emptyState, fromInputs, toPayload,
  type Basis, type FormState, type RatedForm,
} from '../lib/valuationForm.ts'

interface Line { component: string; quantity: string | number; unit: string; rate: string | number; amount: string | number; treatment: string; sourceNote?: string | null }
interface Version { id: string; versionNumber: number; status: string; totalValue: string; method: string; engineVersion: string; adoptedAreaSqm: string; changeReason: string | null; createdAt: string; inputs: unknown; lineItems: Line[] }
interface Candidate { kind: 'MEASURED' | 'DOCUMENTED'; label: string; fieldKey: string | null; factLabel: string | null; areaSqm: number; source: string; withinTolerance: boolean | null }
interface Context {
  status: string; propertyClass: PropertyClass
  site: { visitedAt: string; status: string; inspector: string; observations: Record<string, string> | null } | null
  candidates: Candidate[]; openMaterialDiscrepancies: number
  disclosed: { fieldKey: string; status: string; description: string; resolutionNote: string | null }[]
  readiness: Readiness
}
interface Comparable { id: string; location: string; source: string; isTransaction: boolean; observedOn: string; areaBasis: string; ratePerSqm: string; verified: boolean }
interface CompSummary { areaBasis: string; count: number; min: number; max: number; median: number }
interface Calc { result: { totalValue: number; adoptedAreaSqm: number; method: string; lines: Line[]; requiresReview: string[] }; warnings: string[] }

const BASIS_LABEL: Record<string, string> = { CARPET: 'Carpet', BUILT_UP: 'Built-up', SUPER_BUILT_UP: 'Super built-up', LAND: 'Land' }
const TREATMENT_LABEL: Record<string, string> = { SEPARATELY_VALUED: 'Counted', INCLUDED_IN_BASE_RATE: 'In base rate', NOT_APPLICABLE: 'Not applicable', REQUIRES_REVIEW: 'Needs review' }
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', IN_REVIEW: 'With reviewer', APPROVED: 'Approved', SUPERSEDED: 'Superseded' }
const fmt = (n: number) => String(Number(n.toFixed(2)))
const upd = <T,>(list: T[], index: number, patch: Partial<T>): T[] => list.map((item, i) => (i === index ? { ...item, ...patch } : item))
const dropAt = <T,>(list: T[], index: number): T[] => list.filter((_, i) => i !== index)
const SKIP_ADJ = ['Location', 'Corner plot', 'Road facing', 'Age / condition', 'Floor premium', 'Legal / title risk']

function F({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) { return <label className={`va-f ${wide ? 'is-wide' : ''}`}>{label}{children}</label> }

function RateHint({ stats, basis, onUse }: { stats: CompSummary[]; basis: string; onUse: (rate: string, source: string) => void }) {
  const st = stats.find((x) => x.areaBasis === basis)
  if (!st) return <small className="va-hint">No verified {BASIS_LABEL[basis]?.toLowerCase()} comparables yet.</small>
  return <small className="va-hint">Market: median <b>₹{formatInr(st.median)}</b> (₹{formatInr(st.min)} to ₹{formatInr(st.max)}, {st.count} verified). <button type="button" onClick={() => onUse(fmt(st.median), `Median of ${st.count} verified ${BASIS_LABEL[basis].toLowerCase()} comparables`)}>Use median</button></small>
}

function Rated({ title, value, onChange, basis, stats }: { title: string; value: RatedForm; onChange: (v: RatedForm) => void; basis: string; stats: CompSummary[] }) {
  return <div className="va-block"><h4>{title}</h4><div className="va-grid">
    <F label="Area (sq. m)"><input type="number" step="0.01" min="0" value={value.area} onChange={(e) => onChange({ ...value, area: e.target.value })} /></F>
    <F label="Rate (₹ per sq. m)"><input type="number" step="0.01" min="0" value={value.rate} onChange={(e) => onChange({ ...value, rate: e.target.value })} /></F>
    <F label="Rate based on" wide><input placeholder="Comparable, circle rate or other evidence" value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value })} /></F>
  </div><RateHint stats={stats} basis={basis} onUse={(rate, source) => onChange({ ...value, rate, source: value.source || source })} /></div>
}

function BasisSel({ v, onChange, label }: { v: Basis; onChange: (b: Basis) => void; label: string }) {
  return <F label={label}><select value={v} onChange={(e) => onChange(e.target.value as Basis)}>{AREA_BASES.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</select></F>
}

export default function ValuationStep() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canDraft = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canApprove = canDraft || user?.role === 'REVIEWER'
  const assignment = useFetch<AssignmentHead>(`/assignments/${id}`)
  const context = useFetch<Context>(`/assignments/${id}/valuation-context`)
  const versions = useFetch<Version[]>(`/assignments/${id}/valuations`)
  const comparables = useFetch<Comparable[]>(`/assignments/${id}/comparables`)
  const summary = useFetch<CompSummary[]>(`/assignments/${id}/comparables/summary`)
  const a = assignment.data
  const cls = a?.property.propertyClass
  const [s, setS] = useState<FormState>(emptyState)
  const [calc, setCalc] = useState<Calc | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [calcBusy, setCalcBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openVersion, setOpenVersion] = useState<string | null>(null)
  const [evidence, setEvidence] = useState({ location: '', source: '', isTransaction: true, observedOn: new Date().toISOString().slice(0, 10), areaBasis: 'LAND', ratePerSqm: '' })
  const [addingEvidence, setAddingEvidence] = useState(false)
  const [showWorkings, setShowWorkings] = useState(true)
  const advanced = useRef(false)
  const loaded = useRef(false)

  const ctx = context.data
  const list = versions.data ?? []
  const latest = list.find((v) => v.status !== 'SUPERSEDED') ?? null
  const draftable = !!ctx && (ctx.status === 'VALUATION' || ctx.status === 'REVISION')
  const editable = canDraft && draftable
  const reloadAll = () => { assignment.reload(); context.reload(); versions.reload(); comparables.reload(); summary.reload() }

  // Arriving from a finished inspection moves the assignment into valuation.
  useEffect(() => {
    if (!a || advanced.current || a.status !== 'INSPECTION' || !canDraft) return
    advanced.current = true
    api.patch(`/assignments/${id}/status`, { status: 'VALUATION' }).then(() => { assignment.reload(); context.reload() }).catch(() => { /* the inspection may still be open */ })
  }, [a, canDraft, id, assignment, context])

  // Continue from the newest saved version rather than an empty form.
  useEffect(() => {
    if (loaded.current || !versions.data) return
    loaded.current = true
    if (latest) setS(fromInputs(latest.inputs))
  }, [versions.data, latest])

  // Live workings: recalculated shortly after each change, so what is missing is always visible.
  const payload = useMemo(() => (cls ? toPayload(cls, s) : null), [cls, s])
  useEffect(() => {
    if (!payload || !editable) return
    const timer = setTimeout(async () => {
      setCalcBusy(true)
      try { setCalc(await api.post<Calc>(`/assignments/${id}/valuations/preview`, payload)); setProblems([]) }
      catch (caught) { setCalc(null); setProblems(caught instanceof ApiError && caught.problems.length ? caught.problems : [errorMessage(caught)]) }
      finally { setCalcBusy(false) }
    }, 700)
    return () => clearTimeout(timer)
  }, [payload, editable, id])

  async function run(action: () => Promise<unknown>, ok?: string) {
    setError(null); setNotice(null); setBusy(true)
    try { await action(); if (ok) setNotice(ok); reloadAll() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  const saveDraft = () => run(async () => {
    if (!payload) return
    await api.post(`/assignments/${id}/valuations`, { ...payload, ...(list.length > 0 && { changeReason: s.changeReason }) })
    setS({ ...s, changeReason: '' })
  }, 'Draft saved as a new version.')
  const move = (versionId: string, action: 'submit-for-review' | 'approve') => run(() => api.post(`/valuations/${versionId}/${action}`, {}), action === 'approve' ? 'Valuation approved.' : 'Sent for review.')
  const addEvidence = () => run(async () => {
    await api.post(`/assignments/${id}/comparables`, { ...evidence, ratePerSqm: Number(evidence.ratePerSqm) })
    setEvidence({ ...evidence, location: '', source: '', ratePerSqm: '' }); setAddingEvidence(false)
  }, 'Comparable added. Someone else must verify it before it can be cited.')
  const verify = (compId: string, verified: boolean) => run(async () => { await api.patch(`/comparables/${compId}/verify`, { verified }); if (!verified) setS((cur) => ({ ...cur, cited: cur.cited.filter((x) => x !== compId) })) })
  async function advance() {
    setBusy(true); setError(null)
    try { await api.patch(`/assignments/${id}/status`, { status: 'QUALITY_REVIEW' }); navigate(stepPath(4, id)) } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }

  const age = ctx?.site?.observations?.age_years ?? ''
  const addSource = (text: string) => setS((cur) => ({ ...cur, areaSource: cur.areaSource.includes(text) ? cur.areaSource : cur.areaSource ? `${cur.areaSource}; ${text}` : text }))
  function useCandidate(c: Candidate) {
    const text = `${c.kind === 'MEASURED' ? 'Measured on site' : 'Per documents'}: ${c.label} ${fmt(c.areaSqm)} sq. m (${c.source})${c.withinTolerance ? '; agrees with the documents' : ''}`
    setS((cur) => {
      const next = { ...cur }
      const isPlot = c.fieldKey === 'plot_area_sqm' || /plot|land/i.test(c.label)
      if (cls === 'FLAT' || cls === 'COMMERCIAL') next.unit = { ...cur.unit, area: fmt(c.areaSqm) }
      else if (cls === 'LAND' || isPlot) next.land = { ...cur.land, area: fmt(c.areaSqm) }
      else if (cls === 'HOUSE' || cls === 'INDUSTRIAL') next.floors = [...cur.floors, { ...emptyFloor, label: c.label, area: fmt(c.areaSqm), age: age }]
      else if (cls === 'MIXED_USE') next.components = [...cur.components, { ...emptyComponent, label: c.label, area: fmt(c.areaSqm) }]
      return next
    })
    addSource(text)
  }

  const stats = summary.data ?? []
  const formatInfo = useFetch<{ format: string; formats: { id: string; label: string }[] }>(`/assignments/${id}/bank-report`)
  const [reportFormat, setReportFormat] = useState('')
  const aiStatus = useFetch<{ enabled: boolean }>('/ai/status')
  const [aiText, setAiText] = useState<{ assumptions: string; needsInput: string[] } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  async function suggestAssumptions() {
    setAiBusy(true); setAiError(null)
    try { setAiText(await api.post<{ assumptions: string; needsInput: string[] }>(`/assignments/${id}/assumptions/ai`, {})) } catch (caught) { setAiError(errorMessage(caught)) } finally { setAiBusy(false) }
  }
  const pickedFormat = reportFormat || formatInfo.data?.format || ''

  if (assignment.error) return <div className="pd-shell"><ErrorText message={assignment.error} /><Link to="/assignments" className="pd-back">← Assignment Inbox</Link></div>
  if (!a || !cls) return <div className="pd-shell"><p className="pd-muted">Loading assignment…</p></div>
  const stepNow = STEP_OF_STATUS[a.status]
  const r = ctx?.readiness ?? null
  const adopted = calc?.result.adoptedAreaSqm
  const prev = list.find((v) => v.versionNumber === (latest?.versionNumber ?? 0) - 1)
  const counted = (calc?.result.lines ?? []).filter((l) => l.treatment === 'SEPARATELY_VALUED')

  return <div className="pd-shell">
    <StageBanner icon="₹" title="Draft Valuation" tag={latest ? `Version ${latest.versionNumber}` : undefined} line={`Case Ref: ${a.code} · ${a.property.addressLine}`} asideLabel="Drafter" aside={a.assignedValuer.fullName} />
    <StepHeader a={a} here={3} eyebrow="STEP 4 · VALUATION WORKINGS" title="Valuation Workings" subtitle="Turn the site findings and market evidence into a value. Every rate needs a source and every adjustment a reason." />
    {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
    <ErrorText message={error ?? context.error ?? versions.error} />
    {ctx && !draftable && canDraft && <p className="pd-flag">This assignment is in {ASSIGNMENT_STATUS_LABELS[a.status]}, so a new valuation cannot be drafted. {stepNow < 3 ? 'Complete the site inspection first.' : 'Earlier versions are shown below.'}</p>}

    <div className="pd-grid va-swap">
      <div className="pd-main">
        <section className="pd-card" aria-labelledby="va-basis-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">A</span><div><h2 id="va-basis-h">Compilation data health</h2><p>{ctx?.site ? `Site visit by ${ctx.site.inspector} on ${new Date(ctx.site.visitedAt).toLocaleDateString('en-IN')}.` : 'No submitted site visit yet.'} Pick the area to value; the source is written for you.</p></div></div></div>
          {ctx && ctx.openMaterialDiscrepancies > 0 && <p className="pd-flag">{ctx.openMaterialDiscrepancies} material difference{ctx.openMaterialDiscrepancies === 1 ? '' : 's'} between the site and the papers {ctx.openMaterialDiscrepancies === 1 ? 'is' : 'are'} still open. <Link to={stepPath(2, id)}>Decide them in Site Inspection</Link> before quality review, and explain the adopted area below.</p>}
          {ctx?.site?.observations && <div className="va-chips">{[['Age', ctx.site.observations.age_years && `${ctx.site.observations.age_years} yrs`], ['Floors', ctx.site.observations.floors], ['Construction', ctx.site.observations.construction], ['Quality', ctx.site.observations.quality], ['Condition', ctx.site.observations.condition], ['Road', ctx.site.observations.road_width_ft && `${ctx.site.observations.road_width_ft} ft`]].filter(([, v]) => v).map(([k, v]) => <span key={k as string}><em>{k}</em>{v}</span>)}</div>}
          {(ctx?.candidates.length ?? 0) === 0 ? <div className="pd-empty"><b>No areas on record</b><p>Submit a site visit or verify an area on a document, or type the area yourself below.</p></div> : <div className="in-table-wrap"><table className="in-table"><thead><tr><th>Part</th><th>From</th><th className="is-num">Area (sq. m)</th><th>Agreement</th><th /></tr></thead><tbody>
            {ctx?.candidates.map((c, i) => <tr key={i}><td><b>{c.label}</b><small>{c.source}</small></td><td><span className={`pd-pill ${c.kind === 'MEASURED' ? 'is-submitted' : 'is-type'}`}>{c.kind === 'MEASURED' ? 'Measured' : 'Document'}</span></td><td className="is-num">{fmt(c.areaSqm)}</td><td>{c.withinTolerance === null ? '—' : <span className={`pd-pill ${c.withinTolerance ? 'is-verified' : 'is-warn'}`}>{c.withinTolerance ? 'Matches papers' : 'Differs from papers'}</span>}</td><td>{editable && <button type="button" className="pd-btn is-ghost" onClick={() => useCandidate(c)}>Use this area</button>}</td></tr>)}
          </tbody></table></div>}
          {editable && (ctx?.disclosed.length ?? 0) > 0 && <div className="va-disclosed"><b>Differences already decided</b>{ctx?.disclosed.map((d, i) => <div key={i}><span>{d.description}{d.resolutionNote && <small> — {d.resolutionNote}</small>}</span><button type="button" className="pd-btn is-ghost" onClick={() => setS((cur) => ({ ...cur, assumptions: `${cur.assumptions ? `${cur.assumptions}\n` : ''}${d.status === 'DISCLOSED' ? 'Disclosed' : 'Resolved'}: ${d.description}${d.resolutionNote ? `. ${d.resolutionNote}` : ''}` }))}>Add to assumptions</button></div>)}</div>}
        </section>

        <section className="pd-card" aria-labelledby="va-ev-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">B</span><div><h2 id="va-ev-h">Market rate evidence</h2><p>A comparable can be cited only after a second person has verified it.</p></div></div>{canDraft && !addingEvidence && <button type="button" className="pd-btn is-primary" onClick={() => setAddingEvidence(true)}>＋ Add comparable</button>}</div>
          {(summary.data?.length ?? 0) > 0 && <div className="va-rates">{summary.data?.map((x) => <div key={x.areaBasis}><small>{BASIS_LABEL[x.areaBasis] ?? x.areaBasis} · {x.count} verified</small><b>₹{formatInr(x.median)}</b><span>median · ₹{formatInr(x.min)} to ₹{formatInr(x.max)}</span></div>)}</div>}
          {addingEvidence && <form className="va-block" onSubmit={(e) => { e.preventDefault(); void addEvidence() }}><div className="va-grid">
            <F label="Location" wide><input required minLength={3} value={evidence.location} onChange={(e) => setEvidence({ ...evidence, location: e.target.value })} /></F>
            <F label="Source (registry, broker, listing…)" wide><input required minLength={3} value={evidence.source} onChange={(e) => setEvidence({ ...evidence, source: e.target.value })} /></F>
            <F label="Rate (₹ per sq. m)"><input type="number" step="0.01" min="0.01" required value={evidence.ratePerSqm} onChange={(e) => setEvidence({ ...evidence, ratePerSqm: e.target.value })} /></F>
            <F label="Area basis"><select value={evidence.areaBasis} onChange={(e) => setEvidence({ ...evidence, areaBasis: e.target.value })}><option value="LAND">Land</option>{AREA_BASES.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</select></F>
            <F label="Observed on"><input type="date" required max={new Date().toISOString().slice(0, 10)} value={evidence.observedOn} onChange={(e) => setEvidence({ ...evidence, observedOn: e.target.value })} /></F>
            <F label="Kind"><select value={evidence.isTransaction ? 'sale' : 'ask'} onChange={(e) => setEvidence({ ...evidence, isTransaction: e.target.value === 'sale' })}><option value="sale">Completed sale</option><option value="ask">Asking price</option></select></F>
          </div><div className="va-actions"><button type="button" className="pd-btn is-ghost" onClick={() => setAddingEvidence(false)}>Cancel</button><button className="pd-btn is-primary" disabled={busy}>Add comparable</button></div></form>}
          {(comparables.data?.length ?? 0) === 0 ? <div className="pd-empty"><b>No comparables yet</b><p>Add recent sales or listings near the property. They guide the rate and back it up in the report.</p></div> : <div className="va-comps">{comparables.data?.map((c) => <article key={c.id} className={c.verified ? 'is-ok' : ''}>
            <div><b>{c.location}</b><small>{c.source} · {c.isTransaction ? 'sale' : 'asking price'} · {new Date(c.observedOn).toLocaleDateString('en-IN')} · {BASIS_LABEL[c.areaBasis] ?? c.areaBasis}</small></div>
            <span className="va-rate">₹{formatInr(c.ratePerSqm)}<small>/sq. m</small></span>
            {editable && c.verified && <label className="va-cite"><input type="checkbox" checked={s.cited.includes(c.id)} onChange={(e) => setS({ ...s, cited: e.target.checked ? [...s.cited, c.id] : s.cited.filter((x) => x !== c.id) })} /> Cite</label>}
            {canApprove && <button type="button" className={`pd-btn ${c.verified ? 'is-ok' : 'is-ghost'}`} disabled={busy} onClick={() => void verify(c.id, !c.verified)}>{c.verified ? '✓ Verified' : 'Verify'}</button>}
            {!canApprove && <span className={`pd-pill ${c.verified ? 'is-verified' : 'is-warn'}`}>{c.verified ? 'Verified' : 'Unverified'}</span>}
          </article>)}</div>}
        </section>

        {editable && <section className="pd-card" aria-labelledby="va-work-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">C</span><div><h2 id="va-work-h">Valuation computation: {PROPERTY_CLASS_LABELS[cls]}</h2><p>{list.length > 0 ? `Continuing from version ${latest?.versionNumber ?? list[0].versionNumber}. Saving creates a new version.` : 'Fill in the form; the value is calculated as you type.'}</p></div></div></div>

          {(cls === 'FLAT' || cls === 'COMMERCIAL') && <>
            {cls === 'COMMERCIAL' && <div className="va-seg" role="group" aria-label="Method">{(['SALES', 'INCOME'] as const).map((m) => <button key={m} type="button" className={s.method === m ? 'is-on' : ''} onClick={() => setS({ ...s, method: m })}>{m === 'SALES' ? 'Sales comparison' : 'Income capitalisation'}</button>)}</div>}
            <div className="va-grid"><BasisSel label="Area basis" v={s.areaBasis} onChange={(b) => setS({ ...s, areaBasis: b, rateBasis: s.rateBasis === s.areaBasis ? b : s.rateBasis })} /><BasisSel label="Rate basis (must match)" v={s.rateBasis} onChange={(b) => setS({ ...s, rateBasis: b })} /></div>
            <Rated title={cls === 'FLAT' ? 'Unit' : 'Commercial area'} value={s.unit} onChange={(unit) => setS({ ...s, unit })} basis={s.rateBasis} stats={stats} />
            {cls === 'COMMERCIAL' && s.method === 'INCOME' && <div className="va-block"><h4>Income approach</h4><div className="va-grid">
              <F label="Monthly rent (₹)"><input type="number" step="0.01" value={s.income.monthlyRent} onChange={(e) => setS({ ...s, income: { ...s.income, monthlyRent: e.target.value } })} /></F>
              <F label="Rent based on"><input value={s.income.rentSource} onChange={(e) => setS({ ...s, income: { ...s.income, rentSource: e.target.value } })} /></F>
              <F label="Vacancy (%)"><input type="number" step="0.01" value={s.income.vacancyPercent} onChange={(e) => setS({ ...s, income: { ...s.income, vacancyPercent: e.target.value } })} /></F>
              <F label="Operating expenses (%)"><input type="number" step="0.01" value={s.income.operatingExpensePercent} onChange={(e) => setS({ ...s, income: { ...s.income, operatingExpensePercent: e.target.value } })} /></F>
              <F label="Capitalisation rate (%)"><input type="number" step="0.01" value={s.income.capRatePercent} onChange={(e) => setS({ ...s, income: { ...s.income, capRatePercent: e.target.value } })} /></F>
              <F label="Cap rate based on"><input value={s.income.capRateSource} onChange={(e) => setS({ ...s, income: { ...s.income, capRateSource: e.target.value } })} /></F>
            </div></div>}
          </>}

          {(cls === 'HOUSE' || cls === 'LAND' || cls === 'INDUSTRIAL') && <Rated title="Land" value={s.land} onChange={(land) => setS({ ...s, land })} basis="LAND" stats={stats} />}

          {(cls === 'HOUSE' || cls === 'INDUSTRIAL') && <div className="va-block"><div className="va-block-head"><h4>Building floors</h4><button type="button" className="pd-btn is-ghost" onClick={() => setS({ ...s, floors: [...s.floors, { ...emptyFloor, age }] })}>＋ Add floor</button></div>
            {s.floors.length === 0 && <p className="pd-muted">Add each floor with its construction rate. Depreciation is straight-line from the age and useful life you state.</p>}
            {s.floors.map((f, i) => <div key={i} className="va-row"><div className="va-grid">
              <F label="Floor"><input value={f.label} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { label: e.target.value }) })} /></F>
              <F label="Area (sq. m)"><input type="number" step="0.01" min="0" value={f.area} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { area: e.target.value }) })} /></F>
              <F label="Construction rate (₹/sq. m)"><input type="number" step="0.01" min="0" value={f.rate} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { rate: e.target.value }) })} /></F>
              <F label="Rate based on"><input value={f.source} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { source: e.target.value }) })} /></F>
              <F label="Age (years)"><input type="number" step="0.01" min="0" value={f.age} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { age: e.target.value }) })} /></F>
              <F label="Useful life (years)"><input type="number" step="0.01" min="0" value={f.life} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { life: e.target.value }) })} /></F>
              <F label="Residual value (%)"><input type="number" step="0.01" min="0" max="100" value={f.residual} onChange={(e) => setS({ ...s, floors: upd(s.floors, i, { residual: e.target.value }) })} /></F>
            </div><button type="button" className="va-x" aria-label={`Remove floor ${i + 1}`} onClick={() => setS({ ...s, floors: dropAt(s.floors, i) })}>Remove</button></div>)}
          </div>}

          {cls === 'INDUSTRIAL' && <div className="va-block"><h4>Plant &amp; machinery</h4>
            <div className="va-seg" role="group" aria-label="Plant in scope">{([['yes', 'Included in scope'], ['no', 'Not in scope']] as const).map(([k, l]) => <button key={k} type="button" className={s.scopePlant === k ? 'is-on' : ''} onClick={() => setS({ ...s, scopePlant: k, plant: k === 'no' ? [] : s.plant })}>{l}</button>)}</div>
            {s.scopePlant === '' && <p className="pd-muted">State the scope so plant is never counted or left out by accident.</p>}
            {s.scopePlant === 'yes' && <><button type="button" className="pd-btn is-ghost" onClick={() => setS({ ...s, plant: [...s.plant, { ...emptyPlant }] })}>＋ Add item</button>
              {s.plant.map((p, i) => <div key={i} className="va-row"><div className="va-grid">
                <F label="Item"><input value={p.item} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { item: e.target.value }) })} /></F>
                <F label="Quantity"><input type="number" step="0.01" value={p.quantity} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { quantity: e.target.value }) })} /></F>
                <F label="Unit cost (₹)"><input type="number" step="0.01" value={p.unitCost} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { unitCost: e.target.value }) })} /></F>
                <F label="Cost based on"><input value={p.source} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { source: e.target.value }) })} /></F>
                <F label="Age (years)"><input type="number" step="0.01" value={p.age} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { age: e.target.value }) })} /></F>
                <F label="Useful life (years)"><input type="number" step="0.01" value={p.life} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { life: e.target.value }) })} /></F>
                <F label="Residual (%)"><input type="number" step="0.01" value={p.residual} onChange={(e) => setS({ ...s, plant: upd(s.plant, i, { residual: e.target.value }) })} /></F>
              </div><button type="button" className="va-x" onClick={() => setS({ ...s, plant: dropAt(s.plant, i) })}>Remove</button></div>)}</>}
          </div>}

          {cls === 'MIXED_USE' && <div className="va-block"><div className="va-block-head"><h4>Components</h4><button type="button" className="pd-btn is-ghost" onClick={() => setS({ ...s, components: [...s.components, { ...emptyComponent }] })}>＋ Add component</button></div>
            <div className="va-grid"><F label="Sanctioned plan reference" wide><input value={s.planRef} onChange={(e) => setS({ ...s, planRef: e.target.value })} /></F></div>
            {s.components.map((c, i) => <div key={i} className="va-row"><div className="va-grid">
              <F label="Component"><input value={c.label} onChange={(e) => setS({ ...s, components: upd(s.components, i, { label: e.target.value }) })} /></F>
              <F label="Use"><select value={c.use} onChange={(e) => setS({ ...s, components: upd(s.components, i, { use: e.target.value as typeof c.use }) })}>{USES.map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}</select></F>
              <F label="Area (sq. m)"><input type="number" step="0.01" value={c.area} onChange={(e) => setS({ ...s, components: upd(s.components, i, { area: e.target.value }) })} /></F>
              <F label="Rate (₹/sq. m)"><input type="number" step="0.01" value={c.rate} onChange={(e) => setS({ ...s, components: upd(s.components, i, { rate: e.target.value }) })} /></F>
              <F label="Rate based on"><input value={c.source} onChange={(e) => setS({ ...s, components: upd(s.components, i, { source: e.target.value }) })} /></F>
              <F label="Complete (%)"><input type="number" step="0.01" value={c.completion} onChange={(e) => setS({ ...s, components: upd(s.components, i, { completion: e.target.value }) })} /></F>
            </div><button type="button" className="va-x" onClick={() => setS({ ...s, components: dropAt(s.components, i) })}>Remove</button></div>)}
          </div>}

          <div className="va-block"><div className="va-block-head"><h4>Adjustments</h4><button type="button" className="pd-btn is-ghost" onClick={() => setS({ ...s, adjustments: [...s.adjustments, { ...emptyAdjustment }] })}>＋ Add adjustment</button></div>
            {s.adjustments.length === 0 && <p className="pd-muted">Percentage changes to the primary value, such as location or corner premium. Each needs a reason.</p>}
            {s.adjustments.map((x, i) => <div key={i} className="va-row"><div className="va-grid">
              <F label="Adjustment"><input list="va-adj" value={x.label} onChange={(e) => setS({ ...s, adjustments: upd(s.adjustments, i, { label: e.target.value }) })} /></F>
              <F label="Percent (+/−)"><input type="number" step="0.01" min="-50" max="50" value={x.percent} onChange={(e) => setS({ ...s, adjustments: upd(s.adjustments, i, { percent: e.target.value }) })} /></F>
              <F label="Reason" wide><input value={x.reason} onChange={(e) => setS({ ...s, adjustments: upd(s.adjustments, i, { reason: e.target.value }) })} /></F>
            </div><button type="button" className="va-x" onClick={() => setS({ ...s, adjustments: dropAt(s.adjustments, i) })}>Remove</button></div>)}
            <datalist id="va-adj">{SKIP_ADJ.map((l) => <option key={l} value={l} />)}</datalist>
          </div>

          <div className="va-block"><div className="va-block-head"><h4>Extra items</h4><button type="button" className="pd-btn is-ghost" onClick={() => setS({ ...s, extras: [...s.extras, { ...emptyExtra }] })}>＋ Add item</button></div>
            {s.extras.length === 0 && <p className="pd-muted">Anything beyond land and building: borewell, solar, boundary wall. Say whether it is already in the base rate so it is never counted twice.</p>}
            {s.extras.map((x, i) => <div key={i} className="va-row"><div className="va-grid">
              <F label="Item"><input value={x.component} onChange={(e) => setS({ ...s, extras: upd(s.extras, i, { component: e.target.value }) })} /></F>
              <F label="Quantity"><input type="number" step="0.01" value={x.quantity} onChange={(e) => setS({ ...s, extras: upd(s.extras, i, { quantity: e.target.value }) })} /></F>
              <F label="Unit"><input value={x.unit} onChange={(e) => setS({ ...s, extras: upd(s.extras, i, { unit: e.target.value }) })} /></F>
              <F label="Rate (₹)"><input type="number" step="0.01" value={x.rate} onChange={(e) => setS({ ...s, extras: upd(s.extras, i, { rate: e.target.value }) })} /></F>
              <F label="Treatment"><select value={x.treatment} onChange={(e) => setS({ ...s, extras: upd(s.extras, i, { treatment: e.target.value as typeof x.treatment }) })}>{TREATMENTS.map((t) => <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>)}</select></F>
              <F label="Source / note" wide><input value={x.sourceNote} onChange={(e) => setS({ ...s, extras: upd(s.extras, i, { sourceNote: e.target.value }) })} /></F>
            </div><button type="button" className="va-x" onClick={() => setS({ ...s, extras: dropAt(s.extras, i) })}>Remove</button></div>)}
          </div>

          <div className="va-block"><h4>Basis &amp; assumptions</h4><div className="va-grid">
            <F label="Why this area is adopted *" wide><textarea rows={3} required value={s.areaSource} onChange={(e) => setS({ ...s, areaSource: e.target.value })} placeholder="Use the buttons above to fill this from the site visit or documents" /></F>
            <F label="Assumptions and special conditions" wide><textarea rows={3} value={s.assumptions} onChange={(e) => setS({ ...s, assumptions: e.target.value })} /></F>
            {list.length > 0 && <F label="What changed from the earlier version *" wide><textarea rows={2} minLength={10} value={s.changeReason} onChange={(e) => setS({ ...s, changeReason: e.target.value })} placeholder="At least 10 characters. Kept with the version for the audit trail." /></F>}
          </div></div>
        </section>}

        {editable && <section className="pd-card va-fmv" aria-labelledby="va-res-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">D</span><div><h2 id="va-res-h">Fair market value assessment</h2><p>{calcBusy ? 'Calculating…' : calc ? `${calc.result.method.replaceAll('_', ' ').toLowerCase()} · updates as you type` : 'The workings appear here once the form is complete.'}</p></div></div></div>
          {calc ? <>
            <div className="va-total"><small>Total value</small><b>₹ {formatInr(calc.result.totalValue)}</b><span>{rupeesInWords(calc.result.totalValue)}</span>
              {adopted ? <em>≈ ₹ {formatInr(calc.result.totalValue / adopted)} per sq. m of adopted area ({fmt(adopted)} sq. m)</em> : null}
              {prev || latest ? (() => { const base = Number(latest?.totalValue ?? 0); const diff = calc.result.totalValue - base; return base > 0 && Math.abs(diff) > 0.005 ? <em className={diff > 0 ? 'is-up' : 'is-down'}>{diff > 0 ? '▲' : '▼'} ₹ {formatInr(Math.abs(diff))} ({((diff / base) * 100).toFixed(1)}%) against version {latest?.versionNumber}</em> : null })() : null}</div>
            {calc.warnings.map((w) => <p key={w} className="pd-flag">{w}</p>)}
            {calc.result.requiresReview.length > 0 && <p className="pd-flag">Settle before review: {calc.result.requiresReview.join(', ')}.</p>}
            <button type="button" className="va-toggle" onClick={() => setShowWorkings(!showWorkings)}>{showWorkings ? 'Hide' : 'Show'} line-by-line workings ({calc.result.lines.length} lines, {counted.length} counted)</button>
            {showWorkings && <LinesTable lines={calc.result.lines} />}
          </> : problems.length > 0 ? <div className="va-todo"><b>To complete ({problems.length})</b><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div> : <div className="pd-empty"><b>Nothing to calculate yet</b><p>Start with the area and rate.</p></div>}
        
          {calc && <div className="va-caveat">{canDraft && aiStatus.data?.enabled && <div className="va-ai"><button type="button" disabled={aiBusy} onClick={() => void suggestAssumptions()}>{aiBusy ? '✨ AI is drafting…' : '✨ Suggest with AI'}</button>{aiError && <small>{aiError}</small>}</div>}
            {aiText && <div className="va-ai-box"><b>✨ AI suggestion (check it, then use or ignore)</b><p>{aiText.assumptions}</p>{aiText.needsInput.length > 0 && <small>Missing: {aiText.needsInput.join('; ')}</small>}<div><button type="button" onClick={() => { setS({ ...s, assumptions: aiText.assumptions }); setAiText(null) }}>Use this</button><button type="button" onClick={() => setAiText(null)}>Ignore</button></div></div>}
            <label>Valuer’s mandatory report assumption / caveat<textarea rows={2} value={s.assumptions} onChange={(e) => setS({ ...s, assumptions: e.target.value })} placeholder="e.g. Value assumes clear title and vacant possession; area as measured on site." /></label>
            <div className="va-caveat-actions"><button type="button" className="va-gold" disabled={busy || (list.length > 0 && s.changeReason.trim().length < 10)} onClick={() => void saveDraft()}>{busy ? 'Saving…' : list.length > 0 ? 'Save as new version' : 'Save draft'}</button>
              {latest?.status === 'DRAFT' && canDraft && <button type="button" className="va-gold is-outline" disabled={busy} onClick={() => void move(latest.id, 'submit-for-review')}>Submit version {latest.versionNumber} for review →</button>}</div></div>}
        </section>}

        <section className="pd-card" aria-labelledby="va-ver-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">{editable ? 'E' : 'A'}</span><div><h2 id="va-ver-h">Versions</h2><p>Saved versions are never edited. A change is a new version with a reason.</p></div></div></div>
          {list.length === 0 ? <div className="pd-empty"><b>No version saved yet</b><p>Save a draft once the calculation looks right.</p></div> : <div className="va-versions">{list.map((v) => {
            const before = list.find((x) => x.versionNumber === v.versionNumber - 1)
            return <article key={v.id} className={`va-version is-${v.status.toLowerCase()}`}>
              <div className="va-version-top"><div><b>Version {v.versionNumber}</b><small>{new Date(v.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {v.method.replaceAll('_', ' ').toLowerCase()}</small></div><span className="va-version-total">₹ {formatInr(v.totalValue)}{before && <small className={Number(v.totalValue) >= Number(before.totalValue) ? 'is-up' : 'is-down'}>{Number(v.totalValue) >= Number(before.totalValue) ? '▲' : '▼'} {(((Number(v.totalValue) - Number(before.totalValue)) / Number(before.totalValue)) * 100).toFixed(1)}%</small>}</span><span className={`pd-pill is-${v.status === 'APPROVED' ? 'verified' : v.status === 'IN_REVIEW' ? 'submitted' : v.status === 'DRAFT' ? 'warn' : 'type'}`}>{STATUS_LABEL[v.status] ?? v.status}</span></div>
              {v.changeReason && <p className="va-reason">“{v.changeReason}”</p>}
              <div className="va-version-actions">
                <button type="button" className="pd-btn is-ghost" onClick={() => setOpenVersion(openVersion === v.id ? null : v.id)}>{openVersion === v.id ? 'Hide workings' : 'View workings'}</button>
                {editable && v.status !== 'SUPERSEDED' && <button type="button" className="pd-btn is-ghost" onClick={() => { setS(fromInputs(v.inputs)); setNotice(`Version ${v.versionNumber} loaded into the form. Change what you need and save a new version.`); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Revise from this</button>}
                {canDraft && v.status === 'DRAFT' && <button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void move(v.id, 'submit-for-review')}>Send for review</button>}
                {canApprove && v.status === 'IN_REVIEW' && <button type="button" className="pd-btn is-ok" disabled={busy} onClick={() => void move(v.id, 'approve')}>Approve</button>}
              </div>
              {openVersion === v.id && <LinesTable lines={v.lineItems} />}
            </article>
          })}</div>}
        </section>
      </div>

      <aside className="pd-aside">
        <ReadyCard title="Ready for quality review?" readiness={r} summary={!r ? '' : r.canProceed ? 'You can move to quality review.' : 'Send a valuation for review and clear any open differences.'}>
        {editable && <button type="button" className="pd-btn is-primary is-block" disabled={busy || !calc || (list.length > 0 && s.changeReason.trim().length < 10)} onClick={() => void saveDraft()}>{busy ? 'Saving…' : list.length > 0 ? 'Save as new version' : 'Save draft'}</button>}
        {editable && !calc && <p className="pd-muted in-gap">{problems.length ? `${problems.length} thing${problems.length === 1 ? '' : 's'} left to complete in the workings.` : 'Complete the workings to save.'}</p>}
        {editable && calc && list.length > 0 && s.changeReason.trim().length < 10 && <p className="pd-muted in-gap">Say what changed (at least 10 characters) to save a new version.</p>}
        {latest?.status === 'DRAFT' && canDraft && <button type="button" className="pd-btn is-block in-gap" disabled={busy} onClick={() => void move(latest.id, 'submit-for-review')}>Send version {latest.versionNumber} for review</button>}
        {a.status === 'VALUATION' || a.status === 'REVISION' ? (canDraft ? <button type="button" className="pd-btn is-primary is-block in-gap" disabled={!r?.canProceed || busy} onClick={() => void advance()}>Continue to Quality Review →</button> : <p className="pd-muted in-gap">Only a valuer or admin can move this assignment forward.</p>)
          : stepNow > 3 ? <div className="pd-moved in-gap"><b>Already in {ASSIGNMENT_STATUS_LABELS[a.status]}</b><Link to={stepPath(Math.min(stepNow, 5), a.id)} className="pd-btn is-primary">Open next step →</Link></div> : null}
        <Link to={stepPath(2, a.id)} className="pd-save-exit">← Back to Site Inspection</Link>
      </ReadyCard>
        {(formatInfo.data?.formats.length ?? 0) > 0 && <section className="pd-card va-formats"><h3>Report format</h3><p>The bank’s own layout the report will be drawn in.</p>
          {formatInfo.data?.formats.map((f) => <label key={f.id} className={pickedFormat === f.id ? 'is-on' : ''}><input type="radio" name="report-format" checked={pickedFormat === f.id} onChange={() => setReportFormat(f.id)} /> {f.label}</label>)}
          <Link to={`/assignments/${id}/bank-report${pickedFormat ? `?format=${pickedFormat}` : ''}`} className="pd-btn is-ghost is-block">👁 Preview draft report</Link></section>}
      </aside>
    </div>
  </div>
}

function LinesTable({ lines }: { lines: Line[] }) {
  return <div className="in-table-wrap"><table className="in-table va-lines"><thead><tr><th>Component</th><th className="is-num">Qty</th><th>Unit</th><th className="is-num">Rate</th><th className="is-num">Amount (₹)</th><th>Treatment</th></tr></thead><tbody>
    {lines.map((l, i) => { const amount = Number(l.amount); return <tr key={i} className={l.treatment === 'SEPARATELY_VALUED' ? '' : 'is-info'}><td><b>{l.component}</b>{l.sourceNote && <small>{l.sourceNote}</small>}</td><td className="is-num">{formatInr(l.quantity)}</td><td>{l.unit}</td><td className="is-num">{formatInr(l.rate)}</td><td className={`is-num ${amount < 0 ? 'is-neg' : ''}`}>{formatInr(l.amount)}</td><td><span className={`pd-pill ${l.treatment === 'SEPARATELY_VALUED' ? 'is-verified' : l.treatment === 'REQUIRES_REVIEW' ? 'is-warn' : 'is-type'}`}>{TREATMENT_LABEL[l.treatment] ?? l.treatment}</span></td></tr> })}
  </tbody></table></div>
}
