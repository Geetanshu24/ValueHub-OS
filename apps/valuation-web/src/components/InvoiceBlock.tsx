import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ErrorText, errorMessage, formatDate, formatInr } from './ui.tsx'
import FormDialog, { type DialogField } from './FormDialog.tsx'
import { api, fileBlobUrl, openFile } from '../lib/api.ts'

export interface Payment { id: string; amount: string; receivedOn: string; reference: string | null; voidedAt: string | null; voidReason: string | null }
export interface FollowUp { id: string; channel: string; note: string; contactedAt: string; nextActionOn: string | null; sentTo: string | null; delivery: string | null }
export interface Invoice {
  id: string; assignmentId: string; code: string; amount: string; issuedOn: string; dueOn: string; status: string
  paid: number; outstanding: number; overdue: boolean
  assignment: { code: string; bank: { name: string } }
  payments: Payment[]; followUps: FollowUp[]
}

export const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
const STATUS_TONE: Record<string, string> = { DRAFT: 'is-warn', SENT: 'is-submitted', PARTIALLY_PAID: 'is-warn', PAID: 'is-verified', CANCELLED: 'is-type' }

function InvoicePreview({ invoiceId }: { invoiceId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let made: string | null = null; let cancelled = false
    fileBlobUrl(`/invoices/${invoiceId}/file`).then((f) => { if (cancelled) URL.revokeObjectURL(f.url); else { made = f.url; setUrl(f.url) } }).catch(() => { /* the PDF button still works */ })
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made) }
  }, [invoiceId])
  return <div className="iv-preview">{url ? <iframe title="Invoice preview" src={url} /> : <p className="pd-muted">Loading the invoice…</p>}</div>
}

type Dialog = { kind: 'pay' } | { kind: 'chase' } | { kind: 'void'; paymentId: string } | { kind: 'cancel' } | null

