import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorText, errorMessage, formatDate, PageHeader } from '../components/ui.tsx'
import { api, downloadFile, openFile } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

type Match = 'match' | 'differs' | 'document_only' | 'site_only' | 'none' | 'check' | null
interface Item { key: string; label: string; value: string; document: string; site: string; match: Match; checked: boolean; note: string }
interface State {
  format: string; formatLabel: string; items: Item[]
  evidence: { checked: boolean; note: string; summary: string; comparables: { id: string; location: string; source: string; ratePerSqm: number; observedOn: string; verified: boolean; isTransaction: boolean }[] }
  allChecked: boolean; submitted: { at: string; by: string | null } | null
  billing: { id: string; code: string; amount: number; dueOn: string; status: string; paid: number; outstanding: number } | null
  contact: { branch: string; name: string | null; email: string | null; phone: string | null } | null
  rework: { id: string; kind: string; reason: string; dueDate: string | null; revision: number; createdAt: string; resolvedAt: string | null }[]
  openDifferences: number; conflicts: string[]
  finalReport: { id: string; reportNumber: string; revision: number; approvedAt: string; sha256: string; fileName: string; signature: { signerName: string | null; note: string } } | null
  sends: { id: string; channel: string; recipient: string; note: string | null; deliveryStatus: string; deliveryError: string | null; sentAt: string }[]
}
interface Head { fee: string | null }

const PILL: Record<string, { text: string; tone: string }> = {
  match: { text: '✓ Docs and site agree', tone: 'ok' }, differs: { text: '≠ Docs and site differ', tone: 'bad' },
  document_only: { text: 'Not checked on site', tone: 'warn' }, site_only: { text: 'Not in documents', tone: 'warn' }, check: { text: 'Read both', tone: 'warn' },
}
const CHANNELS = [['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email'], ['OTHER', 'Sent another way']] as const
const BASES = [['LAND', 'Land'], ['BUILT_UP', 'Built-up'], ['CARPET', 'Carpet'], ['SUPER_BUILT_UP', 'Super built-up']] as const
const REWORK_KIND: Record<string, string> = { DRAFTER: 'Returned to the drafter', REINSPECTION: 'New site visit requested', DOCUMENTS: 'More documents requested' }
const inr = (n: number) => `₹ ${n.toLocaleString('en-IN')}`

