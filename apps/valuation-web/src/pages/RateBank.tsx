import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Database, LineChart, PlusCircle, Search } from 'lucide-react'
import { PROPERTY_CLASSES, PROPERTY_CLASS_LABELS, type PropertyClass } from '@value-hub/valuation-shared'
import { ErrorText, errorMessage } from '../components/ui.tsx'
import { useToast } from '../components/shell/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'
import { useList } from '../lib/useList.ts'

interface Rate { id: string; locality: string; propertyClass: PropertyClass; kind: 'TRANSACTION' | 'ASKING' | 'CIRCLE'; rate: string; unit: string; rateLow: string | null; rateHigh: string | null; ratePerSqft: number; observedOn: string; source: string; detail: string | null }
interface Place { locality: string; classes: string[]; count: number; freshestOn: string; low: number; high: number; benchmark: number }
interface Point { month: string; average: number; count: number }

const KINDS: [Rate['kind'], string, string][] = [['TRANSACTION', 'Registered Transaction', 'High'], ['ASKING', 'Online Listing / Dealer', 'Medium'], ['CIRCLE', 'Government Circle Rate', 'High']]
const UNITS: [string, string][] = [['SQ_FT', '/Sq.ft'], ['SQ_YD', '/Sq.yd'], ['SQ_M', '/Sq.m']]
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const today = () => new Date().toISOString().slice(0, 10)
const ago = (iso: string) => { const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000); return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago` }
const field = 'w-full rounded border border-slate-300 bg-slate-50 p-1.5 text-xs'

function TrendChart({ points }: { points: Point[] }) {
  if (points.length === 0) return <p className="py-10 text-center text-xs text-slate-500">No rates for this place in the last 12 months.</p>
  const W = 760, H = 170, P = 30
  const values = points.map((p) => p.average)
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1
  const x = (i: number) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1))
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.average)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${H - P} L${x(0)},${H - P} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Average rate per sq ft by month">
      <path d={area} fill="#1A365D" opacity="0.07" />
      <path d={line} fill="none" stroke="#1A365D" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.month}>
          <circle cx={x(i)} cy={y(p.average)} r="4" fill="#fff" stroke="#1A365D" strokeWidth="2"><title>{`${p.month}: ${inr(p.average)} per sq ft from ${p.count} entries`}</title></circle>
          <text x={x(i)} y={y(p.average) - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1A365D">{inr(p.average)}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748B">{p.month.slice(2).replace('-', '/')}</text>
        </g>
      ))}
    </svg>
  )
}

export default function RateBank() {
  const { user } = useAuth()
  const toast = useToast()
  const canAdd = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER'
  const [params] = useSearchParams()
  const assignment = params.get('assignment')
  const [q, setQ] = useState('')
  const [tick, setTick] = useState(0)
  const [place, setPlace] = useState('')
  const [error, setError] = useState<string | null>(null)
  const summary = useFetch<{ total: number; places: Place[] }>(`/market-rates/summary?t=${tick}`).data
  const list = useList<Rate>('/market-rates', { q: q || undefined, pageSize: 40 }, tick)
  const chosen = place || summary?.places[0]?.locality || ''
  const trend = useFetch<{ points: Point[] }>(chosen ? `/market-rates/trend?locality=${encodeURIComponent(chosen)}&t=${tick}` : null).data
  const [form, setForm] = useState({ locality: '', propertyClass: 'FLAT' as PropertyClass, kind: 'TRANSACTION', rate: '', unit: 'SQ_FT', rateLow: '', rateHigh: '', observedOn: today(), source: '', detail: '' })

  const add = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try {
      await api.post('/market-rates', { ...form, rate: Number(form.rate), rateLow: form.rateLow ? Number(form.rateLow) : undefined, rateHigh: form.rateHigh ? Number(form.rateHigh) : undefined, detail: form.detail || undefined })
      setForm({ ...form, rate: '', rateLow: '', rateHigh: '', source: '', detail: '' }); setTick((n) => n + 1); toast('Rate added to the market database', 'success')
    } catch (caught) { setError(errorMessage(caught)) }
  }
  const use = async (id: string) => {
    try { await api.post(`/market-rates/${id}/use-in/${assignment}`, {}); toast('Added to the case as comparable evidence', 'success') } catch (caught) { toast(errorMessage(caught), 'error') }
  }
  const microMarkets = summary?.places.length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-brand-navy via-slate-900 to-brand-navyDark p-4 text-white shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-gold font-bold text-brand-navy shadow-sm"><Database className="h-5 w-5" /></div>
          <div><h2 className="text-sm font-bold tracking-tight">Valuer's Private Intelligence — Market Rate Data Bank</h2><p className="text-xs text-slate-300">Proprietary rate transactions, dealer verifications &amp; government circle rate benchmarks</p></div>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <span className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 font-mono"><strong className="text-brand-gold">{summary?.total ?? 0}</strong> Rate Records</span>
          <span className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 font-mono"><strong className="text-emerald-400">{microMarkets}</strong> Micro-Markets</span>
        </div>
      </div>
      <ErrorText message={error} />

      <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-3">
        {summary?.places.length === 0 && <p className="text-slate-500">Add a rate below to start the record.</p>}
        {summary?.places.slice(0, 3).map((p) => {
          const high = p.count >= 5
          return (
            <div key={p.locality} className="relative space-y-2 overflow-hidden rounded-xl border border-brand-border bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between"><span className="text-sm font-bold text-brand-navy">{p.locality}</span><span className={`rounded px-2 py-0.5 text-[10px] font-bold ${high ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{high ? '🟢 High Conf' : '🟡 Low data'}</span></div>
              <p className="text-[11px] text-slate-500">{p.classes.map((c) => PROPERTY_CLASS_LABELS[c as PropertyClass] ?? c).join(' · ')}</p>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div><span className="block text-[10px] text-slate-400">Data Points:</span><strong className="text-slate-800">{p.count} Entries</strong></div>
                <div><span className="block text-[10px] text-slate-400">Freshest Entry:</span><span className="font-bold text-emerald-700">{ago(p.freshestOn)}</span></div>
                <div><span className="block text-[10px] text-slate-400">Current Range:</span><span className="text-slate-700">{inr(p.low)} - {inr(p.high)}/ft</span></div>
                <div><span className="block text-[10px] text-slate-400">Adopted Benchmark:</span><strong className="font-bold text-brand-navy">{inr(p.benchmark)} / Sq.ft</strong></div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-2"><button type="button" onClick={() => { setPlace(p.locality); setQ(p.locality) }} className="font-bold text-brand-navy hover:underline">View History ({p.count})</button></div>
            </div>
          )
        })}
      </div>

      <div className="space-y-3 rounded-xl border border-brand-border bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex items-center space-x-2"><LineChart className="h-4 w-4 text-brand-navy" /><h3 className="text-xs font-bold text-slate-800">12-Month Micro-Market Rate Trend</h3></div>
          <div className="flex items-center space-x-2 text-xs"><span className="text-slate-500">Selected Micro-Market:</span>
            <select value={chosen} onChange={(e) => setPlace(e.target.value)} className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-brand-navy">{summary?.places.map((p) => <option key={p.locality} value={p.locality}>{p.locality} (₹/Sq.ft)</option>)}</select></div>
        </div>
        {chosen ? <TrendChart points={trend?.points ?? []} /> : <p className="py-10 text-center text-xs text-slate-500">No rates yet.</p>}
      </div>

      {canAdd && (
        <div className="space-y-3 rounded-xl border border-brand-border bg-white p-4 shadow-xs">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-2"><PlusCircle className="h-4 w-4 text-brand-navy" /><h3 className="text-xs font-bold text-slate-800">Add New Market Rate Evidence Entry</h3></div>
          <form onSubmit={(e) => void add(e)} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label>Locality / Sector *<input required minLength={3} className={field} placeholder="Sector 14, Faridabad" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} /></label>
              <label>Property Type<select className={field} value={form.propertyClass} onChange={(e) => setForm({ ...form, propertyClass: e.target.value as PropertyClass })}>{PROPERTY_CLASSES.map((c) => <option key={c} value={c}>{PROPERTY_CLASS_LABELS[c]}</option>)}</select></label>
              <label>Adopted Rate *<div className="flex gap-1"><input required type="number" min="1" step="0.01" className={`${field} font-mono`} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /><select className={field} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div></label>
              <label>Date Observed *<input required type="date" max={today()} className={field} value={form.observedOn} onChange={(e) => setForm({ ...form, observedOn: e.target.value })} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label>Range: low<input type="number" min="1" step="0.01" className={`${field} font-mono`} value={form.rateLow} onChange={(e) => setForm({ ...form, rateLow: e.target.value })} /></label>
              <label>Range: high<input type="number" min="1" step="0.01" className={`${field} font-mono`} value={form.rateHigh} onChange={(e) => setForm({ ...form, rateHigh: e.target.value })} /></label>
              <label>Source Type *<select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Source Name / Broker *<input required minLength={2} className={field} placeholder="e.g. Goyal Associates" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label>
            </div>
            <div className="flex items-center justify-between pt-1">
              <input className="w-2/3 rounded border border-slate-300 bg-slate-50 p-1.5 text-xs" placeholder="Remarks / contact: corner property facing 12m wide road…" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
              <button type="submit" className="flex items-center space-x-1.5 rounded-lg bg-brand-navy px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-navyDark"><span>Add to Market Database ✓</span></button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-brand-border bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-3 text-xs">
          <span className="font-bold text-slate-800">Market Rate Historical Register ({list.data?.total ?? 0} Benchmarks)</span>
          <div className="relative w-64"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search locality, source or note…" className="w-full rounded border border-slate-300 bg-white py-1 pl-7 pr-3 text-xs focus:outline-none" /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-600"><tr><th className="p-2.5">Date</th><th className="p-2.5">Locality / Sector</th><th className="p-2.5">Property Type</th><th className="p-2.5 text-right">Adopted Rate</th><th className="p-2.5">Range</th><th className="p-2.5">Source Type</th><th className="p-2.5">Source Name</th><th className="p-2.5">Remarks</th><th className="p-2.5 text-center">Reliability</th>{assignment && <th className="p-2.5 text-center">Action</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {list.data?.items.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-slate-400">No rates match.</td></tr>}
              {list.data?.items.map((r) => {
                const unit = UNITS.find(([k]) => k === r.unit)?.[1] ?? ''
                const kind = KINDS.find(([k]) => k === r.kind)
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap p-2.5 font-mono text-[10px] text-slate-500">{new Date(r.observedOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="p-2.5 font-semibold text-slate-800">{r.locality}</td>
                    <td className="p-2.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium">{PROPERTY_CLASS_LABELS[r.propertyClass]}</span></td>
                    <td className="whitespace-nowrap p-2.5 text-right font-mono font-bold text-brand-navy">{inr(Number(r.rate))}{unit}</td>
                    <td className="whitespace-nowrap p-2.5 font-mono text-[10px]">{r.rateLow && r.rateHigh ? `${inr(Number(r.rateLow))} - ${inr(Number(r.rateHigh))}` : '—'}</td>
                    <td className="p-2.5">{kind?.[1]}</td>
                    <td className="p-2.5">{r.source}</td>
                    <td className="max-w-[200px] truncate p-2.5 text-[11px] text-slate-500" title={r.detail ?? ''}>{r.detail ?? '—'}</td>
                    <td className="p-2.5 text-center"><span className={`rounded px-1.5 text-[9px] font-bold ${kind?.[2] === 'High' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{kind?.[2]}</span></td>
                    {assignment && <td className="p-2.5 text-center">{canAdd && <button type="button" onClick={() => void use(r.id)} className="rounded bg-brand-navy px-2.5 py-1 text-[10px] font-bold text-white shadow-xs hover:bg-brand-navyDark">Use in Case ✓</button>}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
