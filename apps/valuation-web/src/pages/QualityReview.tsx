import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ASSIGNMENT_STATUS_LABELS } from '@value-hub/valuation-shared'
import { ReadyCard, StageBanner, StepHeader, STEP_OF_STATUS, stepPath, type AssignmentHead, type Readiness } from '../components/WorkflowParts.tsx'
import { ErrorText, errorMessage, formatInr } from '../components/ui.tsx'
import { api, fileBlobUrl, openFile } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Template { id: string; name: string; version: number; propertyClass: string | null; effectiveFrom: string }
interface QcCheck { code: string; label: string; status: 'PASS' | 'FAIL' | 'WARN'; detail?: string }
interface Qc { passed: boolean; checks: QcCheck[] }
interface Report { bankFormat?: string | null; docxKey?: string | null; id: string; versionNumber: number; status: string; qc: Qc; createdAt: string; issuedAt: string | null; approvedAt: string | null; valuationVersionId: string; template: { name: string; version: number } }
interface Context {
  status: string
  valuation: { id: string; versionNumber: number; status: string; method: string; totalValue: string; adoptedAreaSqm: string; author: string | null; createdAt: string; approvedAt: string | null } | null
  report: { id: string; versionNumber: number; status: string; author: string | null; forLatestValuation: boolean; template: { name: string; version: number } } | null
  openMaterialDiscrepancies: number
  readiness: Readiness
}
interface ChecklistEntry { itemId: string; label: string; checked: boolean }

const FLOW = [['DRAFT', 'Draft'], ['IN_REVIEW', 'With reviewer'], ['APPROVED', 'Approved'], ['ISSUED', 'Issued']] as const
const VALUATION_LABEL: Record<string, string> = { DRAFT: 'Draft', IN_REVIEW: 'With reviewer', APPROVED: 'Approved', SUPERSEDED: 'Superseded' }

// Where to go to put right what a failed check found.
function fixTarget(code: string, id: string): { to: string; label: string } | null {
  if (['required_fields', 'area_facts', 'other_facts', 'annexures_present', 'annexure_files', 'annexure_embed'].includes(code)) return { to: stepPath(1, id), label: 'Property & Documents' }
  if (['photos', 'photo_captions', 'photo_embed', 'discrepancies'].includes(code)) return { to: stepPath(2, id), label: 'Site Inspection' }
  if (['total_reconciles', 'line_arithmetic', 'sources', 'area_positive', 'valuation_state', 'comparables'].includes(code)) return { to: stepPath(3, id), label: 'Valuation Workings' }
  return null
}

function QcPanel({ qc, id }: { qc: Qc; id: string }) {
  const failed = qc.checks.filter((c) => c.status === 'FAIL')
  const warned = qc.checks.filter((c) => c.status === 'WARN')
  const passed = qc.checks.filter((c) => c.status === 'PASS')
  const row = (c: QcCheck) => { const fix = c.status === 'PASS' ? null : fixTarget(c.code, id); return <li key={c.code} className={`qr-check is-${c.status.toLowerCase()}`}><span>{c.status === 'PASS' ? '✓' : c.status === 'FAIL' ? '✕' : '!'}</span><div><b>{c.label}</b>{c.detail && <small>{c.detail}</small>}</div>{fix && <Link to={fix.to} className="pd-btn is-ghost">Fix in {fix.label} →</Link>}</li> }
  return <div className="qr-qc">
    <div className="qr-qc-head"><div className={`qr-verdict ${qc.passed ? 'is-ok' : 'is-bad'}`}>{qc.passed ? '✓ All required checks pass' : `✕ ${failed.length} check${failed.length === 1 ? '' : 's'} must be fixed`}</div><div className="qr-bar" aria-hidden><i style={{ width: `${(passed.length / qc.checks.length) * 100}%` }} /></div><small>{passed.length} of {qc.checks.length} passed{warned.length ? ` · ${warned.length} warning${warned.length === 1 ? '' : 's'}` : ''}</small></div>
    {failed.length > 0 && <ul className="qr-checks">{failed.map(row)}</ul>}
    {warned.length > 0 && <ul className="qr-checks">{warned.map(row)}</ul>}
    {passed.length > 0 && <details className="qr-passed"><summary>{passed.length} passed</summary><ul className="qr-checks">{passed.map(row)}</ul></details>}
  </div>
}