// The valuer's last step: tick each key item, approve (which raises the bill), then send the report to the bank.
export default function ValuerCheck() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const canAct = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const state = useFetch<State>(`/assignments/${id}/dispatch`)
  const head = useFetch<Head>(`/assignments/${id}`)
  const s = state.data
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [channel, setChannel] = useState<(typeof CHANNELS)[number][0]>('WHATSAPP')
  const [recipient, setRecipient] = useState('')
  const [message, setMessage] = useState('')
  const [adding, setAdding] = useState(false)
  const [back, setBack] = useState<'DRAFTER' | 'REINSPECTION' | 'DOCUMENTS' | null>(null)
  const [reopening, setReopening] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [backForm, setBackForm] = useState({ reason: '', dueDate: '' })
  const [comp, setComp] = useState({ location: '', source: '', isTransaction: false, observedOn: new Date().toISOString().slice(0, 10), areaBasis: 'LAND', ratePerSqm: '' })

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name); setError(null)
    try { await action(); state.reload(); head.reload() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(null) }
  }
  const tick = (key: string, checked: boolean, note?: string) => run(`tick-${key}`, () => api.put(`/assignments/${id}/dispatch/checks/${key}`, { checked, ...(note !== undefined && { note }) }))
  const submit = () => run('submit', async () => { await api.post(`/assignments/${id}/dispatch/submit`, amount ? { amount: Number(amount) } : {}); setNotice('Report approved and the bill raised.') })
  const pickChannel = (c: (typeof CHANNELS)[number][0]) => { setChannel(c); setRecipient(c === 'EMAIL' ? s?.contact?.email ?? '' : c === 'WHATSAPP' ? s?.contact?.phone ?? '' : '') }
  const send = () => run('send', async () => {
    const result = await api.post<{ whatsappLink: string | null; note: string | null; send: { deliveryStatus: string; deliveryError: string | null } }>(`/assignments/${id}/dispatch/send`, { channel, recipient, ...(message.trim() && { note: message.trim() }) })
    if (result.whatsappLink) window.open(result.whatsappLink, '_blank', 'noopener')
    if (result.send.deliveryStatus === 'FAILED') throw new Error(`The email could not be sent: ${result.send.deliveryError ?? 'unknown error'}. It is recorded as failed.`)
    setNotice(result.note ?? (result.send.deliveryStatus === 'SENT' ? 'Sent, and recorded.' : 'Recorded. Attach the downloaded report in the message that just opened.'))
  })
  const addComparable = () => run('comp', async () => {
    await api.post(`/assignments/${id}/comparables`, { ...comp, ratePerSqm: Number(comp.ratePerSqm) })
    setComp({ ...comp, location: '', source: '', ratePerSqm: '' }); setAdding(false)
  })
  const sendBack = () => run('back', async () => { await api.post(`/assignments/${id}/dispatch/rework`, { kind: back, reason: backForm.reason, ...(backForm.dueDate && { dueDate: backForm.dueDate }) }); setBack(null); setBackForm({ reason: '', dueDate: '' }); setNotice('Sent back. They have a pop-up.') })
  const reopen = () => run('reopen', async () => { await api.post(`/assignments/${id}/dispatch/reopen`, { reason: reopenReason }); setReopening(false); setReopenReason(''); setNotice('Reopened. The drafter has a pop-up to revise the report.') })
  const verify = (compId: string, verified: boolean) => run(`verify-${compId}`, () => api.patch(`/comparables/${compId}/verify`, { verified }))
  const noFee = !head.data?.fee && !s?.billing

  if (state.error) return <ErrorText message={state.error} />
  if (!s) return <p className="pd-muted">Loading…</p>
  const open = s.items.filter((i) => !i.checked).length + (s.evidence.checked ? 0 : 1)

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Valuer check" title="Check, approve and send" subtitle={`Tick each item against the ${s.formatLabel} report. Approving raises the bill; then send the report to the bank.`}
        action={<div className="flex gap-2"><Link to={`/assignments/${id}/compare`} className="pd-btn is-ghost">Compare</Link><Link to={`/assignments/${id}/bank-report`} className="pd-btn is-ghost">Open the report</Link></div>} />
      <ErrorText message={error} />
      {notice && <p className="pd-notice" role="status">{notice} <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}

      <div className="wb-left"><div className="wb-scroll">
        <table className="cmp-table">
          <thead><tr><th>Item</th><th>In the report</th><th>Documents</th><th>Site</th><th>Checked</th></tr></thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.key} className={i.match === 'differs' ? 'is-bad' : ''}>
                <th scope="row">{i.label}</th>
                <td><b>{i.value || '—'}</b>{i.match && PILL[i.match] && <small><span className={`cmp-pill is-${PILL[i.match].tone}`}>{PILL[i.match].text}</span></small>}</td>
                <td>{i.document || '—'}</td><td>{i.site || '—'}</td>
                <td className="chk-cell">
                  <label className="chk"><input type="checkbox" checked={i.checked} disabled={!canAct || !!s.submitted || busy !== null} onChange={(e) => void tick(i.key, e.target.checked)} /> <span>{i.checked ? 'Checked' : 'Tick'}</span></label>
                  <input className="chk-note" placeholder="Note (optional)" defaultValue={i.note} disabled={!canAct || !!s.submitted} onBlur={(e) => { if (e.target.value !== i.note) void tick(i.key, i.checked, e.target.value) }} />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">Market rate evidence</th>
              <td colSpan={3}>
                <b>{s.evidence.summary}</b>
                {s.evidence.comparables.map((c) => <small key={c.id}>{c.location} · {c.source} · ₹{c.ratePerSqm.toLocaleString('en-IN')}/sq m · {c.isTransaction ? 'transaction' : 'asking'} · {formatDate(c.observedOn)} · {c.verified ? 'verified' : 'not verified'}{canAct && !s.submitted && <> <button type="button" className="chk-link" disabled={busy !== null} onClick={() => void verify(c.id, !c.verified)}>{c.verified ? 'Unverify' : 'Mark verified'}</button></>}</small>)}
                {s.evidence.comparables.length === 0 && <small>No comparable entries yet. Add the dealer, listing or sale you took the rate from.</small>}
                {canAct && !s.submitted && (adding
                  ? <div className="comp-form">
                      <input className="chk-note" placeholder="Where (colony, road, project)" value={comp.location} onChange={(e) => setComp({ ...comp, location: e.target.value })} />
                      <input className="chk-note" placeholder="Source (dealer name and phone, listing site, registry)" value={comp.source} onChange={(e) => setComp({ ...comp, source: e.target.value })} />
                      <input className="chk-note" type="number" min="0.01" step="0.01" placeholder="Rate (₹ per sq m)" value={comp.ratePerSqm} onChange={(e) => setComp({ ...comp, ratePerSqm: e.target.value })} />
                      <select className="chk-note" value={comp.areaBasis} onChange={(e) => setComp({ ...comp, areaBasis: e.target.value })}>{BASES.map(([k, l]) => <option key={k} value={k}>{l} rate</option>)}</select>
                      <select className="chk-note" value={comp.isTransaction ? 'sale' : 'ask'} onChange={(e) => setComp({ ...comp, isTransaction: e.target.value === 'sale' })}><option value="ask">Asking price</option><option value="sale">Actual sale</option></select>
                      <input className="chk-note" type="date" value={comp.observedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setComp({ ...comp, observedOn: e.target.value })} />
                      <span><button type="button" className="pd-btn is-ghost" onClick={() => setAdding(false)}>Cancel</button> <button type="button" className="pd-btn is-primary" disabled={busy !== null || comp.location.trim().length < 3 || comp.source.trim().length < 3 || !Number(comp.ratePerSqm)} onClick={() => void addComparable()}>Add</button></span>
                    </div>
                  : <button type="button" className="pd-btn is-ghost" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>+ Add a comparable</button>)}
              </td>
              <td className="chk-cell">
                <label className="chk"><input type="checkbox" checked={s.evidence.checked} disabled={!canAct || !!s.submitted || busy !== null} onChange={(e) => void tick('market_evidence', e.target.checked)} /> <span>{s.evidence.checked ? 'Checked' : 'Tick'}</span></label>
                <input className="chk-note" placeholder="Source of the rate" defaultValue={s.evidence.note} disabled={!canAct || !!s.submitted} onBlur={(e) => { if (e.target.value !== s.evidence.note) void tick('market_evidence', s.evidence.checked, e.target.value) }} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="wb-actions">
        {s.submitted ? <small className="pd-muted">Approved by {s.submitted.by ?? 'the valuer'} on {formatDate(s.submitted.at)}.</small>
          : <small className="pd-muted">{open === 0 ? 'Everything is ticked.' : `${open} item${open === 1 ? '' : 's'} still to tick.`}</small>}
        {!s.submitted && canAct && <div className="flex items-center gap-2">
          {noFee && <input className="chk-note" type="number" min="1" step="0.01" placeholder="Bill amount (₹), no fee on the case" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 230 }} />}
          <button type="button" className="pd-btn is-primary" disabled={busy !== null} onClick={() => void submit()}>{busy === 'submit' ? 'Approving…' : 'Approve & submit the report'}</button>
        </div>}
      </div></div>

      {!s.submitted && canAct && <div className="wb-left" style={{ padding: 14 }}>
        <h3 className="chk-h">Not ready? Send it back</h3>
        {(s.openDifferences > 0 || s.conflicts.length > 0) && <p className="pd-flag">{s.openDifferences > 0 ? `${s.openDifferences} difference${s.openDifferences === 1 ? '' : 's'} between the documents and the site still need a decision (Compare page). ` : ''}{s.conflicts.length > 0 ? `The documents disagree on ${s.conflicts.join(', ')}. ` : ''}You cannot approve until they are settled.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pd-btn is-ghost" onClick={() => setBack('DRAFTER')}>Return to the drafter</button>
          <button type="button" className="pd-btn is-ghost" onClick={() => setBack('REINSPECTION')}>Ask for a new site visit</button>
          <button type="button" className="pd-btn is-ghost" onClick={() => setBack('DOCUMENTS')}>Ask for more documents</button>
        </div>
        {back && <div className="cmp-form" style={{ maxWidth: 560 }}>
          <b>{REWORK_KIND[back]}</b>
          <input className="ui-input" placeholder="What needs to be done?" value={backForm.reason} onChange={(e) => setBackForm({ ...backForm, reason: e.target.value })} />
          <label className="text-sm">Needed by <input className="ui-input" type="date" min={new Date().toISOString().slice(0, 10)} value={backForm.dueDate} onChange={(e) => setBackForm({ ...backForm, dueDate: e.target.value })} /></label>
          <span><button type="button" className="pd-btn is-ghost" onClick={() => setBack(null)}>Cancel</button> <button type="button" className="pd-btn is-primary" disabled={busy !== null || backForm.reason.trim().length < 3} onClick={() => void sendBack()}>Send back</button></span>
        </div>}
        {s.rework.length > 0 && <ul className="bank-issues" style={{ marginTop: 10 }}>{s.rework.map((r) => <li key={r.id}>Round {r.revision} · {REWORK_KIND[r.kind]}: {r.reason}{r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ''} · {r.resolvedAt ? `done ${formatDate(r.resolvedAt)}` : 'waiting'}</li>)}</ul>}
      </div>}

      {s.submitted && s.finalReport && <div className="wb-left" style={{ padding: 14 }}>
        <h3 className="chk-h">Final report</h3>
        <div className="wb-brief">
          <span><small>Report number</small><b>{s.finalReport.reportNumber}</b></span>
          <span><small>Revision</small><b>{s.finalReport.revision}</b></span>
          <span><small>Approved</small><b>{new Date(s.finalReport.approvedAt).toLocaleString('en-IN')} · {s.finalReport.signature.signerName ?? s.submitted.by}</b></span>
          <span><small>&nbsp;</small><button type="button" className="pd-btn is-ghost" onClick={() => void downloadFile(`/assignments/${id}/dispatch/final`, s.finalReport!.fileName).catch((c: unknown) => setError(errorMessage(c)))}>Download the final report (PDF)</button></span>
        </div>
        <p className="pd-muted" style={{ margin: '6px 0' }} title={s.finalReport.sha256}>{s.finalReport.signature.note} Fingerprint {s.finalReport.sha256.slice(0, 12)}…</p>
        {canAct && (reopening
          ? <div className="cmp-form" style={{ maxWidth: 560 }}>
              <input className="ui-input" placeholder="Why does the report need a revision?" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
              <span><button type="button" className="pd-btn is-ghost" onClick={() => setReopening(false)}>Cancel</button> <button type="button" className="pd-btn is-primary" disabled={busy !== null || reopenReason.trim().length < 3} onClick={() => void reopen()}>Reopen for a revision</button></span>
            </div>
          : <button type="button" className="chk-link" onClick={() => setReopening(true)}>Reopen for a revision</button>)}
      </div>}

      {s.submitted && <>
        <div className="wb-left" style={{ padding: 14 }}>
          <h3 className="chk-h">Bill</h3>
          {s.billing ? <div className="wb-brief">
            <span><small>Bill no.</small><b>{s.billing.code}</b></span>
            <span><small>Amount</small><b>{inr(s.billing.amount)}</b></span>
            <span><small>Status</small><b><span className={`cmp-pill is-${s.billing.outstanding > 0 ? 'bad' : 'ok'}`}>{s.billing.outstanding <= 0 ? 'Paid' : s.billing.paid > 0 ? `Part paid · ${inr(s.billing.outstanding)} due` : 'Unpaid'}</span></b></span>
            <span><small>Due</small><b>{formatDate(s.billing.dueOn)}</b></span>
            <span><small>&nbsp;</small><button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/invoices/${s.billing!.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>Download bill</button> <Link to="/accounts" className="pd-btn is-ghost">Open Accounts</Link></span>
          </div> : <p className="pd-muted">No bill was raised because the case has no fee. Add a fee to the case, then raise the bill from Accounts.</p>}
        </div>

        <div className="wb-left" style={{ padding: 14 }}>
          <h3 className="chk-h">Send to the bank</h3>
          <div className="flex flex-wrap gap-2 mb-2">
            <button type="button" className="pd-btn is-ghost" onClick={() => void downloadFile(`/assignments/${id}/dispatch/final`, 'valuation-report.pdf').catch((c: unknown) => setError(errorMessage(c)))}>Download the final report (PDF)</button>
            <button type="button" className="pd-btn is-ghost" onClick={() => void downloadFile(`/assignments/${id}/bank-report/docx`, 'valuation-report.docx').catch((c: unknown) => setError(errorMessage(c)))}>Download report (Word)</button>
          </div>
          <div className="sb-channels" role="group" aria-label="Channel">{CHANNELS.map(([key, label]) => <button key={key} type="button" className={channel === key ? 'is-on' : ''} onClick={() => pickChannel(key)}>{label}</button>)}</div>
          <div className="va-grid" style={{ marginTop: 10 }}>
            <label className="bank-row"><span className="bank-label">{channel === 'EMAIL' ? 'Bank manager’s email' : channel === 'WHATSAPP' ? 'Bank manager’s WhatsApp number' : 'Who it went to'}</span>
              <input className="ui-input" value={recipient} placeholder={s.contact ? `${s.contact.name ?? 'Branch'} · ${s.contact.branch}` : ''} onChange={(e) => setRecipient(e.target.value)} /></label>
            <label className="bank-row"><span className="bank-label">Message (optional)</span><input className="ui-input" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          </div>
          <p className="pd-muted" style={{ margin: '6px 0' }}>{channel === 'EMAIL' ? 'Email sends the report and the bill as attachments when email is set up on the server; otherwise the send is only recorded.' : channel === 'WHATSAPP' ? 'WhatsApp opens with the message ready. Attach the downloaded report there; the send is recorded here.' : 'Use this to record a send you did yourself.'}</p>
          {canAct && <button type="button" className="pd-btn is-primary" disabled={busy !== null || recipient.trim().length < 3} onClick={() => void send()}>{busy === 'send' ? 'Sending…' : channel === 'OTHER' ? 'Record it' : 'Send and record'}</button>}
          {s.sends.length > 0 && <>
            <h3 className="chk-h" style={{ marginTop: 14 }}>Sent so far</h3>
            <ul className="bank-issues">{s.sends.map((x) => <li key={x.id}>{new Date(x.sentAt).toLocaleString('en-IN')} · {x.channel === 'WHATSAPP' ? 'WhatsApp' : x.channel === 'EMAIL' ? 'Email' : 'Other'} · {x.recipient} · {x.deliveryStatus === 'SENT' ? 'sent' : x.deliveryStatus === 'FAILED' ? `failed (${x.deliveryError ?? ''})` : 'recorded'}{x.note ? ` · ${x.note}` : ''}</li>)}</ul>
          </>}
        </div>
      </>}
    </div>
  )
}
