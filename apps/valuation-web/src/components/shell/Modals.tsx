import { useEffect, useState, type ReactNode } from 'react'
import { History, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.ts'
import type { Stage } from './LifecycleBar.tsx'

function Backdrop({ onClose, children, top }: { onClose: () => void; children: ReactNode; top?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={onClose} />
      <div className={`flex min-h-screen justify-center px-4 pb-4 ${top ? 'items-start pt-16' : 'items-center'}`}>{children}</div>
    </div>
  )
}

export function StageModal({ stage, caseCode, onClose }: { stage: Stage; caseCode: string; onClose: () => void }) {
  return (
    <Backdrop onClose={onClose}>
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-brand-navy px-5 py-3.5 text-white">
          <div className="flex items-center space-x-2"><History className="h-5 w-5 text-brand-gold" /><h3 className="text-sm font-bold">Stage {stage.n}: {stage.label}</h3></div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 p-5 text-xs">
          <div className="flex items-center justify-between"><span className="font-mono font-bold text-brand-navy">{caseCode}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${stage.state === 'done' ? 'bg-emerald-100 text-emerald-800' : stage.state === 'active' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{stage.state === 'done' ? 'Completed' : stage.state === 'active' ? 'In progress' : 'Not reached'}</span></div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">{stage.detail}</p>
          {stage.at && <p className="text-slate-500">Recorded {new Date(stage.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
        </div>
        <div className="border-t border-slate-200 bg-slate-50 p-3 text-right"><button type="button" onClick={onClose} className="rounded bg-brand-navy px-4 py-1.5 text-xs font-bold text-white">Close</button></div>
      </div>
    </Backdrop>
  )
}

interface TrailItem { id: string; action: string; at: string; by: string | null }
const words = (action: string) => action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function TrailModal({ caseId, caseCode, onClose }: { caseId: string; caseCode: string; onClose: () => void }) {
  const [items, setItems] = useState<TrailItem[] | null>(null)
  useEffect(() => { api.get<{ items: TrailItem[] }>(`/assignments/${caseId}/timeline`).then((r) => setItems(r.items)).catch(() => setItems([])) }, [caseId])
  return (
    <Backdrop onClose={onClose}>
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-brand-navy px-5 py-3.5 text-white">
          <div className="flex items-center space-x-2"><History className="h-5 w-5 text-brand-gold" /><h3 className="text-sm font-bold">Audit trail · {caseCode}</h3></div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <ol className="flex-1 space-y-3 overflow-y-auto p-5 text-xs">
          {items === null && <li className="text-slate-500">Loading…</li>}
          {items?.length === 0 && <li className="text-slate-500">Nothing recorded yet.</li>}
          {items?.map((i) => (
            <li key={i.id} className="flex items-start space-x-3 border-l-2 border-slate-200 pl-3">
              <div><p className="font-semibold text-slate-800">{words(i.action)}</p><p className="text-[11px] text-slate-500">{i.by ?? 'System'} · {new Date(i.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </Backdrop>
  )
}

interface Hit { id: string; code: string; borrowerName: string | null; status: string; bank: { name: string }; property: { addressLine: string } }

// Ctrl+K: find a case by its number, the borrower, the address, the khasra number or the bank.
export function SearchModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return }
    const timer = setTimeout(() => { api.get<{ items: Hit[] }>('/assignments', { q: q.trim(), pageSize: 12 }).then((r) => setHits(r.items)).catch(() => setHits([])) }, 200)
    return () => clearTimeout(timer)
  }, [q])
  return (
    <Backdrop onClose={onClose} top>
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center space-x-3 border-b border-slate-200 bg-slate-50 p-4">
          <Search className="h-5 w-5 text-brand-navy" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases by number, owner, address, bank or khasra…" className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none" />
          <kbd className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-500">ESC</kbd>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-3 text-xs">
          {hits === null && <p className="p-3 text-slate-500">Type at least two letters.</p>}
          {hits?.length === 0 && <p className="p-3 text-slate-500">No case matches.</p>}
          {hits?.map((h) => (
            <button key={h.id} type="button" onClick={() => { navigate(`/assignments/${h.id}`); onClose() }} className="flex w-full items-center justify-between rounded-lg border border-transparent p-2.5 text-left hover:border-slate-200 hover:bg-slate-50">
              <span><b className="font-mono text-brand-navy">{h.code}</b> <span className="text-slate-700">{h.borrowerName ?? 'No borrower recorded'}</span><br /><span className="text-[11px] text-slate-500">{h.property.addressLine} · {h.bank.name}</span></span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{h.status.replace('_', ' ')}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">Search hints: a case number, the owner's name, a locality, a bank or a khasra number.</div>
      </div>
    </Backdrop>
  )
}
