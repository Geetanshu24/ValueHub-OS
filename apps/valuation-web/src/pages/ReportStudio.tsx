import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { isSupportedBank } from '@value-hub/valuation-shared'
import Collapsible from '../components/Collapsible.tsx'
import { buttonClass, Card, ErrorText, errorMessage, formatDate, ghostButtonClass, inputClass } from '../components/ui.tsx'
import { api, openFile, type Paginated } from '../lib/api.ts'
import { useAssignmentParam } from '../lib/useAssignmentParam.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface AssignmentOption {
  id: string
  code: string
  status: string
  property: { addressLine: string }
}
interface Template {
  id: string
  name: string
  version: number
  propertyClass: string | null
  isActive: boolean
  effectiveFrom: string
}
interface QcCheck {
  code: string
  label: string
  status: 'PASS' | 'FAIL' | 'WARN'
  detail?: string
}
interface Qc {
  passed: boolean
  checks: QcCheck[]
}
interface Report {
  id: string
  versionNumber: number
  status: string
  qc: Qc
  createdAt: string
  issuedAt: string | null
  template: { name: string; version: number }
}

interface Submission {
  id: string
  channel: string
  recipient: string
  sentAt: string
  deliveryStatus: 'RECORDED' | 'SENT' | 'FAILED'
  deliveryError: string | null
  acknowledgedAt: string | null
  reportVersion: { versionNumber: number }
}

const DELIVERY_LABEL = { RECORDED: 'recorded', SENT: 'sent (accepted by mail server, not confirmed delivered)', FAILED: 'failed' } as const

const STATUS_STYLE: Record<QcCheck['status'], string> = { PASS: 'text-brand-700', FAIL: 'text-red-600', WARN: 'text-amber-700' }
const SYMBOL: Record<QcCheck['status'], string> = { PASS: '✓', FAIL: '✗', WARN: '!' }

