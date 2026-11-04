import { useState, type FormEvent } from 'react'
import { PROPERTY_CLASSES, PROPERTY_CLASS_LABELS, type PropertyClass } from '@value-hub/valuation-shared'
import Pager from '../components/Pager.tsx'
import { buttonClass, Card, ErrorText, errorMessage, ghostButtonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { useList } from '../lib/useList.ts'

interface PropertyRow {
  id: string
  code: string
  propertyClass: PropertyClass
  addressLine: string
  unitDetail: string | null
  locality: string | null
  village: string | null
  tehsil: string | null
  district: string | null
  state: string | null
  pinCode: string | null
  khasraNumbers: string[]
}

interface FormState {
  propertyClass: PropertyClass
  addressLine: string
  unitDetail: string
  locality: string
  village: string
  tehsil: string
  district: string
  state: string
  pinCode: string
  khasra: string
}

const blank: FormState = { propertyClass: 'HOUSE', addressLine: '', unitDetail: '', locality: '', village: '', tehsil: '', district: '', state: '', pinCode: '', khasra: '' }

const toForm = (row: PropertyRow): FormState => ({
  propertyClass: row.propertyClass,
  addressLine: row.addressLine,
  unitDetail: row.unitDetail ?? '',
  locality: row.locality ?? '',
  village: row.village ?? '',
  tehsil: row.tehsil ?? '',
  district: row.district ?? '',
  state: row.state ?? '',
  pinCode: row.pinCode ?? '',
  khasra: row.khasraNumbers.join(', '),
})

// Empty text fields are omitted so an edit never wipes data by accident.
function toPayload(form: FormState) {
  const text = (value: string) => (value.trim() === '' ? undefined : value.trim())
  return {
    propertyClass: form.propertyClass,
    addressLine: form.addressLine.trim(),
    unitDetail: text(form.unitDetail),
    locality: text(form.locality),
    village: text(form.village),
    tehsil: text(form.tehsil),
    district: text(form.district),
    state: text(form.state),
    pinCode: text(form.pinCode),
    khasraNumbers: form.khasra.split(',').map((k) => k.trim()).filter(Boolean),
  }
}

export default function Properties() {
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const { data, error, loading } = useList<PropertyRow>('/properties', { page, q: q.trim() || undefined }, reloadKey)
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setFormError(null)
    try {
      if (editing.id) await api.patch(`/properties/${editing.id}`, toPayload(editing.form))
      else await api.post('/properties', toPayload(editing.form))
      setEditing(null)
      setReloadKey((key) => key + 1)
    } catch (caught) {
      setFormError(errorMessage(caught))
    }
  }

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setEditing((current) => current && { ...current, form: { ...current.form, [key]: e.target.value } })

  return (
    <div>
      <PageHeader eyebrow="RECORDS" title="Properties" subtitle="One stable record per property, reused across assignments." action={<button type="button" className={buttonClass} onClick={() => setEditing({ id: null, form: blank })}>＋ New property</button>} />

      {editing && (
        <Card title={editing.id ? 'Edit property' : 'New property'}>
          <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
            <select className={inputClass} aria-label="Property class" value={editing.form.propertyClass} onChange={set('propertyClass')}>
              {PROPERTY_CLASSES.map((c) => <option key={c} value={c}>{PROPERTY_CLASS_LABELS[c]}</option>)}
            </select>
            <input className={inputClass} required minLength={3} placeholder="Address" aria-label="Address" value={editing.form.addressLine} onChange={set('addressLine')} />
            <input className={inputClass} placeholder="Unit / plot / floor" aria-label="Unit" value={editing.form.unitDetail} onChange={set('unitDetail')} />
            <input className={inputClass} placeholder="Locality" aria-label="Locality" value={editing.form.locality} onChange={set('locality')} />
            <input className={inputClass} placeholder="Village" aria-label="Village" value={editing.form.village} onChange={set('village')} />
            <input className={inputClass} placeholder="Tehsil" aria-label="Tehsil" value={editing.form.tehsil} onChange={set('tehsil')} />
            <input className={inputClass} placeholder="District" aria-label="District" value={editing.form.district} onChange={set('district')} />
            <input className={inputClass} placeholder="State" aria-label="State" value={editing.form.state} onChange={set('state')} />
            <input className={inputClass} placeholder="PIN (6 digits)" aria-label="PIN" pattern="\d{6}" value={editing.form.pinCode} onChange={set('pinCode')} />
            <input className={inputClass} placeholder="Khasra / killa / survey numbers, comma separated" aria-label="Khasra numbers" value={editing.form.khasra} onChange={set('khasra')} />
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className={buttonClass}>Save</button>
              <button type="button" className={ghostButtonClass} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
          <ErrorText message={formError} />
        </Card>
      )}

      <input
        type="search"
        placeholder="Search code, address, locality, khasra…"
        value={q}
        onChange={(event) => { setQ(event.target.value); setPage(1) }}
        className="mb-3 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
      />
      <ErrorText message={error} />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-base">
          <thead className="border-b border-slate-200 text-sm text-ink-soft">
            <tr>
              <th className="px-4 py-2">Property ID</th>
              <th className="px-4 py-2">Class</th>
              <th className="px-4 py-2">Address</th>
              <th className="px-4 py-2">District</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-semibold">{row.code}</td>
                <td className="px-4 py-2">{PROPERTY_CLASS_LABELS[row.propertyClass]}</td>
                <td className="px-4 py-2">{row.addressLine}</td>
                <td className="px-4 py-2">{row.district ?? '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" className={ghostButtonClass} onClick={() => setEditing({ id: row.id, form: toForm(row) })}>Edit</button>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-soft">No properties found.</td></tr>}
            {loading && !data && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-soft">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  )
}