function ReportPreview({ reportId }: { reportId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let made: string | null = null; let cancelled = false
    setUrl(null); setFailed(null)
    fileBlobUrl(`/reports/${reportId}/file`).then((f) => { if (cancelled) URL.revokeObjectURL(f.url); else { made = f.url; setUrl(f.url) } }).catch((c: unknown) => { if (!cancelled) setFailed(errorMessage(c)) })
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made) }
  }, [reportId])
  return <div className="qr-preview">{failed ? <p className="pd-muted">{failed}</p> : url ? <iframe title="Report preview" src={url} /> : <p className="pd-muted">Loading the report…</p>}</div>
}

interface LayerRow { key: string; label: string; group: string; status: string; delta: string | null; document: { value: string; source: string } | null; site: { value: string; source: string } | null }
function EvidenceLayers({ assignmentId }: { assignmentId: string }) {
  const data = useFetch<{ rows: LayerRow[]; open: number }>(`/assignments/${assignmentId}/comparison`)
  const [tab, setTab] = useState<string | null>(null)
  const rows = data.data?.rows ?? []
  const groups = [...new Set(rows.map((r) => r.group))]
  const current = tab && groups.includes(tab) ? tab : groups[0]
  const badge: Record<string, string> = { consistent: 'badge-matched', verify: 'badge-verify', mismatch: 'badge-mismatch', missing: 'badge-missing', document: 'badge-missing' }
  return <section className="pd-card" aria-labelledby="qr-layers-h">
    <div className="pd-card-head"><div><span className="pd-step-tag">◎</span><div><h2 id="qr-layers-h">3-layer evidence verification</h2><p>Document layer, site layer and the verdict between them. {data.data ? `${data.data.open} difference${data.data.open === 1 ? '' : 's'} still open.` : ''}</p></div></div></div>
    {rows.length === 0 ? <p className="pd-muted">{data.error ?? 'Nothing to compare yet.'}</p> : <>
      <div className="qr-tabs" role="tablist">{groups.map((g) => <button key={g} type="button" role="tab" aria-selected={g === current} className={g === current ? 'is-on' : ''} onClick={() => setTab(g)}>{g}</button>)}</div>
      <div className="qr-layers">{rows.filter((r) => r.group === current).map((r) => <div key={r.key} className="qr-layer">
        <div className="qr-layer-head"><b>{r.label}</b><span className={badge[r.status] ?? 'badge-missing'}>{r.status}</span>{r.delta && <small>{r.delta}</small>}</div>
        <div className="qr-layer-grid"><div><small>Document layer</small><b>{r.document?.value ?? 'Not recorded'}</b>{r.document && <em>{r.document.source}</em>}</div>
          <div><small>Site layer</small><b>{r.site?.value ?? 'Not recorded'}</b>{r.site && <em>{r.site.source}</em>}</div></div>
      </div>)}</div>
    </>}
  </section>
}

