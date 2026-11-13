import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { VALUATION_ROLES, isSupportedBank, type ValuationRole } from '@value-hub/valuation-shared'
import { buttonClass, Card, ErrorText, errorMessage, Field, formatDate, ghostButtonClass, inputClass, PageHeader } from '../components/ui.tsx'
import Pager from '../components/Pager.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface UserRow {
  id: string
  email: string
  fullName: string
  role: ValuationRole
  isActive: boolean
}
interface BankRow {
  id: string
  name: string
  branches: { id: string; name: string; city: string | null; district: string | null; state: string | null }[]
}
interface AuditRow {
  id: string
  createdAt: string
  actorName: string | null
  entityType: string
  entityId: string
  action: string
}

function Users() {
  const { user: me } = useAuth()
  const [page, setPage] = useState(1)
  const users = useFetch<Paginated<UserRow>>(`/users?page=${page}&pageSize=25`)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', fullName: '', role: 'VALUER' as ValuationRole, password: '' })

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      users.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  function create(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await api.post('/users', form)
      setForm({ ...form, email: '', fullName: '', password: '' })
    })
  }

  function resetPassword(id: string) {
    const password = window.prompt('New password (at least 12 characters)')
    if (password) void run(() => api.patch(`/users/${id}`, { password }))
  }

  return (
    <>
      <Card title="Add a user">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <input className={inputClass} type="email" required placeholder="Email" aria-label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={inputClass} required placeholder="Full name" aria-label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <select className={inputClass} aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ValuationRole })}>
            {VALUATION_ROLES.map((role) => <option key={role}>{role}</option>)}
          </select>
          <input className={inputClass} type="password" required minLength={12} placeholder="Password (12+ chars)" aria-label="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="submit" className={buttonClass}>Add</button>
        </form>
      </Card>
      <ErrorText message={error ?? users.error} />
      <Card title="Users">
        {users.data?.items.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
            <div>
              <p className="font-semibold">{row.fullName} {!row.isActive && <span className="text-xs text-red-600">(inactive)</span>}</p>
              <p className="text-xs text-slate-500">{row.email}</p>
            </div>
            <div className="flex gap-2">
              <select className={inputClass} aria-label={`Role of ${row.fullName}`} value={row.role} disabled={row.id === me?.id} onChange={(e) => void run(() => api.patch(`/users/${row.id}`, { role: e.target.value }))}>
                {VALUATION_ROLES.map((role) => <option key={role}>{role}</option>)}
              </select>
              <button type="button" className={ghostButtonClass} onClick={() => resetPassword(row.id)}>Reset password</button>
              {row.id !== me?.id && (
                <button type="button" className={ghostButtonClass} onClick={() => void run(() => api.patch(`/users/${row.id}`, { isActive: !row.isActive }))}>
                  {row.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
            </div>
          </div>
        ))}
        {users.data && <Pager page={users.data.page} pageSize={users.data.pageSize} total={users.data.total} onChange={setPage} />}
      </Card>
    </>
  )
}

function Banks() {
  const banks = useFetch<Paginated<BankRow>>('/banks?pageSize=100')
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      banks.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <>
      <Card title="Add a bank">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await api.post('/banks', { name })
              setName('')
            })
          }}
          className="flex gap-2"
        >
          <input className={inputClass} required minLength={2} placeholder="Bank name" aria-label="Bank name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className={buttonClass}>Add</button>
        </form>
      </Card>
      <ErrorText message={error ?? banks.error} />
      {banks.data?.items.filter((bank) => isSupportedBank(bank.name)).map((bank) => (
        <Card key={bank.id} title={bank.name}>
          <div className="mb-2 flex gap-2">
            <button type="button" className={ghostButtonClass} onClick={() => { const next = window.prompt('Rename bank', bank.name)?.trim(); if (next) void run(() => api.patch(`/banks/${bank.id}`, { name: next })) }}>Rename</button>
            <button type="button" className={ghostButtonClass} onClick={() => { const branch = window.prompt('Branch name')?.trim(); if (!branch) return; const city = window.prompt('City (optional)')?.trim(); const district = window.prompt('District (optional)')?.trim(); const state = window.prompt('State (optional)')?.trim(); void run(() => api.post(`/banks/${bank.id}/branches`, { name: branch, ...(city && { city }), ...(district && { district }), ...(state && { state }) })) }}>Add branch</button>
          </div>
          {bank.branches.length === 0 && <p className="text-sm text-ink-soft">No branches yet.</p>}
          {bank.branches.map((branch) => (
            <div key={branch.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
              <span>{branch.name}{[branch.city, branch.district, branch.state].filter(Boolean).length ? ` · ${[branch.city, branch.district, branch.state].filter(Boolean).join(', ')}` : ''}</span>
              <button type="button" className={ghostButtonClass} onClick={() => { const city = window.prompt('City', branch.city ?? '')?.trim(); if (city === undefined) return; const district = window.prompt('District', branch.district ?? '')?.trim(); const state = window.prompt('State', branch.state ?? '')?.trim(); void run(() => api.patch(`/banks/${bank.id}/branches/${branch.id}`, { city, district, state })) }}>Set location</button>
              <button type="button" className={ghostButtonClass} onClick={() => { const email = window.prompt('Branch contact email')?.trim(); if (email) void run(() => api.patch(`/banks/${bank.id}/branches/${branch.id}`, { contactEmail: email })) }}>Set contact email</button>
            </div>
          ))}
        </Card>
      ))}
    </>
  )
}

