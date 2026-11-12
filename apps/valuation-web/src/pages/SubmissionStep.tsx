import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ASSIGNMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS, type DocumentType } from '@value-hub/valuation-shared'
import InvoiceCard, { RaiseInvoice, type Invoice } from '../components/InvoiceBlock.tsx'
import { ReadyCard, StageBanner, StepHeader, STEP_OF_STATUS, stepPath, type AssignmentHead, type Readiness } from '../components/WorkflowParts.tsx'
import { ErrorText, errorMessage, formatInr, formatDate } from '../components/ui.tsx'
import { api, openFile, type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Context {
  status: string; emailEnabled: boolean; retainUntil: string | null; closedAt: string | null
  valuation: { id: string; versionNumber: number; status: string; totalValue: string; approvedAt: string | null; approvedBy: string | null } | null
  report: { id: string; versionNumber: number; status: string; approvedAt: string | null; approvedBy: string | null; issuedAt: string | null; issuedBy: string | null; sha256: string; forLatestValuation: boolean } | null
  invoices: { code: string; amount: string; status: string }[]
  closeProblems: string[]; readiness: Readiness
}
interface Submission { id: string; channel: string; recipient: string; sentAt: string; deliveryStatus: 'RECORDED' | 'SENT' | 'FAILED'; deliveryError: string | null; acknowledgedAt: string | null; note: string | null; reportVersion: { versionNumber: number } }
interface BankQuery { id: string; code: string; kind: 'QUERY' | 'REVISION_REQUEST'; question: string; receivedAt: string; dueAt: string; status: 'OPEN' | 'RESPONDED' | 'CLOSED'; response: string | null; respondedAt: string | null; responseSentTo: string | null; responseDelivery: string | null; escalatedAt: string | null; escalationNote: string | null }
interface Doc { id: string; type: DocumentType; fileName: string }

const CHANNELS = [
  ['EMAIL', 'Email', 'Sends the issued PDF as an attachment', 'Recipient email address'],
  ['PORTAL', 'Bank portal', 'You upload it, then record it here', 'Portal name and reference'],
  ['COURIER', 'Courier', 'Record the docket once it is dispatched', 'Courier and docket number'],
  ['HAND_DELIVERY', 'Hand delivery', 'Record who took it and to whom', 'Name of person and branch'],
] as const
const DELIVERY = { RECORDED: ['Recorded', 'is-submitted'], SENT: ['Sent', 'is-submitted'], FAILED: ['Failed', 'is-warn'] } as const
const today = () => new Date().toISOString().slice(0, 10)
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const overdue = (q: BankQuery) => q.status === 'OPEN' && new Date(q.dueAt) < new Date(new Date().toDateString())

export default function SubmissionStep() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canAct = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canAsk = canAct || user?.role === 'REVIEWER'
  const canBill = user?.role === 'FIRM_ADMIN' || user?.role === 'ACCOUNTS'
  const assignment = useFetch<AssignmentHead>(`/assignments/${id}`)
  const context = useFetch<Context>(`/assignments/${id}/submission-context`)
  const submissions = useFetch<Submission[]>(`/assignments/${id}/submissions`)
  const queries = useFetch<Paginated<BankQuery>>(`/queries?assignmentId=${id}&pageSize=100`)
  const docs = useFetch<Paginated<Doc>>(docsPath(assignment.data))
  const invoiceList = useFetch<Paginated<Invoice>>(`/invoices?assignmentId=${id}&pageSize=50`)
  const a = assignment.data
  const ctx = context.data
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftNeeds, setDraftNeeds] = useState<string[]>([])
  const [confirmIssue, setConfirmIssue] = useState(false)
  const [send, setSend] = useState({ channel: 'PORTAL' as (typeof CHANNELS)[number][0], recipient: '', note: '' })
  const [ack, setAck] = useState<{ id: string; date: string; note: string } | null>(null)
  const [asking, setAsking] = useState(false)
  const [ask, setAsk] = useState({ kind: 'QUERY' as BankQuery['kind'], question: '', receivedAt: today(), dueAt: inDays(5) })
  const [replying, setReplying] = useState<{ id: string; response: string; sendTo: string; evidence: string[] } | null>(null)
  const [escalating, setEscalating] = useState<{ id: string; note: string } | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)

  const reloadAll = () => { assignment.reload(); context.reload(); submissions.reload(); queries.reload(); invoiceList.reload() }
  async function run(action: () => Promise<unknown>, ok?: string) {
    setError(null); setNotice(null); setBusy(true)
    try { await action(); if (ok) setNotice(ok); reloadAll() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  const issue = () => ctx?.report && run(async () => { await api.post(`/reports/${ctx.report?.id}/issue`, {}); setConfirmIssue(false) }, 'Final report issued and locked.')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ctx?.report) return
    void run(async () => {
      const result = await api.post<{ submission: Submission; assignmentAdvanced: boolean }>(`/assignments/${id}/submissions`, { reportVersionId: ctx.report?.id, channel: send.channel, recipient: send.recipient.trim(), ...(send.note.trim() && { note: send.note.trim() }) })
      setSend({ ...send, recipient: '', note: '' })
      if (result.submission.deliveryStatus === 'FAILED') throw new Error(`The email could not be sent: ${result.submission.deliveryError ?? 'unknown error'}. It is recorded as failed. Try again or record another channel.`)
      setNotice(result.assignmentAdvanced ? 'Submitted. The assignment is now with the bank.' : 'Submission recorded.')
    })
  }
  const acknowledge = (event: FormEvent) => { event.preventDefault(); if (!ack) return; void run(async () => { await api.post(`/submissions/${ack.id}/acknowledge`, { acknowledgedAt: new Date(`${ack.date}T12:00:00`).toISOString(), ...(ack.note.trim() && { note: ack.note.trim() }) }); setAck(null) }, 'Acknowledgement recorded.') }
  const addQuery = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await api.post(`/assignments/${id}/queries`, { kind: ask.kind, question: ask.question.trim(), receivedAt: new Date(`${ask.receivedAt}T09:00:00`).toISOString(), dueAt: new Date(`${ask.dueAt}T18:00:00`).toISOString() })
      setAsking(false); setAsk({ ...ask, question: '' })
    }, ask.kind === 'REVISION_REQUEST' ? 'Revision request recorded. The assignment is reopened for revision.' : 'Bank query recorded.')
  }
  // A starting point from the assignment's records; the reply is only changed in the box, never sent.
  const draftReply = () => {
    if (!replying) return
    const queryId = replying.id
    setError(null); setNotice(null); setBusy(true)
    api.post<{ reply: string; needsInput: string[] }>(`/queries/${queryId}/draft-reply`, {})
      .then((draft) => { setReplying((current) => (current && current.id === queryId ? { ...current, response: draft.reply } : current)); setDraftNeeds(draft.needsInput) })
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setBusy(false))
  }
  const respond = (event: FormEvent) => {
    event.preventDefault()
    if (!replying) return
    void run(async () => {
      const refs = replying.evidence.map((e) => { const [type, refId] = e.split(':'); return { type, id: refId } })
      await api.post(`/queries/${replying.id}/respond`, { response: replying.response.trim(), ...(refs.length && { evidence: refs }), ...(replying.sendTo.trim() && { sendTo: replying.sendTo.trim() }) })
      setReplying(null)
    }, 'Response recorded.')
  }
  const escalate = (event: FormEvent) => { event.preventDefault(); if (!escalating) return; void run(async () => { await api.post(`/queries/${escalating.id}/escalate`, { note: escalating.note.trim() }); setEscalating(null) }, 'Query escalated.') }
  const closeQuery = (qid: string) => run(() => api.post(`/queries/${qid}/close`, {}), 'Query closed.')
  async function closeAssignment() {
    setBusy(true); setError(null)
    try { await api.patch(`/assignments/${id}/status`, { status: 'CLOSED' }); setConfirmClose(false); reloadAll() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  if (assignment.error) return <div className="pd-shell"><ErrorText message={assignment.error} /><Link to="/assignments" className="pd-back">← Assignment Inbox</Link></div>
  if (!a) return <div className="pd-shell"><p className="pd-muted">Loading assignment…</p></div>
  const stepNow = STEP_OF_STATUS[a.status]
  const rep = ctx?.report ?? null
  const val = ctx?.valuation ?? null
  const issued = rep?.status === 'ISSUED'
  const sentOk = (submissions.data ?? []).some((s) => s.deliveryStatus !== 'FAILED')
  const channel = CHANNELS.find(([k]) => k === send.channel)
  const stage = a.status
  const preSubmit = ['QUALITY_REVIEW', 'APPROVED'].includes(stage)
  const open = (queries.data?.items ?? []).filter((q) => q.status === 'OPEN')
  const emailBlocked = send.channel === 'EMAIL' && ctx && !ctx.emailEnabled

  return <div className="pd-shell">
    <StageBanner icon="✉" title="Dispatch & Billing" line={`Case Ref: ${a.code} · ${a.bank.name}`} asideLabel="Status" aside={stage.replace('_', ' ')} />
    <StepHeader a={a} here={5} eyebrow="STEP 6 · APPROVAL & SUBMISSION" title="Approval & Submission" subtitle="Lock the final report, send it to the bank, record that it arrived, and answer whatever the bank asks next." />
    {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
    <ErrorText message={error ?? context.error ?? submissions.error ?? queries.error} />
    {stage === 'REVISION' && <p className="pd-flag">The bank asked for a revision, so this assignment is back in revision. <Link to={stepPath(3, id)}>Revise the valuation</Link>, then prepare, approve and issue a new report here.</p>}
    {stage === 'CLOSED' && <p className="pd-notice" role="status">This assignment is closed{ctx?.closedAt ? ` (${formatDate(ctx.closedAt)})` : ''}{ctx?.retainUntil ? `. Records are kept until ${formatDate(ctx.retainUntil)}.` : '.'}</p>}
    {preSubmit && stage === 'QUALITY_REVIEW' && <p className="pd-flag">Quality review is not finished yet. <Link to={stepPath(4, id)}>Complete it</Link> to unlock issuing and submission.</p>}

    <div className="pd-grid">
      <div className="pd-main">
        <section className="pd-card" aria-labelledby="sb-trail-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">A</span><div><h2 id="sb-trail-h">Approval trail</h2><p>Who signed off what. Issuing locks the report; it is never edited after this.</p></div></div></div>
          {!val ? <div className="pd-empty"><b>No valuation yet</b><p>Complete the earlier steps first.</p></div> : <ol className="sb-trail">
            <li className="is-done"><span>✓</span><div><b>Valuation approved</b><small>Version {val.versionNumber} · ₹ {formatInr(val.totalValue)}{val.approvedBy ? ` · by ${val.approvedBy}` : ''}{val.approvedAt ? ` · ${formatDate(val.approvedAt)}` : ''}</small></div></li>
            <li className={rep && ['APPROVED', 'ISSUED'].includes(rep.status) ? 'is-done' : ''}><span>{rep && ['APPROVED', 'ISSUED'].includes(rep.status) ? '✓' : '2'}</span><div><b>Report approved</b><small>{rep && ['APPROVED', 'ISSUED'].includes(rep.status) ? `R${rep.versionNumber}${rep.approvedBy ? ` · by ${rep.approvedBy}` : ''}${rep.approvedAt ? ` · ${formatDate(rep.approvedAt)}` : ''}` : 'Waiting for quality review'}</small></div></li>
            <li className={issued ? 'is-done' : rep?.status === 'APPROVED' ? 'is-now' : ''}><span>{issued ? '✓' : '3'}</span><div><b>Final report issued</b><small>{issued ? `R${rep?.versionNumber} · ${rep?.issuedBy ? `by ${rep.issuedBy} · ` : ''}${rep?.issuedAt ? formatDate(rep.issuedAt) : ''} · fingerprint ${rep?.sha256.slice(0, 12)}…` : 'Not issued yet'}</small></div></li>
            <li className={sentOk ? 'is-done' : issued ? 'is-now' : ''}><span>{sentOk ? '✓' : '4'}</span><div><b>Submitted to the bank</b><small>{sentOk ? 'Hand-over recorded below' : 'Not sent yet'}</small></div></li>
          </ol>}
          {rep && issued && <div className="qr-actions"><button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/reports/${rep.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>Open the final report ↗</button></div>}
          {rep?.status === 'APPROVED' && canAct && (confirmIssue
            ? <div className="pd-confirm"><b>Issue report R{rep.versionNumber}?</b><p>It is locked and the final PDF is drawn from the approved snapshot, with every attached file checked against its recorded fingerprint. A later correction needs a new version with a reason.</p><div><button type="button" className="pd-btn is-ghost" onClick={() => setConfirmIssue(false)}>Not yet</button><button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void issue()}>{busy ? 'Issuing…' : 'Issue final report'}</button></div></div>
            : <div className="qr-actions"><button type="button" className="pd-btn is-primary" onClick={() => setConfirmIssue(true)}>Issue final report…</button></div>)}
          {rep?.status === 'APPROVED' && !canAct && <p className="pd-muted">Only a valuer or admin can issue the report.</p>}
        </section>

        <section className="pd-card" aria-labelledby="sb-send-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">B</span><div><h2 id="sb-send-h">Submit to the bank</h2><p>“Sent” means the mail server accepted it. The bank’s acknowledgement is recorded by you, never assumed.</p></div></div></div>
          {issued && canAct && stage !== 'CLOSED' && <form onSubmit={submit} className="sb-send">
            <div className="sb-channels" role="group" aria-label="Channel">{CHANNELS.map(([key, label, hint]) => <button key={key} type="button" className={send.channel === key ? 'is-on' : ''} onClick={() => setSend({ ...send, channel: key })}><b>{label}</b><small>{hint}</small></button>)}</div>
            {emailBlocked && <p className="pd-flag">Email is not set up on this server (SMTP). Record the submission under another channel, or ask an admin to configure it.</p>}
            <div className="va-grid"><F label={channel?.[3] ?? 'Recipient'} wide><input required minLength={3} type={send.channel === 'EMAIL' ? 'email' : 'text'} value={send.recipient} onChange={(e) => setSend({ ...send, recipient: e.target.value })} /></F>
              <F label="Note (optional)" wide><input maxLength={1000} value={send.note} onChange={(e) => setSend({ ...send, note: e.target.value })} placeholder="Anything the bank or your team should know" /></F></div>
            <div className="va-actions"><button className="pd-btn is-primary" disabled={busy || !!emailBlocked}>{busy ? 'Sending…' : send.channel === 'EMAIL' ? `Email report R${rep?.versionNumber}` : 'Record submission'}</button></div>
          </form>}
          {!issued && stage !== 'CLOSED' && <div className="pd-empty"><b>Issue the final report first</b><p>Only an issued report can be sent to the bank.</p></div>}
          {(submissions.data?.length ?? 0) > 0 && <div className="sb-subs"><h4>Hand-overs</h4>{submissions.data?.map((s) => <article key={s.id}>
            <div><b>R{s.reportVersion.versionNumber} via {s.channel.toLowerCase().replace('_', ' ')}</b><small>To {s.recipient} · {new Date(s.sentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{s.note ? ` · ${s.note}` : ''}</small>{s.deliveryError && <small className="is-bad">{s.deliveryError}</small>}</div>
            <span className={`pd-pill ${DELIVERY[s.deliveryStatus][1]}`}>{DELIVERY[s.deliveryStatus][0]}</span>
            {s.acknowledgedAt ? <span className="pd-pill is-verified">Acknowledged {formatDate(s.acknowledgedAt)}</span> : s.deliveryStatus !== 'FAILED' && canAct && (ack?.id === s.id ? null : <button type="button" className="pd-btn is-ghost" onClick={() => setAck({ id: s.id, date: today(), note: '' })}>Record acknowledgement</button>)}
            {ack?.id === s.id && <form className="in-inline-form sb-ack" onSubmit={acknowledge}><label>Acknowledged on<input type="date" required max={today()} value={ack.date} onChange={(e) => setAck({ ...ack, date: e.target.value })} /></label><label>Note<input value={ack.note} onChange={(e) => setAck({ ...ack, note: e.target.value })} placeholder="Who confirmed, how" /></label><div><button type="button" className="pd-btn is-ghost" onClick={() => setAck(null)}>Cancel</button><button className="pd-btn is-primary" disabled={busy}>Save</button></div></form>}
          </article>)}</div>}
        </section>

        <section className="pd-card" aria-labelledby="sb-q-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">C</span><div><h2 id="sb-q-h">Bank queries &amp; revisions</h2><p>Record what the bank asks, answer with evidence, and close it. A revision request reopens the assignment.</p></div></div>{canAsk && !asking && stage !== 'CANCELLED' && <button type="button" className="pd-btn is-primary" onClick={() => setAsking(true)}>＋ Record a query</button>}</div>
          {asking && <form className="va-block" onSubmit={addQuery}>
            <div className="va-seg" role="group" aria-label="Kind">{([['QUERY', 'Question'], ['REVISION_REQUEST', 'Revision request']] as const).map(([k, l]) => <button key={k} type="button" className={ask.kind === k ? 'is-on' : ''} onClick={() => setAsk({ ...ask, kind: k })}>{l}</button>)}</div>
            {ask.kind === 'REVISION_REQUEST' && <p className="pd-flag">{stage === 'SUBMITTED' ? 'This reopens the assignment for revision. The corrected valuation and report become new versions; nothing issued is edited.' : 'A revision can only be requested while the assignment is submitted, before it is closed.'}</p>}
            <div className="va-grid"><F label="What the bank asked" wide><textarea required minLength={5} rows={3} value={ask.question} onChange={(e) => setAsk({ ...ask, question: e.target.value })} /></F>
              <F label="Received on"><input type="date" required max={today()} value={ask.receivedAt} onChange={(e) => setAsk({ ...ask, receivedAt: e.target.value })} /></F>
              <F label="Reply due by"><input type="date" required min={ask.receivedAt} value={ask.dueAt} onChange={(e) => setAsk({ ...ask, dueAt: e.target.value })} /></F></div>
            <div className="va-actions"><button type="button" className="pd-btn is-ghost" onClick={() => setAsking(false)}>Cancel</button><button className="pd-btn is-primary" disabled={busy || (ask.kind === 'REVISION_REQUEST' && stage !== 'SUBMITTED')}>Record</button></div></form>}
          {(queries.data?.items.length ?? 0) === 0 ? <div className="pd-empty"><b>No queries from the bank</b><p>When one arrives, record it here so it is tracked and answered on time.</p></div> : <div className="sb-queries">{queries.data?.items.map((q) => <article key={q.id} className={`is-${q.status.toLowerCase()} ${overdue(q) ? 'is-late' : ''}`}>
            <div className="sb-q-top"><b>{q.code}</b><span className={`pd-pill ${q.kind === 'REVISION_REQUEST' ? 'is-warn' : 'is-type'}`}>{q.kind === 'REVISION_REQUEST' ? 'Revision request' : 'Question'}</span><span className={`pd-pill ${q.status === 'OPEN' ? 'is-warn' : q.status === 'RESPONDED' ? 'is-submitted' : 'is-verified'}`}>{q.status.toLowerCase()}</span>{q.escalatedAt && <span className="pd-pill is-unknown">escalated</span>}<small className={overdue(q) ? 'is-bad' : ''}>{overdue(q) ? 'Overdue · ' : ''}due {formatDate(q.dueAt)}</small></div>
            <p className="sb-q-text">{q.question}</p>
            {q.escalationNote && <p className="va-reason">Escalated: {q.escalationNote}</p>}
            {q.response && <div className="sb-q-reply"><b>Our response {q.respondedAt ? `· ${formatDate(q.respondedAt)}` : ''}</b><p>{q.response}</p>{q.responseSentTo && <small>Emailed to {q.responseSentTo} ({(q.responseDelivery ?? '').toLowerCase()})</small>}</div>}
            <div className="qr-actions">
              {q.status === 'OPEN' && canAct && replying?.id !== q.id && <button type="button" className="pd-btn is-primary" onClick={() => setReplying({ id: q.id, response: '', sendTo: '', evidence: [] })}>Respond</button>}
              {q.status === 'OPEN' && canAsk && !q.escalatedAt && escalating?.id !== q.id && <button type="button" className="pd-btn is-ghost" onClick={() => setEscalating({ id: q.id, note: '' })}>Escalate</button>}
              {q.status === 'RESPONDED' && canAct && <button type="button" className="pd-btn is-ok" disabled={busy} onClick={() => void closeQuery(q.id)}>Close query</button>}
              {q.kind === 'REVISION_REQUEST' && stage === 'REVISION' && q.status === 'OPEN' && <Link to={stepPath(3, id)} className="pd-btn is-ghost">Revise the valuation →</Link>}
            </div>
            {escalating?.id === q.id && <form className="in-inline-form" onSubmit={escalate}><label className="sb-grow">Why escalate<input required minLength={5} value={escalating.note} onChange={(e) => setEscalating({ ...escalating, note: e.target.value })} /></label><div><button type="button" className="pd-btn is-ghost" onClick={() => setEscalating(null)}>Cancel</button><button className="pd-btn is-primary" disabled={busy}>Escalate</button></div></form>}
            {replying?.id === q.id && <form className="va-block" onSubmit={respond}>
              <F label="Response to the bank" wide><textarea required minLength={5} rows={4} value={replying.response} onChange={(e) => setReplying({ ...replying, response: e.target.value })} /></F>
              <div className="flex flex-wrap items-center gap-2"><button type="button" className="pd-btn is-ghost" disabled={busy} onClick={draftReply}>Draft reply with AI</button><span className="pd-muted">A starting point from this assignment's records. Check it before you send.</span></div>
              {draftNeeds.length > 0 && <div className="pd-muted"><b>Not in the records, please add:</b><ul>{draftNeeds.map((n) => <li key={n}>{n}</li>)}</ul></div>}
              <div className="sb-evidence"><b>Evidence this relies on</b>
                {val && <label><input type="checkbox" checked={replying.evidence.includes(`valuation:${val.id}`)} onChange={(e) => setReplying({ ...replying, evidence: toggle(replying.evidence, `valuation:${val.id}`, e.target.checked) })} /> Valuation version {val.versionNumber}</label>}
                {rep && <label><input type="checkbox" checked={replying.evidence.includes(`report:${rep.id}`)} onChange={(e) => setReplying({ ...replying, evidence: toggle(replying.evidence, `report:${rep.id}`, e.target.checked) })} /> Report R{rep.versionNumber}</label>}
                {docs.data?.items.map((d) => <label key={d.id}><input type="checkbox" checked={replying.evidence.includes(`document:${d.id}`)} onChange={(e) => setReplying({ ...replying, evidence: toggle(replying.evidence, `document:${d.id}`, e.target.checked) })} /> {DOCUMENT_TYPE_LABELS[d.type]}: {d.fileName}</label>)}</div>
              <div className="va-grid"><F label={ctx?.emailEnabled ? 'Also email the response to (optional)' : 'Email is not set up on this server'} wide><input type="email" disabled={!ctx?.emailEnabled} value={replying.sendTo} onChange={(e) => setReplying({ ...replying, sendTo: e.target.value })} /></F></div>
              <div className="va-actions"><button type="button" className="pd-btn is-ghost" onClick={() => setReplying(null)}>Cancel</button><button className="pd-btn is-primary" disabled={busy}>Record response</button></div></form>}
          </article>)}</div>}
        </section>

        <section className="pd-card" aria-labelledby="sb-close-h">
          <div className="pd-card-head"><div><span className="pd-step-tag">D</span><div><h2 id="sb-close-h">Invoice &amp; close</h2><p>Raise the fee, then close the assignment once the bank has what it needs.</p></div></div><Link to="/accounts" className="pd-btn is-ghost">Open Accounts ↗</Link></div>
          {(invoiceList.data?.items.length ?? 0) > 0 ? invoiceList.data?.items.map((inv) => <InvoiceCard key={inv.id} invoice={inv} canBill={canBill} isAdmin={user?.role === 'FIRM_ADMIN'} onChange={reloadAll} showAssignment={false} />) : <p className="pd-muted">No invoice raised for this assignment yet.</p>}
          {canBill && ['SUBMITTED', 'CLOSED'].includes(stage) && <RaiseInvoice assignmentId={id} fee={a.fee ?? null} invoiced={(invoiceList.data?.items ?? []).filter((i) => i.status !== 'CANCELLED').reduce((t, i) => t + Number(i.amount), 0)} onDone={reloadAll} />}
          {!canBill && <p className="pd-muted">Invoices are raised by the firm admin or accounts. {a.fee ? `Agreed fee ₹ ${formatInr(a.fee)}.` : 'No fee is recorded on this assignment.'}</p>}
          {canBill && !['SUBMITTED', 'CLOSED'].includes(stage) && <p className="pd-muted">An invoice can be raised once the report has been submitted to the bank.</p>}
          {stage === 'SUBMITTED' && <>
            {ctx && ctx.closeProblems.length > 0 ? <div className="va-todo"><b>Before closing ({ctx.closeProblems.length})</b><ul>{ctx.closeProblems.map((p) => <li key={p}>{p}</li>)}</ul></div> : <p className="pd-notice">Everything needed for the archive is on record.</p>}
            {canAct && (confirmClose ? <div className="pd-confirm"><b>Close this assignment?</b><p>It becomes read-only and its retention period starts. A closed assignment cannot be reopened, so settle any revision requests first.</p><div><button type="button" className="pd-btn is-ghost" onClick={() => setConfirmClose(false)}>Not yet</button><button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void closeAssignment()}>{busy ? 'Closing…' : 'Close assignment'}</button></div></div>
              : <div className="qr-actions"><button type="button" className="pd-btn is-primary" disabled={!ctx || ctx.closeProblems.length > 0 || busy} onClick={() => setConfirmClose(true)}>Close assignment…</button></div>)}
          </>}
        </section>
      </div>

      <aside className="pd-aside"><ReadyCard title={stage === 'CLOSED' ? 'Assignment closed' : 'Ready to close?'} readiness={ctx?.readiness ?? null} summary={!ctx ? '' : stage === 'CLOSED' ? 'The file is archived.' : ctx.readiness.canProceed ? 'Everything is on record. You can close it.' : 'Issue, send and answer the bank, then close.'}>
        {open.length > 0 && <p className="pd-flag">{open.length} open bank quer{open.length === 1 ? 'y' : 'ies'}{open.some(overdue) ? ', some overdue' : ''}.</p>}
        {stage === 'SUBMITTED' && canAct && <button type="button" className="pd-btn is-primary is-block" disabled={!ctx?.readiness.canProceed || busy} onClick={() => setConfirmClose(true)}>Close assignment…</button>}
        {stepNow >= 6 || stage === 'CLOSED' ? <div className="pd-moved in-gap"><b>{ASSIGNMENT_STATUS_LABELS[stage]}</b><button type="button" className="pd-btn is-ghost" onClick={() => navigate('/assignments')}>Back to the inbox</button></div> : null}
        <Link to={stepPath(4, a.id)} className="pd-save-exit">← Back to Quality Review</Link>
      </ReadyCard></aside>
    </div>
  </div>
}

function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`va-f ${wide ? 'is-wide' : ''}`}>{label}{children}</label> }
const toggle = (list: string[], item: string, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item))
function docsPath(a: AssignmentHead | null): string | null { return a ? `/documents?propertyId=${a.property.id}&pageSize=100` : null }