export default function QualityReview() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canPrepare = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canApprove = canPrepare || user?.role === 'REVIEWER'
  const assignment = useFetch<AssignmentHead>(`/assignments/${id}`)
  const context = useFetch<Context>(`/assignments/${id}/review-context`)
  const templates = useFetch<Template[]>(`/assignments/${id}/report-templates`)
  const reports = useFetch<Report[]>(`/assignments/${id}/reports`)
  const a = assignment.data
  const ctx = context.data
  const report = reports.data?.find((r) => r.id === ctx?.report?.id) ?? null
  const checklist = useFetch<ChecklistEntry[]>(report ? `/reports/${report.id}/checklist` : null)
  const [templateId, setTemplateId] = useState('')
  const formatInfo = useFetch<{ format: string; formats: { id: string; label: string }[] }>(`/assignments/${id}/bank-report`)
  // The bank's own layout is the default: it is what the bank receives. 'GENERIC' keeps the template's own PDF.
  const [layout, setLayout] = useState('')
  const bankFormat = layout === 'GENERIC' ? '' : layout || formatInfo.data?.format || ''
  const [qc, setQc] = useState<Qc | null>(null)
  const [qcBusy, setQcBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPdf, setShowPdf] = useState(false)
  const [changeReason, setChangeReason] = useState('')
  const [confirmBack, setConfirmBack] = useState(false)

  const reloadAll = () => { assignment.reload(); context.reload(); reports.reload(); templates.reload(); checklist.reload() }
  const everIssued = (reports.data ?? []).some((r) => r.issuedAt)
  const reviewing = ctx?.status === 'QUALITY_REVIEW' || ctx?.status === 'VALUATION' || ctx?.status === 'REVISION'

  // Pick the only template automatically, and check the report against it as soon as one is chosen.
  useEffect(() => { if (!templateId && templates.data?.length === 1) setTemplateId(templates.data[0].id) }, [templates.data, templateId])
  useEffect(() => {
    if (!templateId || !canApprove || !reviewing) return
    let cancelled = false
    setQcBusy(true)
    api.post<Qc>(`/assignments/${id}/reports/preview-qc`, { templateId, ...(bankFormat && { bankFormat }) }).then((r) => { if (!cancelled) { setQc(r); setError(null) } }).catch((c: unknown) => { if (!cancelled) { setQc(null); setError(errorMessage(c)) } }).finally(() => { if (!cancelled) setQcBusy(false) })
    return () => { cancelled = true }
  }, [templateId, bankFormat, id, canApprove, reviewing, ctx?.valuation?.status, ctx?.valuation?.id])

  async function run(action: () => Promise<unknown>, ok?: string) {
    setError(null); setNotice(null); setBusy(true)
    try { await action(); if (ok) setNotice(ok); reloadAll() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  const approveValuation = () => ctx?.valuation && run(() => api.post(`/valuations/${ctx.valuation?.id}/approve`, {}), 'Valuation approved.')
  const createReport = () => run(async () => { await api.post(`/assignments/${id}/reports`, { templateId, ...(bankFormat && { bankFormat }), ...(everIssued && { changeReason }) }); setChangeReason(''); setShowPdf(true) }, 'Draft report created from the current valuation.')
  const move = (action: 'submit-for-review' | 'approve') => report && run(() => api.post(`/reports/${report.id}/${action}`, {}), action === 'approve' ? 'Report approved.' : 'Report sent for review.')
  const tick = (itemId: string, checked: boolean) => report && run(() => api.put(`/reports/${report.id}/checklist/${itemId}`, { checked }))
  const installDefaults = () => run(() => api.post('/report-templates/install-defaults', {}), 'Standard templates installed.')
  async function advance() {
    setBusy(true); setError(null)
    try { await api.patch(`/assignments/${id}/status`, { status: 'APPROVED' }); navigate(stepPath(5, id)) } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }
  // Backward moves go one stage at a time, so a return to Inspection or Documents passes through the stages between.
  async function returnTo(chain: string[], go: string) {
    setBusy(true); setError(null)
    try { for (const status of chain) await api.patch(`/assignments/${id}/status`, { status }); navigate(go) } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }

  async function sendBack() {
    setBusy(true); setError(null)
    try { await api.patch(`/assignments/${id}/status`, { status: 'VALUATION' }); navigate(stepPath(3, id)) } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }

  if (assignment.error) return <div className="pd-shell"><ErrorText message={assignment.error} /><Link to="/assignments" className="pd-back">← Assignment Inbox</Link></div>
  if (!a) return <div className="pd-shell"><p className="pd-muted">Loading assignment…</p></div>
  const stepNow = STEP_OF_STATUS[a.status]
  const v = ctx?.valuation ?? null
  const rep = ctx?.report ?? null
  const r = ctx?.readiness ?? null
  const mine = (author: string | null) => !!author && author === user?.fullName && user?.role !== 'FIRM_ADMIN'
  const checklistDone = (checklist.data ?? []).filter((c) => c.checked).length
  const flowIndex = report ? FLOW.findIndex(([s]) => s === report.status) : -1
  const stale = !!rep && !rep.forLatestValuation

  return <div className="pd-shell">
    <StageBanner icon="✍" title="Valuer Sign-Off" tag={rep ? 'Report built' : undefined} line={`Case Ref: ${a.code} · Checker ≠ maker: a second person signs off`} asideLabel="Review progress" aside={`${checklistDone} of ${(checklist.data ?? []).length} checks done`} />
    <StepHeader a={a} here={4} eyebrow="STEP 5 · QUALITY REVIEW" title="Quality Review" subtitle="A second person signs off the numbers, the report is built from them and checked, and nothing goes to the bank until both are approved." />
    {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
    <ErrorText message={error ?? context.error ?? reports.error} />
    {ctx && !reviewing && <p className="pd-flag">This assignment is in {ASSIGNMENT_STATUS_LABELS[a.status]}. {stepNow < 4 ? 'Finish the valuation and send it for review to reach quality review.' : 'The review below is a record; nothing can be changed here now.'}</p>}

    <div className="pd-grid">
      <div className="pd-main">
        <div className="qr-duo">
          <EvidenceLayers assignmentId={id} />
        {v && <section className="pd-card" aria-labelledby="qr-fig-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">₹</span><div><h2 id="qr-fig-h">Final certified appraised figures</h2><p>As they will be certified in the report. Realizable and distress values follow the standard 90% and 80% of fair market value.</p></div></div></div>
          <div className="qr-figs"><div><small>Fair market value (₹)</small><b>{formatInr(v.totalValue)}</b></div><div><small>Realizable value (₹) · 90%</small><b>{formatInr(Number(v.totalValue) * 0.9)}</b></div><div><small>Distress / forced sale (₹) · 80%</small><b>{formatInr(Number(v.totalValue) * 0.8)}</b></div></div>
          <p className="qr-meta">To change a figure, revise the valuation in Valuation Workings; a certified value is never edited here.</p>
        </section>}
        {report && <section className="pd-card" aria-labelledby="qr-chk-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">✓</span><div><h2 id="qr-chk-h">Principal valuer audit checklist</h2><p>Every item must be ticked by the approver before the report can be approved.</p></div></div></div>
          <h4 className="qr-sub">Items {checklist.data && checklist.data.length > 0 && <em>{checklistDone} of {checklist.data.length}</em>}</h4>
          {checklist.data && checklist.data.length > 0 ? <ul className="qr-list">{checklist.data.map((c) => <li key={c.itemId}><label><input type="checkbox" checked={c.checked} disabled={busy || !canApprove || !['DRAFT', 'IN_REVIEW'].includes(report.status)} onChange={(e) => void tick(c.itemId, e.target.checked)} /> {c.label}</label></li>)}</ul> : <p className="pd-muted">The firm has not set any checklist items for this kind of property.</p>}
        </section>}
        </div>
        <section className="pd-card" aria-labelledby="qr-val-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">A</span><div><h2 id="qr-val-h">Valuation sign-off</h2><p>The assessed value must be approved by someone other than whoever prepared it.</p></div></div></div>
          {!v ? <div className="pd-empty"><b>No valuation yet</b><p>Complete the valuation workings first.</p><Link to={stepPath(3, id)} className="pd-btn is-primary">Go to Valuation Workings</Link></div> : <>
            <div className="qr-value"><div><small>Assessed value · version {v.versionNumber}</small><b>₹ {formatInr(v.totalValue)}</b><span>{v.method.replaceAll('_', ' ').toLowerCase()} · adopted area {formatInr(v.adoptedAreaSqm)} sq. m</span></div>
              <span className={`pd-pill is-${v.status === 'APPROVED' ? 'verified' : v.status === 'IN_REVIEW' ? 'submitted' : 'warn'}`}>{VALUATION_LABEL[v.status] ?? v.status}</span></div>
            <p className="qr-meta">Prepared by <b>{v.author ?? 'unknown'}</b>{v.approvedAt ? ` · approved ${new Date(v.approvedAt).toLocaleDateString('en-IN')}` : ''}</p>
            {ctx && ctx.openMaterialDiscrepancies > 0 && <p className="pd-flag">{ctx.openMaterialDiscrepancies} material site difference{ctx.openMaterialDiscrepancies === 1 ? ' is' : 's are'} still open. <Link to={stepPath(2, id)}>Decide them in Site Inspection.</Link></p>}
            <div className="qr-actions">
              <Link to={stepPath(3, id)} className="pd-btn is-ghost">Open the workings ↗</Link>
              {v.status === 'IN_REVIEW' && canApprove && (mine(v.author) ? <span className="pd-muted">You prepared this version, so someone else must approve it.</span> : <button type="button" className="pd-btn is-primary" disabled={busy || !reviewing} onClick={() => void approveValuation()}>Approve valuation</button>)}
              {v.status === 'DRAFT' && <span className="pd-muted">Still a draft. Send it for review from Valuation Workings.</span>}
            </div>
          </>}
        </section>

        <section className="pd-card" aria-labelledby="qr-rep-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">B</span><div><h2 id="qr-rep-h">Prepare the report</h2><p>The report is drawn from the approved records and frozen, then checked before anyone signs it off.</p></div></div></div>
          {templates.data && templates.data.length === 0 ? <div className="pd-empty"><b>No report template fits this assignment</b><p>A template sets the sections and annexures the bank expects.</p>{user?.role === 'FIRM_ADMIN' ? <button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void installDefaults()}>Install the standard templates</button> : <small>Ask a firm admin to install the standard templates.</small>}</div> : <>
            {canPrepare && <div className="qr-layout"><b>Report layout</b><div role="group" aria-label="Report layout">{(formatInfo.data?.formats ?? []).map((f) => <button key={f.id} type="button" className={bankFormat === f.id ? 'is-on' : ''} onClick={() => { setLayout(f.id); setQc(null) }}>{f.label}</button>)}<button type="button" className={!bankFormat ? 'is-on' : ''} onClick={() => { setLayout('GENERIC'); setQc(null) }}>Standard template</button></div>
              {bankFormat ? <small>The report is the bank’s own form, filled from the answers saved for it. <Link to={`/assignments/${id}/bank-report?format=${bankFormat}`}>Fill in or check the bank report →</Link></small> : <small>The firm’s own template PDF, not the bank’s form.</small>}</div>}
            {canPrepare && <div className="qr-prep"><label className="va-f">Template<select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setQc(null) }}><option value="">Choose a template…</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>)}</select></label>
              {everIssued && <label className="va-f is-wide">Why a new report is needed<input minLength={10} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Required because a report was already issued" /></label>}
              <button type="button" className="pd-btn is-primary" disabled={!templateId || busy || !reviewing || (everIssued && changeReason.trim().length < 10)} onClick={() => void createReport()}>{report && !stale ? 'Prepare again' : 'Create draft report'}</button></div>}
            {templateId && <div className="qr-qc-wrap"><h4>Quality checks {qcBusy && <em>checking…</em>}</h4>{qc ? <QcPanel qc={qc} id={id} /> : !qcBusy && <p className="pd-muted">Choose a template to run the checks.</p>}</div>}
          </>}
        </section>

        {report && <section className="pd-card" aria-labelledby="qr-cur-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">C</span><div><h2 id="qr-cur-h">Report R{report.versionNumber}</h2><p>{report.template.name} v{report.template.version} · prepared by {rep?.author ?? 'unknown'} on {new Date(report.createdAt).toLocaleDateString('en-IN')}</p></div></div>
            <div className="qr-actions">{report.bankFormat && <span className="pd-pill is-type">{report.bankFormat} layout</span>}<button type="button" className="pd-btn is-ghost" onClick={() => setShowPdf(!showPdf)}>{showPdf ? 'Hide preview' : 'Preview PDF'}</button>{report.docxKey && <button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/reports/${report.id}/file?kind=docx`).catch((c: unknown) => setError(errorMessage(c)))}>Word (.docx)</button>}<button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/reports/${report.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>Open ↗</button></div></div>
          {stale && <p className="pd-flag">This report was built from an older valuation. Prepare a new one above.</p>}
          <ol className="in-timeline">{FLOW.map(([key, label], i) => <li key={key} className={i < flowIndex ? 'is-done' : i === flowIndex ? 'is-now' : ''}><span>{i < flowIndex ? '✓' : i + 1}</span>{label}</li>)}</ol>
          {showPdf && <ReportPreview reportId={report.id} />}
          <h4 className="qr-sub">Report quality checks</h4>
          <QcPanel qc={report.qc} id={id} />
          <div className="qr-actions qr-signoff">
            {report.status === 'DRAFT' && canPrepare && <button type="button" className="pd-btn is-primary" disabled={busy || !report.qc.passed || stale} title={!report.qc.passed ? 'Fix the failed checks first' : undefined} onClick={() => void move('submit-for-review')}>Send report for review</button>}
            {report.status === 'IN_REVIEW' && canApprove && (mine(rep?.author ?? null) ? <span className="pd-muted">You prepared this report, so someone else must approve it.</span> : <button type="button" className="pd-btn is-primary" disabled={busy || stale || (checklist.data ? checklistDone < checklist.data.length : false) || v?.status !== 'APPROVED'} title={v?.status !== 'APPROVED' ? 'Approve the valuation first' : undefined} onClick={() => void move('approve')}>Approve report</button>)}
            {report.status === 'DRAFT' && !report.qc.passed && <span className="pd-muted">The report cannot go for review until the required checks pass.</span>}
            {report.status === 'IN_REVIEW' && checklist.data && checklistDone < checklist.data.length && <span className="pd-muted">Tick every checklist item to approve.</span>}
            {report.status === 'IN_REVIEW' && v && v.status !== 'APPROVED' && <span className="pd-muted">Approve the valuation first.</span>}
          </div>
        </section>}


        {report && <section className="pd-card qr-seal" aria-labelledby="qr-seal-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">✍</span><div><h2 id="qr-seal-h">Valuer signature &amp; seal</h2><p>Sign-off record for this report.</p></div></div><span className={`pd-pill ${report.approvedAt ? 'is-verified' : 'is-warn'}`}>{report.approvedAt ? 'Signed off' : 'Awaiting sign-off'}</span></div>
          <dl className="qr-seal-grid"><div><dt>Prepared by</dt><dd>{rep?.author ?? 'unknown'}</dd></div><div><dt>Report</dt><dd>R{report.versionNumber} · {report.template.name}</dd></div><div><dt>Approved on</dt><dd>{report.approvedAt ? new Date(report.approvedAt).toLocaleString('en-IN') : 'Not yet'}</dd></div><div><dt>Issued on</dt><dd>{report.issuedAt ? new Date(report.issuedAt).toLocaleString('en-IN') : 'Not yet'}</dd></div></dl>
          <p className="qr-meta">Approval is recorded against the signed-in person with the time. A certificate-based digital signature (for example an e-sign provider) is not connected yet.</p>
        </section>}

        {(reports.data?.length ?? 0) > 1 && <section className="pd-card" aria-labelledby="qr-hist-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">D</span><div><h2 id="qr-hist-h">Report history</h2><p>Earlier drafts are kept. Issued reports are never changed.</p></div></div></div>
          <div className="qr-history">{reports.data?.map((x) => <div key={x.id}><b>R{x.versionNumber}</b><span>{x.template.name} v{x.template.version}</span><span className={`pd-pill is-${x.status === 'APPROVED' || x.status === 'ISSUED' ? 'verified' : x.status === 'IN_REVIEW' ? 'submitted' : x.status === 'DRAFT' ? 'warn' : 'type'}`}>{x.status.replace('_', ' ').toLowerCase()}</span><small>{new Date(x.createdAt).toLocaleDateString('en-IN')}</small><button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/reports/${x.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>Open</button></div>)}</div>
        </section>}
      </div>

      <aside className="pd-aside"><ReadyCard title="Ready to approve?" readiness={r} summary={!r ? '' : r.canProceed ? 'Both sign-offs are in. You can move on.' : 'The valuation and the report each need a second person’s approval.'}>
        {a.status === 'QUALITY_REVIEW' ? (canPrepare ? <>
          <button type="button" className="pd-btn is-primary is-block" disabled={!r?.canProceed || busy} onClick={() => void advance()}>Continue to Approval &amp; Submission →</button>
          <div className="qr-returns"><small>Not ready? Return it:</small>
            <button type="button" className="pd-btn is-ghost is-block" disabled={busy} onClick={() => setConfirmBack(true)}>↩ Return to drafter</button>
            <button type="button" className="pd-btn is-ghost is-block" disabled={busy} onClick={() => void returnTo(['VALUATION', 'INSPECTION'], stepPath(2, id))}>⛑ Request re-inspection</button>
            <button type="button" className="pd-btn is-ghost is-block" disabled={busy} onClick={() => void returnTo(['VALUATION', 'INSPECTION', 'DOCUMENTS'], stepPath(1, id))}>▤ Request more documents</button></div>
          {confirmBack ? <div className="pd-confirm in-gap"><b>Send back to valuation?</b><p>The reviewer’s comments are not recorded here, so tell the valuer why. The valuation can then be revised.</p><div><button type="button" className="pd-btn is-ghost" onClick={() => setConfirmBack(false)}>Not yet</button><button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void sendBack()}>Send back</button></div></div> : null}
        </> : <p className="pd-muted">Only a valuer or admin can move this assignment forward.</p>)
          : stepNow > 4 ? <div className="pd-moved"><b>Already in {ASSIGNMENT_STATUS_LABELS[a.status]}</b><Link to={stepPath(Math.min(stepNow, 5), a.id)} className="pd-btn is-primary">Open next step →</Link></div> : null}
        <Link to={stepPath(3, a.id)} className="pd-save-exit">← Back to Valuation Workings</Link>
      </ReadyCard></aside>
    </div>
  </div>
}