function AuditLog() {
  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const audit = useFetch<Paginated<AuditRow>>(`/audit?page=${page}&pageSize=25${entityType ? `&entityType=${entityType}` : ''}`)
  return (
    <Card title="Audit log">
      <select className={`${inputClass} mb-3`} aria-label="Entity type" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1) }}>
        <option value="">All entities</option>
        {['Assignment', 'Property', 'Document', 'ExtractedField', 'Inspection', 'Discrepancy', 'ValuationVersion', 'ReportVersion', 'Invoice', 'User', 'Bank'].map((t) => <option key={t}>{t}</option>)}
      </select>
      <ErrorText message={audit.error} />
      <table className="w-full text-left text-sm">
        <tbody>
          {audit.data?.items.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              <td className="py-1 pr-2 text-xs text-slate-500">{formatDate(row.createdAt)} {new Date(row.createdAt).toLocaleTimeString()}</td>
              <td className="py-1 pr-2">{row.actorName ?? '—'}</td>
              <td className="py-1 pr-2 font-semibold">{row.action}</td>
              <td className="py-1 text-xs text-slate-500">{row.entityType} {row.entityId.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {audit.data && <Pager page={audit.data.page} pageSize={audit.data.pageSize} total={audit.data.total} onChange={setPage} />}
    </Card>
  )
}

interface FeeRule {
  id: string
  bankId: string | null
  propertyClass: string | null
  amount: string
  effectiveFrom: string
}
interface ChecklistRow {
  id: string
  label: string
  propertyClass: string | null
  isActive: boolean
}
interface RetentionReport {
  retentionYears: number | null
  onHold: { id: string; code: string; legalHoldReason: string | null }[]
  dueForReview: { id: string; code: string; retainUntil: string }[]
  closedWithoutRetentionDate: number
}

