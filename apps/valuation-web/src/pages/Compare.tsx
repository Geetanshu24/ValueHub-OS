import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorText, errorMessage, PageHeader } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

type Status = 'match' | 'differs' | 'document_only' | 'site_only' | 'none' | 'check'
interface Decision { outcome: string; reason: string; by: string | null; at: string; stale: boolean }
interface Row { key: string; label: string; document: string; fromDocuments: { label: string; value: string }[]; site: string; status: Status; note?: string; decision?: Decision }
interface Compare { visit: { status: string; visitedAt: string; inspector: string } | null; rows: Row[]; summary: { match: number; differs: number; missing: number; open: number } }

const STATUS: Record<Status, { text: string; tone: string }> = {
  match: { text: '✓ Matches', tone: 'ok' },
  differs: { text: '≠ Differs', tone: 'bad' },
  document_only: { text: 'Not checked on site', tone: 'warn' },
  site_only: { text: 'Not in documents', tone: 'warn' },
  check: { text: 'Read both', tone: 'warn' },
  none: { text: '—', tone: 'none' },
}
const OUTCOMES: [string, string][] = [
  ['DOCUMENT_CORRECT', 'The document is right'], ['SITE_CORRECT', 'The site is right'], ['EXPLAINED', 'Both are right, explained below'],
  ['NOT_APPLICABLE', 'Does not apply to this property'], ['NOT_AVAILABLE', 'Not available, leave it blank'],
]
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES)
const VISIT_LABEL: Record<string, string> = { SCHEDULED: 'visit planned', IN_PROGRESS: 'on site, not yet submitted', SUBMITTED: 'submitted', REVIEWED: 'submitted and field-reviewed' }

// What the documents say next to what the inspector found, so the drafter can cross-check before writing the report.
export default function Compare() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const canDecide = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'DRAFTER'
  const data = useFetch<Compare>(`/assignments/${id}/bank-report/compare`)
  const c = data.data
  const [deciding, setDeciding] = useState<string | null>(null)
  const [form, setForm] = useState({ outcome: 'EXPLAINED', reason: '' })
  const [error, setError] = useState<string | null>(null)
  const decide = async (key: string) => {
    try { await api.put(`/assignments/${id}/bank-report/compare/${key}`, form); setDeciding(null); setError(null); data.reload() } catch (caught) { setError(errorMessage(caught)) }
  }
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Compare" title="As per documents, as per site" subtitle="Check every line where the two disagree before the report goes to the valuer."
        action={<div className="flex gap-2"><Link to={`/assignments/${id}/workbench`} className="pd-btn is-ghost">Back to workbench</Link><Link to={`/assignments/${id}/bank-report`} className="pd-btn is-primary">Go to the bank report →</Link></div>} />
      <ErrorText message={error ?? data.error} />
      {!c ? <p className="pd-muted">Loading…</p> : <>
        <div className="wb-brief">
          <span><small>Site visit</small><b>{c.visit ? `${c.visit.inspector} · ${VISIT_LABEL[c.visit.status] ?? c.visit.status}` : 'Not started yet'}</b></span>
          <span><small>Match</small><b>{c.summary.match}</b></span>
          <span><small>Differ</small><b>{c.summary.differs}</b></span>
          <span><small>One side missing</small><b>{c.summary.missing}</b></span>
          <span><small>Waiting for a decision</small><b>{c.summary.open}</b></span>
        </div>
        {!c.visit && <p className="pd-flag">The inspector has not started the site visit, so there is nothing to compare against yet.</p>}
        <div className="wb-left"><div className="wb-scroll">
          <table className="cmp-table">
            <thead><tr><th>Fact</th><th>As per documents</th><th>As per site</th><th>Result</th></tr></thead>
            <tbody>
              {c.rows.filter((r) => r.status !== 'none').map((r) => {
                const distinct = new Set(r.fromDocuments.map((d) => d.value.toLowerCase()))
                return (
                  <tr key={r.key} className={`is-${STATUS[r.status].tone}`}>
                    <th scope="row">{r.label}</th>
                    <td>{r.document || '—'}{distinct.size > 1 && <small>{r.fromDocuments.map((d) => `${d.label}: ${d.value}`).join(' · ')}</small>}</td>
                    <td>{r.site || '—'}</td>
                    <td>
                      <span className={`cmp-pill is-${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>{r.note && <small>{r.note}</small>}
                      {r.decision && <small className={r.decision.stale ? 'cmp-stale' : 'cmp-decided'}>{r.decision.stale ? 'Values changed since the decision: decide again. ' : ''}Decided: {OUTCOME_LABEL[r.decision.outcome] ?? r.decision.outcome}{r.decision.reason ? ` — ${r.decision.reason}` : ''} ({r.decision.by ?? 'someone'}, {new Date(r.decision.at).toLocaleDateString('en-IN')})</small>}
                      {canDecide && r.status !== 'match' && r.status !== 'none' && (deciding === r.key
                        ? <div className="cmp-form">
                            <select className="ui-input" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                            <input className="ui-input" placeholder="Why? (and what evidence you saw)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                            <span><button type="button" className="pd-btn is-ghost" onClick={() => setDeciding(null)}>Cancel</button> <button type="button" className="pd-btn is-primary" onClick={() => void decide(r.key)}>Save decision</button></span>
                          </div>
                        : <button type="button" className="chk-link" onClick={() => { setDeciding(r.key); setForm({ outcome: r.decision?.outcome ?? 'EXPLAINED', reason: r.decision?.reason ?? '' }) }}>{r.decision ? 'Change decision' : 'Record a decision'}</button>)}
                    </td>
                  </tr>
                )
              })}
              {c.rows.every((r) => r.status === 'none') && <tr><td colSpan={4} className="pd-muted">Nothing recorded yet. Fill in the workbench and the site visit first.</td></tr>}
            </tbody>
          </table>
        </div></div>
      </>}
    </div>
  )
}