// One invoice with everything that can be done to it: send, record a payment,
// log a chase, void a payment or cancel. Every step asks for what it needs in a
// dialog, and the API keeps the rules (a payment is voided with a reason, never deleted).
export default function InvoiceCard({ invoice, canBill, isAdmin, onChange, showAssignment = true }: { invoice: Invoice; canBill: boolean; isAdmin: boolean; onChange: () => void; showAssignment?: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = Number(invoice.amount)
  const share = total > 0 ? Math.min(100, (invoice.paid / total) * 100) : 0
  const open = ['SENT', 'PARTIALLY_PAID'].includes(invoice.status)

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try { await action(); onChange() } catch (caught) { setError(errorMessage(caught)) }
  }

  const dialogs: Record<string, { title: string; intro?: string; fields: DialogField[]; submitLabel: string; tone?: 'danger'; submit: (v: Record<string, string>) => Promise<void> }> = {
    pay: {
      title: `Record a payment on ${invoice.code}`, intro: `Outstanding ₹ ${formatInr(invoice.outstanding)}. A payment is never edited later; a mistake is voided with a reason.`, submitLabel: 'Record payment',
      fields: [{ name: 'amount', label: 'Amount received (₹)', type: 'number', required: true, step: '0.01', min: '0.01', initial: String(invoice.outstanding) }, { name: 'receivedOn', label: 'Received on', type: 'date', required: true, initial: iso(0), max: iso(0) }, { name: 'reference', label: 'Reference (UTR / cheque no.)', placeholder: 'Optional' }],
      submit: async (v) => { await api.post(`/invoices/${invoice.id}/payments`, { amount: Number(v.amount), receivedOn: v.receivedOn, ...(v.reference.trim() && { reference: v.reference.trim() }) }) },
    },
    chase: {
      title: `Log a follow-up on ${invoice.code}`, submitLabel: 'Save follow-up',
      fields: [{ name: 'channel', label: 'How', type: 'select', options: [{ value: 'CALL', label: 'Call' }, { value: 'EMAIL', label: 'Email (sent from here)' }, { value: 'VISIT', label: 'Visit' }, { value: 'OTHER', label: 'Other' }], initial: 'CALL' }, { name: 'note', label: 'What was said or sent', type: 'textarea', required: true }, { name: 'sendTo', label: 'Email the reminder to', type: 'email', placeholder: 'Only for the email option' }, { name: 'nextActionOn', label: 'Next action on', type: 'date', min: iso(0) }],
      submit: async (v) => { await api.post(`/invoices/${invoice.id}/follow-ups`, { channel: v.channel, note: v.note.trim(), ...(v.channel === 'EMAIL' && v.sendTo.trim() && { sendTo: v.sendTo.trim() }), ...(v.nextActionOn && { nextActionOn: v.nextActionOn }) }) },
    },
    void: {
      title: 'Void this payment', intro: 'The payment stays on record, struck through, with your reason.', submitLabel: 'Void payment', tone: 'danger',
      fields: [{ name: 'reason', label: 'Why is it being voided?', type: 'textarea', required: true }],
      submit: async (v) => { if (dialog?.kind === 'void') await api.post(`/payments/${dialog.paymentId}/void`, { reason: v.reason.trim() }) },
    },
    cancel: {
      title: `Cancel ${invoice.code}`, intro: 'A cancelled invoice stops counting as owed. The record stays.', submitLabel: 'Cancel invoice', tone: 'danger',
      fields: [{ name: 'reason', label: 'Reason for cancelling', type: 'textarea', required: true }],
      submit: async (v) => { await api.post(`/invoices/${invoice.id}/cancel`, { reason: v.reason.trim() }) },
    },
  }
  const active = dialog ? dialogs[dialog.kind] : null

  return <article className={`iv ${invoice.overdue ? 'is-late' : ''}`}>
    <div className="iv-top">
      <div><b>{invoice.code}</b><small>{showAssignment && <><Link to={`/assignments/${invoice.assignmentId}`}>{invoice.assignment.code}</Link> · {invoice.assignment.bank.name} · </>}issued {formatDate(invoice.issuedOn)} · due {formatDate(invoice.dueOn)}</small></div>
      {invoice.overdue && <span className="pd-pill is-warn">Overdue</span>}
      <span className={`pd-pill ${STATUS_TONE[invoice.status] ?? 'is-type'}`}>{invoice.status.replace('_', ' ').toLowerCase()}</span>
    </div>
    <div className="iv-amounts"><div><small>Invoiced</small><b>₹ {formatInr(total)}</b></div><div><small>Received</small><b>₹ {formatInr(invoice.paid)}</b></div><div className={invoice.outstanding > 0 && invoice.overdue ? 'is-late' : ''}><small>Outstanding</small><b>₹ {formatInr(invoice.outstanding)}</b></div></div>
    {invoice.status !== 'CANCELLED' && <div className="iv-bar" aria-hidden><i style={{ width: `${share}%` }} /></div>}
    {invoice.payments.length > 0 && <ul className="iv-list">{invoice.payments.map((p) => <li key={p.id} className={p.voidedAt ? 'is-void' : ''}><span>₹ {formatInr(p.amount)} on {formatDate(p.receivedOn)}{p.reference ? ` · ${p.reference}` : ''}{p.voidedAt ? ` · voided: ${p.voidReason}` : ''}</span>{isAdmin && !p.voidedAt && <button type="button" onClick={() => setDialog({ kind: 'void', paymentId: p.id })}>Void</button>}</li>)}</ul>}
    {invoice.followUps.length > 0 && <ul className="iv-list is-follow">{invoice.followUps.map((f) => <li key={f.id}><span>{formatDate(f.contactedAt)} · {f.channel.toLowerCase()}: {f.note}{f.delivery ? ` (email ${f.delivery.toLowerCase()})` : ''}{f.nextActionOn ? ` · next ${formatDate(f.nextActionOn)}` : ''}</span></li>)}</ul>}
    <ErrorText message={error} />
    {preview && <InvoicePreview invoiceId={invoice.id} />}
    <div className="iv-actions">
      <button type="button" className="pd-btn is-ghost" onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview invoice'}</button>
      <button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/invoices/${invoice.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>PDF</button>
      {canBill && invoice.status === 'DRAFT' && <button type="button" className="pd-btn is-primary" onClick={() => void run(() => api.post(`/invoices/${invoice.id}/send`, {}))}>Mark as sent</button>}
      {canBill && open && <button type="button" className="pd-btn is-primary" onClick={() => setDialog({ kind: 'pay' })}>✓ Mark paid / record payment</button>}
      {canBill && open && <button type="button" className="pd-btn is-ghost" onClick={() => setDialog({ kind: 'chase' })}>Log follow-up</button>}
      {isAdmin && ['DRAFT', 'SENT'].includes(invoice.status) && <button type="button" className="pd-btn is-ghost" onClick={() => setDialog({ kind: 'cancel' })}>Cancel</button>}
    </div>
    {active && <FormDialog key={dialog?.kind} title={active.title} intro={active.intro} fields={active.fields} submitLabel={active.submitLabel} tone={active.tone} onClose={() => setDialog(null)} onSubmit={async (v) => { await active.submit(v); onChange() }} />}
  </article>
}

// Raising an invoice: an amount (the rest of the agreed fee when left blank) and a due date.
export function RaiseInvoice({ assignmentId, fee, invoiced, onDone }: { assignmentId: string; fee: string | null; invoiced: number; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [dueOn, setDueOn] = useState(iso(30))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const remaining = fee ? Math.max(0, Number(fee) - invoiced) : null
  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try { await api.post(`/assignments/${assignmentId}/invoices`, { dueOn, ...(amount && { amount: Number(amount) }) }); setAmount(''); onDone() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  return <form className="iv-raise" onSubmit={create}>
    <label className="va-f">Amount (₹)<input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={remaining !== null ? `Remaining fee: ${formatInr(remaining)}` : 'Required: no fee is set'} required={remaining === null} /></label>
    <label className="va-f">Due on<input type="date" required value={dueOn} min={iso(0)} onChange={(e) => setDueOn(e.target.value)} /></label>
    <button className="pd-btn is-primary" disabled={busy || remaining === 0}>{busy ? 'Creating…' : 'Create draft invoice'}</button>
    {remaining === 0 && <small>The whole fee has been invoiced.</small>}
    {remaining !== null && remaining > 0 && <small>Invoices on one assignment cannot add up to more than its fee ({`₹ ${formatInr(fee ?? 0)}`}).</small>}
    <ErrorText message={error} />
  </form>
}
