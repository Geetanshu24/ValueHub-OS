import { Fragment, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertOctagon, ArrowRight, CheckCircle2, ChevronDown, FileQuestion, HelpCircle, Scale, ShieldAlert } from 'lucide-react'
import { type ComparisonStatus } from '@value-hub/valuation-shared'
import { ErrorText, errorMessage } from '../components/ui.tsx'
import { useToast } from '../components/shell/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Evidence { value: string; source: string }
interface Treatment { key: string; label: string; hint: string; outcome: string; noteTemplate: string }
interface Discrepancy { id: string; status: 'UNRESOLVED' | 'RESOLVED' | 'DISCLOSED' | 'ESCALATED'; resolutionNote: string | null; treatment: string | null; resolvedAt: string | null }
interface Row {
  key: string; label: string; group: string; document: Evidence | null; site: Evidence | null; status: ComparisonStatus
  delta: string | null; tolerance: string | null; needsResolution: boolean; hint: string | null; treatments: Treatment[]; discrepancy: Discrepancy | null
}
interface Comparison {
  rows: Row[]; summary: Record<ComparisonStatus, number>; open: number; canProceed: boolean
  others: { id: string; fieldKey: string; description: string; status: string }[]; inspection: { visitedAt: string; by: string } | null
}

const isOpen = (d: Discrepancy | null) => !d || d.status === 'UNRESOLVED' || d.status === 'ESCALATED'
const BADGE: Record<ComparisonStatus, [string, string]> = {
  consistent: ['badge-matched', '✅ Consistent'], verify: ['badge-verify', '⚠️ Needs a look'], mismatch: ['badge-mismatch', '🔴 Mismatch'], missing: ['badge-missing', '⬜ Missing'], document: ['badge-missing', '⬜ Doc Governed'],
}

function Cell({ evidence, empty, tone }: { evidence: Evidence | null; empty: string; tone?: string }) {
  return evidence
    ? <><div className={`font-bold ${tone ?? ''}`}>{evidence.value}</div><span className="font-mono text-[9px] text-slate-400">Source: {evidence.source}</span></>
    : <div className="italic text-slate-400">{empty}</div>
}

