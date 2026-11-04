import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ErrorText, errorMessage } from './ui.tsx'

export interface DialogField {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'email' | 'textarea' | 'select'
  options?: { value: string; label: string }[]
  required?: boolean
  placeholder?: string
  initial?: string
  step?: string
  min?: string
  max?: string
}

// A small form in a dialog, used where a screen needs a few answers before an
// action (a payment, a reason for voiding) instead of a browser prompt box.
export default function FormDialog({ title, intro, fields, submitLabel, tone, onSubmit, onClose }: { title: string; intro?: string; fields: DialogField[]; submitLabel: string; tone?: 'danger'; onSubmit: (values: Record<string, string>) => Promise<void>; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try { await onSubmit(values); onClose() } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }
  return createPortal(
    <div className="pd-drawer-backdrop in-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="in-modal" onSubmit={submit} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {intro && <p>{intro}</p>}
        {fields.map((f, i) => (
          <label key={f.name} className="va-f">
            {f.label}
            {f.type === 'textarea' ? <textarea autoFocus={i === 0} rows={3} required={f.required} placeholder={f.placeholder} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              : f.type === 'select' ? <select value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : <input autoFocus={i === 0} type={f.type ?? 'text'} required={f.required} placeholder={f.placeholder} step={f.step} min={f.min} max={f.max} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />}
          </label>
        ))}
        <ErrorText message={error} />
        <div><button type="button" className="pd-btn is-ghost" onClick={onClose}>Cancel</button><button className={`pd-btn ${tone === 'danger' ? 'is-danger' : 'is-primary'}`} disabled={busy}>{busy ? 'Working…' : submitLabel}</button></div>
      </form>
    </div>,
    document.body,
  )
}
