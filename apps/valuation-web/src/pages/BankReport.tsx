import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Card, ErrorText, errorMessage, ghostButtonClass, buttonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { api, downloadFile } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface FormField { key: string; label: string; section: string; default: string; vacant: boolean; long: boolean }
interface Issue { severity: 'warn' | 'info'; message: string }
interface Suggestion { key: string; label: string; text: string; basis: string }
interface Form { format: string; formats: { id: string; label: string }[]; title: string; fields: FormField[]; values: Record<string, string>; suggested: string[]; saved: boolean }

export default function BankReport() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const canEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const [params] = useSearchParams()
  const [chosen, setChosen] = useState(params.get('format') ?? '')
  const query = chosen ? `?format=${chosen}` : ''
  const form = useFetch<Form>(`/assignments/${id}/bank-report${query}`)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [issues, setIssues] = useState<{ title: string; items: Issue[] } | null>(null)
  const [suggestions, setSuggestions] = useState<{ title: string; items: Suggestion[] } | null>(null)
  const ai = useFetch<{ enabled: boolean }>(`/assignments/${id}/bank-report/ai-status`)

  useEffect(() => { if (form.data) setValues(form.data.values) }, [form.data])

  const suggested = new Set(form.data?.suggested ?? [])
  const sections = Object.entries((form.data?.fields ?? []).reduce<Record<string, FormField[]>>((groups, f) => { (groups[f.section] ??= []).push(f); return groups }, {}))
  const set = (key: string, value: string) => { setValues((current) => ({ ...current, [key]: value })); setMessage(null) }
  const field = (key: string, long = false, placeholder?: string) => {
    const props = { className: inputClass, value: values[key] ?? '', placeholder, disabled: !canEdit, onChange: (e: { target: { value: string } }) => set(key, e.target.value) }
    return (
      <span className="bank-field">
        {long ? <textarea rows={3} {...props} /> : <input {...props} />}
        {suggested.has(key) && values[key] === form.data?.values[key] && <small className="pd-muted">filled from records, please check</small>}
      </span>
    )
  }

  const save = async () => {
    setBusy('save'); setError(null)
    try {
      await api.put(`/assignments/${id}/bank-report${query}`, { values })
      setMessage('Saved')
      form.reload()
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(null) }
  }
  const download = async (kind: 'docx' | 'pdf') => {
    setBusy(kind); setError(null)
    try {
      if (canEdit) await api.put(`/assignments/${id}/bank-report${query}`, { values })
      await downloadFile(`/assignments/${id}/bank-report/${kind}${query}`, `valuation-report.${kind}`)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(null) }
  }

  // The checks and the AI read what is saved, so the boxes as they are now are saved first.
  const assist = async (kind: 'check' | 'review' | 'draft' | 'photos') => {
    setBusy(kind); setError(null); setIssues(null); setSuggestions(null)
    try {
      if (canEdit) await api.put(`/assignments/${id}/bank-report${query}`, { values })
      const base = `/assignments/${id}/bank-report`
      if (kind === 'check') setIssues({ title: 'Check before you send', items: (await api.get<{ issues: Issue[] }>(`${base}/check${query}`)).issues })
      else if (kind === 'review') setIssues({ title: 'AI review', items: (await api.post<{ issues: Issue[] }>(`${base}/ai/review${query}`, {})).issues })
      else if (kind === 'draft') setSuggestions({ title: 'Wording drafted by AI', items: (await api.post<{ drafts: Suggestion[] }>(`${base}/ai/draft${query}`, {})).drafts })
      else setSuggestions({ title: 'What the photographs show (AI)', items: (await api.post<{ suggestions: Suggestion[] }>(`${base}/ai/photos${query}`, {})).suggestions })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(null) }
  }
  const use = (item: Suggestion) => { set(item.key, item.text); setSuggestions((current) => (current ? { ...current, items: current.items.filter((x) => x !== item) } : current)) }

  if (form.error && !form.data) return <ErrorText message={form.error} />
  if (!form.data) return <p className="pd-muted">Loading…</p>

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Bank format" title={form.data.title} subtitle="The report is made in the bank's own format. Check the answers below: anything filled from your documents and records is a starting point to confirm. An empty box shows the bank's standard answer, if there is one (greyed)."
        action={<Link to={`/assignments/${id}`} className={ghostButtonClass}>Back to assignment</Link>} />
      <ErrorText message={error} />
      <label className="bank-row">
        <span className="bank-label">Bank format</span>
        <select className={inputClass} value={form.data.format} disabled={busy !== null} onChange={(e) => { setChosen(e.target.value); setMessage(null) }}>
          {form.data.formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save answers'}</button>}
        <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void download('docx')}>{busy === 'docx' ? 'Preparing…' : 'Download Word (.docx)'}</button>
        <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
        {message && <span className="pd-muted">{message}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('check')}>{busy === 'check' ? 'Checking…' : 'Check report'}</button>
        {canEdit && ai.data?.enabled && <>
          <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('draft')}>{busy === 'draft' ? 'Writing…' : 'Draft wording with AI'}</button>
          <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('photos')}>{busy === 'photos' ? 'Reading photos…' : 'Read photos with AI'}</button>
          <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('review')}>{busy === 'review' ? 'Reviewing…' : 'AI review'}</button>
        </>}
        {ai.data && !ai.data.enabled && <span className="pd-muted">AI help is off: add ANTHROPIC_API_KEY to the server settings to turn it on.</span>}
      </div>
      {issues && (
        <Card title={issues.title}>
          {issues.items.length === 0 ? <p className="pd-muted">Nothing found.</p> : <ul className="bank-issues">{issues.items.map((i, n) => <li key={n} className={i.severity === 'warn' ? 'is-warn' : ''}>{i.message}</li>)}</ul>}
        </Card>
      )}
      {suggestions && (
        <Card title={suggestions.title}>
          {suggestions.items.length === 0 ? <p className="pd-muted">Nothing to suggest.</p> : <>
            <p className="pd-muted">These are suggestions. Use the ones that are right, then save.</p>
            {suggestions.items.map((item) => (
              <div key={item.key} className="bank-suggestion"><div><b>{item.label}</b><p>{item.text}</p><small className="pd-muted">{item.basis}</small></div><button type="button" className={ghostButtonClass} onClick={() => use(item)}>Use</button></div>
            ))}
            <button type="button" className={ghostButtonClass} onClick={() => { suggestions.items.forEach(use) }}>Use all</button>
          </>}
        </Card>
      )}

      {sections.map(([heading, fields]) => (
        <Card key={heading} title={heading}>
          <div className="bank-rows">
            {fields.map((f) => (
              <label key={f.key} className="bank-row">
                <span className="bank-label">{f.label}</span>
                {field(f.key, f.long, f.default || (f.vacant ? 'Vacant Plot' : undefined))}
              </label>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