function ResolvePanel({ row, id, canEdit, onDone, help }: { row: Row; id: string; canEdit: boolean; onDone: () => void; help?: { explanation: string; suggestedNote: string } }) {
  const toast = useToast()
  const current = row.discrepancy
  const [treatment, setTreatment] = useState(row.treatments.find((t) => t.key === current?.treatment)?.key ?? row.treatments[0]?.key ?? '')
  const [note, setNote] = useState(current?.resolutionNote ?? row.treatments[0]?.noteTemplate ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pick = (key: string) => {
    const old = row.treatments.find((t) => t.key === treatment)
    setTreatment(key)
    if (!note.trim() || note === old?.noteTemplate) setNote(row.treatments.find((t) => t.key === key)?.noteTemplate ?? '')
  }
  const save = async () => {
    setBusy(true); setError(null)
    try { await api.post(`/assignments/${id}/comparison/${row.key}/resolve`, { treatment, note }); toast(`${row.label}: decision saved`, 'success'); onDone() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  return (
    <tr className="bg-red-50/90 text-xs">
      <td colSpan={6} className="border-t border-red-200 p-4">
        <div className="space-y-3 rounded-xl border border-red-300 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex items-center space-x-2"><ShieldAlert className="h-4 w-4 text-brand-red" /><h4 className="text-xs font-bold text-brand-red">Resolve Discrepancy: {row.label}</h4></div>
            <span className="font-mono text-[10px] text-slate-500">Documents: {row.document?.value ?? '—'} | Site: {row.site?.value ?? '—'}</span>
          </div>
          <div className="space-y-1.5 text-xs text-slate-700">
            <span className="block font-semibold text-slate-800">Select Valuer Resolution Treatment:</span>
            {row.treatments.map((t) => (
              <label key={t.key} className="flex cursor-pointer items-start space-x-2 rounded border border-slate-200 p-2 hover:bg-slate-50">
                <input type="radio" name={`t-${row.key}`} checked={treatment === t.key} disabled={!canEdit} onChange={() => pick(t.key)} className="mt-0.5" />
                <div><strong className="block text-slate-900">{t.label}</strong><span className="text-[10px] text-slate-500">{t.hint}</span></div>
              </label>
            ))}
          </div>
          {help && <div className="rounded border border-violet-200 bg-violet-50 p-2 text-[11px] text-slate-700">
            <b className="text-violet-800">✨ AI suggestion (check it yourself)</b>
            <p className="mt-1">{help.explanation}</p>
            {canEdit && help.suggestedNote && <div className="mt-1.5 flex items-start justify-between gap-2"><em className="text-slate-600">“{help.suggestedNote}”</em><button type="button" className="shrink-0 rounded border border-violet-300 bg-white px-2 py-0.5 font-semibold text-violet-800 hover:bg-violet-100" onClick={() => setNote(help.suggestedNote)}>Use as note</button></div>}
          </div>}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">Valuer's Formal Disclosure Note *</label>
            <textarea rows={3} value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-slate-300 bg-slate-50 p-2 text-xs focus:bg-white" />
          </div>
          <ErrorText message={error} />
          <div className="flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="text-[11px] text-slate-500">Nothing in the documents or the site record is changed.</span>
            {canEdit && <button type="button" disabled={busy || note.trim().length < 10} onClick={() => void save()} className="rounded bg-emerald-700 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50">{busy ? 'Saving…' : 'Save Resolution & Update Workbench ✓'}</button>}
          </div>
        </div>
      </td>
    </tr>
  )
}

export default function ComparisonPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const canEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'REVIEWER'
  const data = useFetch<Comparison>(`/assignments/${id}/comparison`)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const aiStatus = useFetch<{ enabled: boolean }>('/ai/status')
  const [help, setHelp] = useState<Record<string, { explanation: string; suggestedNote: string }>>({})
  const [helpBusy, setHelpBusy] = useState(false)
  const [helpError, setHelpError] = useState<string | null>(null)
  const askAi = async () => {
    setHelpBusy(true); setHelpError(null)
    try {
      const result = await api.post<{ rows: { key: string; explanation: string; suggestedNote: string }[] }>(`/assignments/${id}/comparison/ai-explain`, {})
      setHelp(Object.fromEntries(result.rows.map((row) => [row.key, row])))
      const first = result.rows[0]?.key
      if (first) setOpenKey(first)
    } catch (caught) { setHelpError(errorMessage(caught)) } finally { setHelpBusy(false) }
  }

  if (data.error && !data.data) return <ErrorText message={data.error} />
  if (!data.data) return <p className="text-xs text-slate-500">Loading…</p>
  const d = data.data
  const tile = (n: number, title: string, sub: string, cls: string, num: string, Icon: typeof CheckCircle2, iconCls: string) => (
    <div className={`flex items-center justify-between rounded-xl border p-3 shadow-xs ${cls}`}><div><span className="block text-[10px] font-bold uppercase tracking-wider">{title}</span><span className={`font-mono text-xl font-black ${num}`}>{n}</span><span className="block text-[10px] opacity-80">{sub}</span></div><Icon className={`h-6 w-6 ${iconCls}`} /></div>
  )
  const settledCount = d.rows.filter((r) => r.discrepancy && !isOpen(r.discrepancy)).length

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-xl bg-gradient-to-r from-brand-navy to-slate-900 p-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gold font-bold text-brand-navy"><Scale className="h-5 w-5" /></div>
            <div><h2 className="text-sm font-bold tracking-tight">⚖️ Document vs Site Evidence Comparison Engine</h2><p className="text-xs text-slate-300">{d.inspection ? `Site layer: inspection on ${new Date(d.inspection.visitedAt).toLocaleDateString('en-IN')} by ${d.inspection.by}` : 'No inspection recorded yet'} · Independent Cross-Audit</p></div>
          </div>
        </div>
        {canEdit && aiStatus.data?.enabled && (d.summary.mismatch > 0 || d.summary.verify > 0) && <div className="flex items-center gap-3 pt-1"><button type="button" disabled={helpBusy} onClick={() => void askAi()} className="rounded-lg border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20 disabled:opacity-60">{helpBusy ? '✨ AI is reading the differences…' : Object.keys(help).length ? '✨ Ask the AI again' : '✨ Ask AI to explain the differences'}</button>{helpError && <span className="text-[11px] text-red-200">{helpError}</span>}{Object.keys(help).length > 0 && <span className="text-[11px] text-violet-200">Open a mismatch row to see the AI's explanation.</span>}</div>}
        <p className="border-t border-white/10 pt-1 text-[11px] text-amber-200/90"><strong>Core Architecture Principle:</strong> The system highlights discrepancies between the Document Layer and the Site Layer. AI assists but forces human valuer resolution — no field value is auto-overwritten.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {tile(d.summary.consistent, 'Consistent Matched', 'No action required', 'border-emerald-200 bg-emerald-50 text-emerald-800', 'text-emerald-700', CheckCircle2, 'text-emerald-500')}
        {tile(d.summary.verify, 'Needs Verification', 'Within tolerance / note needed', 'border-amber-200 bg-amber-50 text-amber-800', 'text-amber-700', HelpCircle, 'text-amber-500')}
        {tile(d.summary.mismatch, 'Critical Mismatches', 'Human resolution mandatory', 'border-red-200 bg-red-50 text-red-800', 'text-brand-red', AlertOctagon, 'text-brand-red')}
        {tile(d.summary.missing + d.summary.document, 'Missing Evidence', 'Unverified in one layer', 'border-slate-200 bg-slate-100 text-slate-700', 'text-slate-700', FileQuestion, 'text-slate-400')}
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="select-none bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              <tr><th className="w-44 px-3.5 py-3">Evidence Parameter</th><th className="w-72 px-3 py-3">Document Layer (Extracted)</th><th className="w-72 px-3 py-3">Site Layer (Independent Field)</th><th className="w-36 px-2 py-3 text-center">Audit Status</th><th className="w-24 px-2 py-3 text-center">Tolerance</th><th className="w-56 px-3 py-3">Resolution / Note Action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.rows.map((r, i) => {
                const settled = Boolean(r.discrepancy && !isOpen(r.discrepancy))
                const critical = r.needsResolution && !settled
                const [badge, text] = settled ? ['badge-matched', '✅ Settled'] : BADGE[r.status]
                const bg = critical ? 'border-l-4 border-l-brand-red bg-red-50/50 hover:bg-red-50/80' : r.status === 'verify' ? 'bg-amber-50/30 hover:bg-slate-50/80' : i % 2 ? 'bg-slate-50/40 hover:bg-slate-50/80' : 'hover:bg-slate-50/80'
                return (
                  <Fragment key={r.key}>
                    <tr className={`transition ${bg}`}>
                      <td className={`px-3.5 ${critical ? 'py-3 font-black text-brand-red' : 'py-2.5 font-bold text-slate-900'}`}>{r.label}<span className={`block text-[9px] font-normal ${critical ? 'text-red-600' : 'text-slate-400'}`}>{r.group}</span></td>
                      <td className="px-3 py-2.5 text-slate-700"><Cell evidence={r.document} empty="Not read from a document" /></td>
                      <td className="px-3 py-2.5 text-slate-700"><Cell evidence={r.site} empty={r.status === 'document' ? '— (Physical inspection cannot verify this)' : 'Not recorded'} tone={critical ? 'text-brand-red' : ''} /></td>
                      <td className="px-2 py-2.5 text-center"><span className={`${badge} rounded-full px-2 py-0.5 text-[10px] font-bold`}>{r.delta && !settled ? `${r.status === 'mismatch' ? '🔴' : '⚠️'} ${r.delta}` : text}</span></td>
                      <td className="px-2 py-2.5 text-center font-mono text-[10px] text-slate-500">{r.tolerance ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {r.treatments.length > 0 && r.discrepancy
                          ? <button type="button" onClick={() => setOpenKey(openKey === r.key ? null : r.key)} className={settled ? 'flex items-center space-x-1 text-[11px] font-semibold text-brand-navy hover:underline' : 'flex items-center space-x-1 rounded bg-brand-red px-2.5 py-1 text-[10px] font-bold text-white shadow-xs hover:bg-red-700'}><span>{settled ? 'View Valuer Note' : 'Resolve Required'}</span><ChevronDown className="h-3 w-3" /></button>
                          : <span className="text-[11px] text-slate-400">{r.hint ?? (r.status === 'consistent' ? 'Match confirmed' : '—')}</span>}
                      </td>
                    </tr>
                    {settled && openKey !== r.key && r.discrepancy?.resolutionNote && (
                      <tr className="bg-amber-50/60 text-xs"><td colSpan={6} className="border-t border-amber-200 p-3"><div className="rounded border border-amber-200 bg-white p-2.5"><span className="font-bold text-amber-900">Valuer Finding · {r.treatments.find((t) => t.key === r.discrepancy?.treatment)?.label}:</span><p className="text-slate-700">{r.discrepancy.resolutionNote}</p></div></td></tr>
                    )}
                    {openKey === r.key && <ResolvePanel row={r} id={id} help={help[r.key]} canEdit={canEdit} onDone={() => { setOpenKey(null); data.reload() }} />}
                  </Fragment>
                )
              })}
              {d.others.map((o) => (
                <tr key={o.id} className="border-l-4 border-l-brand-red bg-red-50/50"><td className="px-3.5 py-3 font-black text-brand-red">{o.description}</td><td colSpan={3} className="px-3 py-3 text-slate-500">Flagged earlier ({o.fieldKey})</td><td /><td className="px-3 py-3"><Link to={`/assignments/${id}/inspection`} className="rounded bg-brand-red px-2.5 py-1 text-[10px] font-bold text-white">Settle on inspection page</Link></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* GATEWAY */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4 text-xs">
          <div className="space-y-1">
            <span className="block text-xs font-bold text-slate-800">Comparison Audit Gateway Status:</span>
            <div className="flex items-center space-x-3 text-[11px]">
              <span className="font-semibold text-emerald-700">✅ {d.summary.consistent} Consistent Rows</span><span className="text-slate-300">|</span>
              <span className="font-semibold text-emerald-700">✅ {settledCount} Decisions Noted</span><span className="text-slate-300">|</span>
              <span className={`font-bold ${d.open > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{d.open > 0 ? `⚠️ ${d.open} Mismatches (Requires Resolution)` : '✅ Nothing waiting'}</span>
            </div>
          </div>
          <button type="button" disabled={!d.canProceed} onClick={() => navigate(`/assignments/${id}/valuation`)} className="flex items-center space-x-1.5 rounded-lg bg-brand-navy px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-navyDark disabled:cursor-not-allowed disabled:opacity-50"><span>Generate Draft Valuation Report →</span><ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  )
}
