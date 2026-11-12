import { Check, ChevronRight } from 'lucide-react'

export interface Stage { n: number; short: string; label: string; state: 'done' | 'active' | 'pending'; detail: string; at: string | null }

// The fifteen stages of a case in one strip. Done stages are green, the stage it is at is amber, the rest are dim.
export default function LifecycleBar({ stages, blocked, onPick }: { stages: Stage[]; blocked: boolean; onPick: (stage: Stage) => void }) {
  return (
    <div className="shrink-0 select-none overflow-x-auto border-b border-slate-800 bg-slate-900 px-4 py-2 text-white">
      <div className="flex min-w-[1100px] items-center space-x-1 text-[10px]">
        {stages.map((s, i) => (
          <div key={s.n} className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => onPick(s)}
              title={s.detail}
              className={
                s.state === 'done'
                  ? 'flex cursor-pointer items-center space-x-1 rounded border border-emerald-700/50 bg-emerald-900/60 px-2 py-1 text-emerald-300 transition hover:bg-emerald-800/80'
                  : s.state === 'active'
                    ? 'flex cursor-pointer items-center space-x-1 rounded bg-amber-500 px-2.5 py-1 font-bold text-slate-950 shadow-sm ring-2 ring-amber-300'
                    : 'flex cursor-pointer items-center space-x-1 rounded bg-slate-800 px-2 py-1 text-slate-400 transition hover:text-slate-200'
              }
            >
              {s.state === 'done' && <Check className="h-3 w-3" />}
              {s.state === 'active' && blocked && <span className="h-2 w-2 animate-ping rounded-full bg-red-600" />}
              <span>{s.n}. {s.short}</span>
            </button>
            {i < stages.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-slate-600" />}
          </div>
        ))}
      </div>
    </div>
  )
}