function QcList({ qc }: { qc: Qc }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {qc.checks.map((check) => (
        <li key={check.code} className={STATUS_STYLE[check.status]}>
          {SYMBOL[check.status]} {check.label}
          {check.detail && <span className="block pl-4 text-xs text-slate-500">{check.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

interface ChecklistEntry {
  itemId: string
  label: string
  checked: boolean
}

function ReportChecklist({ reportId, editable, onError }: { reportId: string; editable: boolean; onError: (m: string) => void }) {
  const list = useFetch<ChecklistEntry[]>(`/reports/${reportId}/checklist`)
  if (!list.data || list.data.length === 0) return null
  return (
    <div className="mt-2">
      <p className="text-sm font-semibold">Review checklist</p>
      {list.data.map((item) => (
        <label key={item.itemId} className="block text-sm">
          <input
            type="checkbox"
            checked={item.checked}
            disabled={!editable}
            onChange={(e) => void api.put(`/reports/${reportId}/checklist/${item.itemId}`, { checked: e.target.checked }).then(list.reload).catch((c: unknown) => onError(errorMessage(c)))}
          />{' '}
          {item.label}
        </label>
      ))}
    </div>
  )
}

const SAMPLE_SPEC = JSON.stringify(
  {
    title: 'Valuation Report',
    sections: [{ heading: 'Property', fields: [{ label: 'Property ID', source: 'property.code', kind: 'required' }] }],
    limitations: ['This report is an opinion of value for the stated purpose only.'],
    requiredAnnexures: ['SALE_DEED'],
    requirePhotos: true,
  },
  null,
  2,
)

function TemplateAdmin({ onChange }: { onChange: () => void }) {
  const templates = useFetch<Template[]>('/report-templates')
  const fields = useFetch<{ path: string; label: string; type: string }[]>('/report-templates/source-fields')
  const banks = useFetch<Paginated<{ id: string; name: string }>>('/banks?pageSize=100')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', bankId: '', propertyClass: '', effectiveFrom: '', spec: SAMPLE_SPEC })

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      templates.reload()
      onChange()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <Card title="Template library">
      <div className="mb-3 flex gap-2">
        <button type="button" className={buttonClass} onClick={() => void run(() => api.post('/report-templates/install-defaults', {}))}>Install standard templates</button>
      </div>
      <ErrorText message={error ?? templates.error} />
      {templates.data?.map((t) => (
        <div key={t.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
          <span>{t.name} <span className="text-slate-500">v{t.version} · {t.propertyClass ?? 'any class'} · from {formatDate(t.effectiveFrom)}</span> {!t.isActive && <span className="text-xs text-slate-400">(retired)</span>}</span>
          <button type="button" className={ghostButtonClass} onClick={() => void run(() => api.patch(`/report-templates/${t.id}/active`, { isActive: !t.isActive }))}>{t.isActive ? 'Retire' : 'Reactivate'}</button>
        </div>
      ))}
      <div className="mt-3">
        <Collapsible title={<span className="text-sm font-semibold">Publish a template (a repeated name publishes the next version)</span>}>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input className={inputClass} placeholder="Template name" aria-label="Template name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputClass} type="date" aria-label="Effective from" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          <select className={inputClass} aria-label="Bank" value={form.bankId} onChange={(e) => setForm({ ...form, bankId: e.target.value })}>
            <option value="">Any bank</option>
            {banks.data?.items.filter((b) => isSupportedBank(b.name)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={inputClass} aria-label="Property class" value={form.propertyClass} onChange={(e) => setForm({ ...form, propertyClass: e.target.value })}>
            <option value="">Any class</option>
            {['FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <textarea className={`${inputClass} font-mono text-xs sm:col-span-2`} rows={12} aria-label="Template spec" value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} />
          <p className="text-xs text-slate-500 sm:col-span-2">Allowed sources: {fields.data?.map((f) => f.path).join(', ')}, inspection.observations.&lt;key&gt;</p>
          <div>
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                void run(async () => {
                  await api.post('/report-templates', {
                    name: form.name,
                    effectiveFrom: form.effectiveFrom,
                    ...(form.bankId && { bankId: form.bankId }),
                    ...(form.propertyClass && { propertyClass: form.propertyClass }),
                    spec: JSON.parse(form.spec) as unknown,
                  })
                })
              }
            >
              Publish
            </button>
          </div>
        </div>
        </Collapsible>
      </div>
    </Card>
  )
}

export default function ReportStudio() {
  const { user } = useAuth()
  const assignments = useFetch<Paginated<AssignmentOption>>('/assignments?pageSize=100')
  const [assignmentId, setAssignmentId] = useAssignmentParam()
  const templates = useFetch<Template[]>(assignmentId ? `/assignments/${assignmentId}/report-templates` : null)
  const reports = useFetch<Report[]>(assignmentId ? `/assignments/${assignmentId}/reports` : null)
  const [templateId, setTemplateId] = useState('')
  const [preview, setPreview] = useState<Qc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submissions = useFetch<Submission[]>(assignmentId ? `/assignments/${assignmentId}/submissions` : null)
  const [send, setSend] = useState({ channel: 'EMAIL', recipient: '', note: '' })
  const [tab, setTab] = useState<'reports' | 'templates'>('reports')

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const check = () => run(async () => setPreview(await api.post<Qc>(`/assignments/${assignmentId}/reports/preview-qc`, { templateId })))
  const create = () =>
    run(async () => {
      await api.post(`/assignments/${assignmentId}/reports`, { templateId })
      setPreview(null)
      reports.reload()
    })
  const act = (id: string, action: 'submit-for-review' | 'approve' | 'issue') =>
    run(async () => {
      await api.post(`/reports/${id}/${action}`, {})
      reports.reload()
    })

  const submit = (reportVersionId: string) =>
    run(async () => {
      await api.post(`/assignments/${assignmentId}/submissions`, { reportVersionId, channel: send.channel, recipient: send.recipient, ...(send.note && { note: send.note }) })
      setSend({ ...send, recipient: '', note: '' })
      submissions.reload()
      reports.reload()
    })

  // One assignment's report lives in its Quality Review and Approval & Submission steps; this screen keeps template administration.
  if (assignmentId) return <Navigate to={`/assignments/${assignmentId}/review`} replace />

  const canPrepare = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const canApprove = canPrepare || user?.role === 'REVIEWER'

  return (
    <div>
      <h1 className="text-2xl font-bold">Report Studio</h1>
      <p className="mb-3 mt-1 text-base text-ink-soft">Bank-ready reports drawn from approved records, checked before they go out.</p>
      {user?.role === 'FIRM_ADMIN' && (
        <div className="mb-4 flex gap-2">
          <button type="button" className={tab === 'reports' ? buttonClass : ghostButtonClass} onClick={() => setTab('reports')}>Reports</button>
          <button type="button" className={tab === 'templates' ? buttonClass : ghostButtonClass} onClick={() => setTab('templates')}>Templates</button>
        </div>
      )}
      {tab === 'templates' && <TemplateAdmin onChange={() => templates.reload()} />}

      {tab === 'reports' && (
        <>
          <select className={`${inputClass} mb-4`} value={assignmentId} onChange={(e) => { setAssignmentId(e.target.value); setPreview(null) }} aria-label="Assignment">
            <option value="">Select an assignment…</option>
            {assignments.data?.items.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.property.addressLine} — {a.status}</option>)}
          </select>
          <ErrorText message={error ?? assignments.error ?? reports.error} />

          {assignmentId && canPrepare && (
            <Card title="Prepare a report">
              <div className="flex flex-wrap gap-2">
                <select className={inputClass} aria-label="Template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPreview(null) }}>
                  <option value="">Choose a template…</option>
                  {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}
                </select>
                <button type="button" className={ghostButtonClass} disabled={!templateId || busy} onClick={() => void check()}>Run quality checks</button>
                <button type="button" className={buttonClass} disabled={!templateId || busy} onClick={() => void create()}>Create draft report</button>
              </div>
              {templates.data?.length === 0 && <p className="mt-2 text-sm text-ink-soft">No template fits this assignment. An admin can install the standard ones under the Templates tab.</p>}
              {preview && (
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <p className="font-semibold">{preview.passed ? 'Ready: all required checks pass.' : 'Not ready: fix the items marked ✗.'}</p>
                  <QcList qc={preview} />
                </div>
              )}
            </Card>
          )}

          {reports.data?.map((report) => (
            <Card key={report.id} title={`R${report.versionNumber} · ${report.status.replace('_', ' ')}`}>
              <p className="text-sm text-ink-soft">
                {report.template.name} v{report.template.version} · created {formatDate(report.createdAt)}
                {report.issuedAt && ` · issued ${formatDate(report.issuedAt)}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={ghostButtonClass} onClick={() => void openFile(`/reports/${report.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>Open PDF</button>
                {report.status === 'DRAFT' && canPrepare && <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(report.id, 'submit-for-review')}>Send for review</button>}
                {report.status === 'IN_REVIEW' && canApprove && <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(report.id, 'approve')}>Approve</button>}
                {report.status === 'APPROVED' && canPrepare && <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(report.id, 'issue')}>Issue final report</button>}
              </div>
              <ReportChecklist reportId={report.id} editable={['DRAFT', 'IN_REVIEW'].includes(report.status) && canApprove} onError={setError} />
              <div className="mt-2">
                <Collapsible title={<span className="text-sm">Quality checks — {report.qc.passed ? 'passed' : 'not passed'}</span>}>
                  <QcList qc={report.qc} />
                </Collapsible>
              </div>
            </Card>
          ))}
          {assignmentId && reports.data?.some((r) => r.status === 'ISSUED') && canPrepare && (
            <Card title="Submit the issued report to the bank">
              <div className="flex flex-wrap gap-2">
                <select className={inputClass} aria-label="Channel" value={send.channel} onChange={(e) => setSend({ ...send, channel: e.target.value })}>
                  {['EMAIL', 'PORTAL', 'COURIER', 'HAND_DELIVERY'].map((c) => <option key={c}>{c}</option>)}
                </select>
                <input className={`${inputClass} min-w-64 flex-1`} placeholder={send.channel === 'EMAIL' ? 'Recipient email' : 'Recipient / portal / docket no.'} aria-label="Recipient" value={send.recipient} onChange={(e) => setSend({ ...send, recipient: e.target.value })} />
                <input className={`${inputClass} min-w-48 flex-1`} placeholder="Note (optional)" aria-label="Note" value={send.note} onChange={(e) => setSend({ ...send, note: e.target.value })} />
                <button type="button" className={buttonClass} disabled={busy || !send.recipient} onClick={() => void submit(reports.data?.find((r) => r.status === 'ISSUED')?.id ?? '')}>
                  {send.channel === 'EMAIL' ? 'Email the report' : 'Record submission'}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Emailing sends the issued PDF as an attachment. The bank&apos;s acknowledgement is recorded separately, by you.</p>
            </Card>
          )}

          {submissions.data && submissions.data.length > 0 && (
            <Card title="Submissions">
              {submissions.data.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2 text-sm">
                  <span>
                    <strong>R{item.reportVersion.versionNumber}</strong> via {item.channel.toLowerCase().replace('_', ' ')} to {item.recipient} · {formatDate(item.sentAt)}
                    <span className={`block text-xs ${item.deliveryStatus === 'FAILED' ? 'text-red-600' : 'text-slate-500'}`}>
                      {DELIVERY_LABEL[item.deliveryStatus]}{item.deliveryError ? `: ${item.deliveryError}` : ''}
                      {item.acknowledgedAt ? ` · acknowledged ${formatDate(item.acknowledgedAt)}` : item.deliveryStatus !== 'FAILED' ? ' · not yet acknowledged' : ''}
                    </span>
                  </span>
                  {!item.acknowledgedAt && item.deliveryStatus !== 'FAILED' && canPrepare && (
                    <button type="button" className={ghostButtonClass} onClick={() => void run(async () => { await api.post(`/submissions/${item.id}/acknowledge`, {}); submissions.reload() })}>Mark acknowledged</button>
                  )}
                </div>
              ))}
            </Card>
          )}

          {assignmentId && reports.data?.length === 0 && <p className="text-ink-soft">No report prepared yet.</p>}
        </>
      )}
    </div>
  )
}