function Fees() {
  const rules = useFetch<FeeRule[]>('/admin/fee-rules')
  const banks = useFetch<Paginated<BankRow>>('/banks?pageSize=100')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ bankId: '', propertyClass: '', amount: '', effectiveFrom: '' })
  const bankName = (id: string | null) => banks.data?.items.find((b) => b.id === id)?.name ?? 'Any bank'

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      rules.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <Card title="Default fees">
      <p className="mb-3 text-sm text-ink-soft">A new assignment takes the most specific fee in force on its valuation date: bank + class, then bank, then class, then a general fee. It can still be changed per assignment.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={inputClass} aria-label="Bank" value={form.bankId} onChange={(e) => setForm({ ...form, bankId: e.target.value })}>
          <option value="">Any bank</option>
          {banks.data?.items.filter((b) => isSupportedBank(b.name)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={inputClass} aria-label="Property class" value={form.propertyClass} onChange={(e) => setForm({ ...form, propertyClass: e.target.value })}>
          <option value="">Any class</option>
          {['FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className={`${inputClass} w-32`} type="number" step="0.01" min="0" placeholder="Fee ₹" aria-label="Fee" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input className={inputClass} type="date" aria-label="Effective from" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        <button type="button" className={buttonClass} disabled={!form.amount || !form.effectiveFrom} onClick={() => void run(async () => { await api.post('/admin/fee-rules', { amount: Number(form.amount), effectiveFrom: form.effectiveFrom, ...(form.bankId && { bankId: form.bankId }), ...(form.propertyClass && { propertyClass: form.propertyClass }) }); setForm({ ...form, amount: '' }) })}>Add rule</button>
      </div>
      <ErrorText message={error ?? rules.error} />
      {rules.data?.map((r) => (
        <div key={r.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
          <span>₹ {Number(r.amount).toLocaleString('en-IN')} · {bankName(r.bankId)} · {r.propertyClass ?? 'any class'} · from {formatDate(r.effectiveFrom)}</span>
          <button type="button" className={ghostButtonClass} onClick={() => void run(() => api.delete(`/admin/fee-rules/${r.id}`))}>Remove</button>
        </div>
      ))}
    </Card>
  )
}

function Checklist() {
  const items = useFetch<ChecklistRow[]>('/admin/checklist')
  const [label, setLabel] = useState('')
  const [propertyClass, setPropertyClass] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      items.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <Card title="Report review checklist">
      <p className="mb-3 text-sm text-ink-soft">Active items must all be ticked by the reviewer before a report can be approved. They sit on top of the built-in quality checks.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className={`${inputClass} min-w-64 flex-1`} placeholder="e.g. Boundaries match the plan" aria-label="Checklist item" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className={inputClass} aria-label="Class" value={propertyClass} onChange={(e) => setPropertyClass(e.target.value)}>
          <option value="">All classes</option>
          {['FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <button type="button" className={buttonClass} disabled={label.trim().length < 3} onClick={() => void run(async () => { await api.post('/admin/checklist', { label, ...(propertyClass && { propertyClass }) }); setLabel('') })}>Add</button>
      </div>
      <ErrorText message={error ?? items.error} />
      {items.data?.map((item) => (
        <div key={item.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
          <span className={item.isActive ? '' : 'text-slate-400 line-through'}>{item.label} <span className="text-xs text-slate-500">({item.propertyClass ?? 'all classes'})</span></span>
          <button type="button" className={ghostButtonClass} onClick={() => void run(() => api.patch(`/admin/checklist/${item.id}`, { isActive: !item.isActive }))}>{item.isActive ? 'Retire' : 'Reactivate'}</button>
        </div>
      ))}
    </Card>
  )
}

function Retention() {
  const report = useFetch<RetentionReport>('/admin/retention')
  const [years, setYears] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(action: () => Promise<string | void>) {
    setError(null)
    setMessage(null)
    try {
      setMessage((await action()) ?? null)
      report.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <>
      <Card title="Retention period">
        <p className="mb-3 text-sm text-ink-soft">Set this from the applicable law, your bank agreements and professional obligations. There is no default: until it is set, closed records get no retention date.</p>
        <p className="mb-2">Currently: <strong>{report.data?.retentionYears ? `${report.data.retentionYears} years after closing` : 'not set'}</strong></p>
        <div className="flex gap-2">
          <input className={`${inputClass} w-28`} type="number" min={1} max={50} placeholder="Years" aria-label="Retention years" value={years} onChange={(e) => setYears(e.target.value)} />
          <button type="button" className={buttonClass} disabled={!years} onClick={() => void run(async () => { await api.put('/admin/settings/retention', { retentionYears: Number(years) }); setYears('') })}>Save</button>
          <button type="button" className={ghostButtonClass} onClick={() => void run(async () => { const r = await api.post<{ updated: number }>('/admin/retention/apply', {}); return `${r.updated} closed record(s) given a retention date.` })}>Apply to already-closed records</button>
        </div>
        <ErrorText message={error ?? report.error} />
        {message && <p role="status" className="mt-2 text-sm text-brand-700">{message}</p>}
      </Card>
      <Card title="Retention review">
        <p className="mb-2 text-sm text-ink-soft">{report.data?.closedWithoutRetentionDate ?? 0} closed record(s) have no retention date. Nothing is deleted automatically; this list is for a person to decide.</p>
        {report.data?.dueForReview.length === 0 && <p className="text-sm text-ink-soft">No record has passed its retention date.</p>}
        {report.data?.dueForReview.map((a) => <p key={a.id} className="text-sm"><Link className="text-brand-700 hover:underline" to={`/assignments/${a.id}`}>{a.code}</Link> — retain until {formatDate(a.retainUntil)}</p>)}
      </Card>
      <Card title="On legal hold">
        {report.data?.onHold.length === 0 && <p className="text-sm text-ink-soft">None.</p>}
        {report.data?.onHold.map((a) => <p key={a.id} className="text-sm"><Link className="text-brand-700 hover:underline" to={`/assignments/${a.id}`}>{a.code}</Link> — {a.legalHoldReason}</p>)}
      </Card>
    </>
  )
}

function Account() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.post('/auth/change-password', form)
      setForm({ currentPassword: '', newPassword: '' })
      setMessage('Password changed.')
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <Card title="Change my password">
      <form onSubmit={submit} className="max-w-sm space-y-3">
        <Field label="Current password">
          <input className={`${inputClass} w-full`} type="password" required autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password (12+ characters)">
          <input className={`${inputClass} w-full`} type="password" required minLength={12} autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <ErrorText message={error} />
        {message && <p role="status" className="text-sm text-brand-700">{message}</p>}
        <button type="submit" className={buttonClass}>Change password</button>
      </form>
    </Card>
  )
}

// The review checklist, retention and audit log are not shown for now; their screens are kept below.
const TABS = ['Users', 'Banks', 'Fees', 'Account'] as const

export default function Admin() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'FIRM_ADMIN'
  const visible = TABS.filter((tab) => isAdmin || tab === 'Account')
  const [tab, setTab] = useState<(typeof TABS)[number]>(visible[0])

  return (
    <div>
      <PageHeader eyebrow="BUSINESS" title="Administration" subtitle="Your people, the banks and branches, and the fees." />
      <div className="pd-segment mb-4 flex-wrap" role="tablist">
        {visible.map((name) => (
          <button key={name} type="button" onClick={() => setTab(name)} role="tab" aria-selected={tab === name} className={tab === name ? 'is-on' : ''}>
            {name}
          </button>
        ))}
      </div>
      {tab === 'Users' && <Users />}
      {tab === 'Banks' && <Banks />}
      {tab === 'Fees' && <Fees />}
      {tab === 'Account' && <Account />}
    </div>
  )
}

export { AuditLog, Checklist, Retention }
