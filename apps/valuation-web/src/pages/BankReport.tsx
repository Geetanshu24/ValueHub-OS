import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, ErrorText, errorMessage, ghostButtonClass, buttonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { api, downloadFile } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface FormField { key: string; label: string; section: string; default: string; vacant: boolean; long: boolean; options?: string[] }
interface Issue { severity: 'warn' | 'info'; message: string }
interface Suggestion { key: string; label: string; text: string; basis: string }
interface Form { format: string; formats: { id: string; label: string }[]; title: string; fields: FormField[]; values: Record<string, string>; suggested: string[]; saved: boolean; locked: boolean; updates: Record<string, string>; conflicts: { key: string; label: string }[] }

export default function BankReport() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const roleCanEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'DRAFTER'
  const [chosen, setChosen] = useState('')
  const query = chosen ? `?format=${chosen}` : ''
  const form = useFetch<Form>(`/assignments/${id}/bank-report${query}`)
  // Once the valuer approves, the report is locked (the valuer can reopen it for a revision).
  const canEdit = roleCanEdit && !form.data?.locked
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [onlyOpen, setOnlyOpen] = useState(true)
  // Sections start closed except the first one that needs you; whatever you open or close stays that way.
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [issues, setIssues] = useState<{ title: string; items: Issue[] } | null>(null)
  const [suggestions, setSuggestions] = useState<{ title: string; items: Suggestion[] } | null>(null)
  const ai = useFetch<{ enabled: boolean }>(`/assignments/${id}/bank-report/ai-status`)

  useEffect(() => { if (form.data) setValues(form.data.values) }, [form.data])

  const suggested = new Set(form.data?.suggested ?? [])
  // Answers saved earlier that the workbench and the case records now say differently.
  const updates = Object.entries(form.data?.updates ?? {}).filter(([key, value]) => values[key] !== value)
  const sections = Object.entries((form.data?.fields ?? []).reduce<Record<string, FormField[]>>((groups, f) => { (groups[f.section] ??= []).push(f); return groups }, {}))
  const set = (key: string, value: string) => { setValues((current) => ({ ...current, [key]: value })); setMessage(null) }
  const field = (key: string, long = false, placeholder?: string, options?: string[]) => {
    const props = { className: inputClass, value: values[key] ?? '', placeholder, disabled: !canEdit, onChange: (e: { target: { value: string } }) => set(key, e.target.value) }
    // A saved or suggested answer that is not in the list stays selectable.
    const current = values[key] ?? ''
    const choices = options && current && !options.includes(current) ? [...options, current] : options
    return (
      <span className="bank-field">
        {choices ? (
          <select className={inputClass} value={current} disabled={!canEdit} onChange={(e) => set(key, e.target.value)}>
            <option value="">{placeholder ? `Default: ${placeholder}` : 'Select…'}</option>
            {choices.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : long ? <textarea rows={3} {...props} /> : <input {...props} />}
        {form.data?.updates[key] && values[key] !== form.data.updates[key] && canEdit && <small className="bank-update">Records now say: “{form.data.updates[key].length > 90 ? `${form.data.updates[key].slice(0, 90)}…` : form.data.updates[key]}” <button type="button" onClick={() => set(key, form.data!.updates[key])}>Use this</button></small>}
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
  // Saves what is on screen, then tells whoever gave out the case that the draft is ready to check.
  const sendForChecking = async () => {
    setBusy('ready'); setError(null)
    try {
      await api.put(`/assignments/${id}/bank-report${query}`, { values })
      await api.post(`/assignments/${id}/bank-report/ready`, {})
      setMessage('Sent for checking')
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

  // A box needs you when it is empty with no standard answer, was filled from records and not yet confirmed, or the records now say something else.
  const needs = (f: FormField) => {
    const v = (values[f.key] ?? '').trim()
    const fromRecords = suggested.has(f.key) && values[f.key] === form.data?.values[f.key]
    return (!v && !f.default && !f.vacant) || fromRecords || (!!form.data?.updates[f.key] && values[f.key] !== form.data.updates[f.key])
  }
  const attentionTotal = (form.data?.fields ?? []).filter(needs).length

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Bank report" title={form.data.title} subtitle="Boxes filled from your documents are marked “please check”. Only the boxes that need you are shown."
        action={<Link to={`/assignments/${id}`} className={ghostButtonClass}>Back to case</Link>} />
      <ErrorText message={error} />

      {form.data.locked && <p className="pd-notice" role="status">This report is approved and locked. The valuer can reopen it for a revision.</p>}
      {form.data.conflicts.length > 0 && <p className="pd-flag" role="alert">The documents disagree on {form.data.conflicts.map((c) => c.label.replace(/\s*\(sq\. ?m\)/i, '')).join(', ')}. These boxes are left empty on purpose. <Link to={`/assignments/${id}/workbench`}>Choose which document to use in the workbench</Link>.</p>}
      <div className="br-bar">
        <select className="ui-input br-format" aria-label="Bank format" value={form.data.format} disabled={busy !== null} onChange={(e) => { setChosen(e.target.value); setMessage(null) }}>
          {form.data.formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {canEdit && <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>}
        <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void download('docx')}>{busy === 'docx' ? 'Preparing…' : 'Word'}</button>
        <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
        {canEdit && <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void sendForChecking()}>{busy === 'ready' ? 'Sending…' : 'Send for checking'}</button>}
        {(user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER') && <Link to={`/assignments/${id}/check`} className="pd-btn is-primary">Next: check &amp; send →</Link>}
        {message && <span className="pd-muted">{message}</span>}
      </div>

      <div className="br-sub">
        <label className="br-toggle"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Show only boxes that need me <b>({attentionTotal})</b></label>
        {canEdit && updates.length > 0 && <button type="button" className="chk-link" onClick={() => { for (const [key, value] of updates) set(key, value) }}>Update {updates.length} answer{updates.length === 1 ? '' : 's'} from the documents</button>}
        <details className="br-more">
          <summary>More tools</summary>
          <div className="br-more-body">
            <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('check')}>{busy === 'check' ? 'Checking…' : 'Check the report'}</button>
            {canEdit && ai.data?.enabled && <>
              <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('draft')}>{busy === 'draft' ? 'Writing…' : 'Draft wording with AI'}</button>
              <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('photos')}>{busy === 'photos' ? 'Reading photos…' : 'Read photos with AI'}</button>
              <button type="button" className={ghostButtonClass} disabled={busy !== null} onClick={() => void assist('review')}>{busy === 'review' ? 'Reviewing…' : 'AI review'}</button>
            </>}
          </div>
        </details>
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

      {sections.map(([heading, fields]) => {
        const attention = fields.filter(needs).length
        const shown = onlyOpen ? fields.filter(needs) : fields
        const firstNeeding = sections.find(([, f]) => f.some(needs))?.[0]
        const isOpen = heading in opened ? opened[heading] : heading === (firstNeeding ?? sections[0]?.[0])
        return (
          <details key={heading} className="br-sec" open={isOpen} onToggle={(e) => { const now = e.currentTarget.open; if (now !== isOpen) setOpened((cur) => ({ ...cur, [heading]: now })) }}>
            <summary><b>{heading}</b><span className={attention > 0 ? 'br-badge is-needs' : 'br-badge'}>{attention > 0 ? `${attention} need${attention === 1 ? 's' : ''} you` : 'All filled'}</span></summary>
            <div className="bank-rows">
              {shown.length === 0 ? <p className="pd-muted">Nothing needs you here. Untick “Show only boxes that need me” to see every box.</p> : shown.map((f) => (
                <label key={f.key} className="bank-row">
                  <span className="bank-label">{f.label}</span>
                  {field(f.key, f.long, f.default || (f.vacant ? 'Vacant Plot' : undefined), f.options)}
                </label>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}
