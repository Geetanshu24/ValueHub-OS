import { Link, useParams } from 'react-router-dom'
import { ErrorText, PageHeader } from '../components/ui.tsx'
import { useFetch } from '../lib/useFetch.ts'

type Status = 'match' | 'differs' | 'document_only' | 'site_only' | 'none' | 'check'
interface Row { key: string; label: string; document: string; fromDocuments: { label: string; value: string }[]; site: string; status: Status; note?: string }
interface Compare { visit: { status: string; visitedAt: string; inspector: string } | null; rows: Row[]; summary: { match: number; differs: number; missing: number } }

const STATUS: Record<Status, { text: string; tone: string }> = {
  match: { text: '✓ Matches', tone: 'ok' },
  differs: { text: '≠ Differs', tone: 'bad' },
  document_only: { text: 'Not checked on site', tone: 'warn' },
  site_only: { text: 'Not in documents', tone: 'warn' },
  check: { text: 'Read both', tone: 'warn' },
  none: { text: '—', tone: 'none' },
}
const VISIT_LABEL: Record<string, string> = { SCHEDULED: 'visit planned', IN_PROGRESS: 'on site, not yet submitted', SUBMITTED: 'submitted', REVIEWED: 'submitted and field-reviewed' }

// What the documents say next to what the inspector found, so the drafter can cross-check before writing the report.
export default function Compare() {
  const { id = '' } = useParams()
  const data = useFetch<Compare>(`/assignments/${id}/bank-report/compare`)
  const c = data.data
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Compare" title="As per documents, as per site" subtitle="Check every line where the two disagree before the report goes to the valuer."
        action={<div className="flex gap-2"><Link to={`/assignments/${id}/workbench`} className="pd-btn is-ghost">Back to workbench</Link><Link to={`/assignments/${id}/bank-report`} className="pd-btn is-primary">Go to the bank report →</Link></div>} />
      <ErrorText message={data.error} />
      {!c ? <p className="pd-muted">Loading…</p> : <>
        <div className="wb-brief">
          <span><small>Site visit</small><b>{c.visit ? `${c.visit.inspector} · ${VISIT_LABEL[c.visit.status] ?? c.visit.status}` : 'Not started yet'}</b></span>
          <span><small>Match</small><b>{c.summary.match}</b></span>
          <span><small>Differ</small><b>{c.summary.differs}</b></span>
          <span><small>One side missing</small><b>{c.summary.missing}</b></span>
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
                    <td><span className={`cmp-pill is-${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>{r.note && <small>{r.note}</small>}</td>
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
