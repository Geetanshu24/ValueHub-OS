import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ListTodo, PieChart, Plus, Users } from 'lucide-react'
import { ASSIGNMENT_STATUS_LABELS, type AssignmentStatus } from '@value-hub/valuation-shared'
import { nextActionFor } from '../components/WorkflowParts.tsx'
import { formatInr } from '../components/ui.tsx'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Summary {
  assignments?: { open: number; dueToday: number; overdue: number }
  inspections: { upcomingWeek: number; inProgress: number; awaitingFieldReview: number }
  reports?: { awaitingQc: number }
  receivables?: { outstanding: number }
}
interface QueueItem {
  id: string; code: string; status: AssignmentStatus; dueDate: string; borrowerName: string | null
  bank: { name: string }; property: { addressLine: string }; assignedValuer: { fullName: string }; visitAt: string | null; visitStatus: string | null
}
interface Workload { id: string; fullName: string; role: string; openAssignments: number; overdueAssignments: number; pendingInspections: number }
interface Overview {
  pipeline: { buckets: { key: string; label: string; count: number }[]; total: number; yearTotal: number }
  monthly: { months: string[]; registered: number[]; issued: number[]; invoiced: number[] }
}

const COLOURS: Record<string, string> = { new: '#3B82F6', docs: '#60A5FA', site: '#D97706', compare: '#EF4444', draft: '#8B5CF6', review: '#A855F7', approved: '#10B981', closed: '#1A365D' }
const DAY = 86400000
const dayOf = (iso: string) => new Date(new Date(iso).toDateString()).getTime()
const today = () => new Date(new Date().toDateString()).getTime()
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function Pill({ dot, label, children, tone }: { dot: string; label: string; children: React.ReactNode; tone: string }) {
  return (
    <div className="flex items-center space-x-2">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="font-medium text-slate-500">{label}:</span>
      <span className={`rounded border px-2 py-0.5 font-mono font-extrabold ${tone}`}>{children}</span>
    </div>
  )
}

function Card({ icon, title, right, children, className = '' }: { icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-brand-border bg-white p-4 shadow-xs ${className}`}>
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div className="flex items-center space-x-2 text-brand-navy">{icon}<h3 className="text-xs font-bold tracking-tight text-slate-800">{title}</h3></div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Donut({ buckets, total }: { buckets: Overview['pipeline']['buckets']; total: number }) {
  const R = 70, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="relative flex h-56 items-center justify-center">
      <svg viewBox="0 0 200 200" className="h-full" role="img" aria-label="Cases by stage">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#F1F5F9" strokeWidth="26" />
        {total > 0 && buckets.filter((b) => b.count > 0).map((b) => {
          const len = (b.count / total) * C
          const el = <circle key={b.key} cx="100" cy="100" r={R} fill="none" stroke={COLOURS[b.key]} strokeWidth="26" strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)"><title>{`${b.label}: ${b.count} cases`}</title></circle>
          offset += len
          return el
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-brand-navy">{total}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Cases</span>
      </div>
    </div>
  )
}

function Bars({ monthly }: { monthly: Overview['monthly'] }) {
  const series = [['Cases Registered', monthly.registered, '#1A365D'], ['Cases Issued', monthly.issued, '#38A169'], ['Invoiced', monthly.invoiced, '#D97706']] as const
  const max = Math.max(5, ...monthly.registered, ...monthly.issued, ...monthly.invoiced)
  const W = 520, H = 190, base = 160, step = (W - 20) / monthly.months.length
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label="Cases registered, issued and invoiced by month">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1="20" x2={W} y1={base - f * 130} y2={base - f * 130} stroke="#F1F5F9" /><text x="0" y={base - f * 130 + 3} fontSize="9" fill="#94A3B8">{Math.round(max * f)}</text></g>)}
        {monthly.months.map((m, i) => (
          <g key={m} transform={`translate(${24 + i * step}, 0)`}>
            {series.map(([name, data, colour], s) => { const h = (data[i] / max) * 130; return <rect key={name} x={s * (step / 4)} y={base - h} width={step / 4 - 2} height={Math.max(h, 0)} rx="3" fill={colour}><title>{`${name}: ${data[i]}`}</title></rect> })}
            <text x={step * 0.35} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748B">{monthLabel(m)}</text>
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">{series.map(([name, , colour]) => <span key={name} className="flex items-center space-x-1"><span className="h-2 w-2 rounded-sm" style={{ background: colour }} /><span>{name}</span></span>)}</div>
    </>
  )
}

export default function CommandCentre() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const staff = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'REVIEWER'
  const summary = useFetch<Summary>('/dashboard/summary').data
  const queue = useFetch<QueueItem[]>('/dashboard/work-queue').data ?? []
  const overview = useFetch<Overview>(staff ? '/dashboard/overview' : null).data
  const team = useFetch<Workload[]>(staff ? '/dashboard/workload' : null).data ?? []
  const t0 = today()
  const overdue = queue.filter((q) => dayOf(q.dueDate) < t0 && q.status !== 'SUBMITTED')
  const upcoming = queue.filter((q) => dayOf(q.dueDate) >= t0 && dayOf(q.dueDate) <= t0 + 7 * DAY).sort((a, b) => dayOf(a.dueDate) - dayOf(b.dueDate))
  const buckets = overview?.pipeline.buckets ?? []
  const count = (...keys: string[]) => buckets.filter((b) => keys.includes(b.key)).reduce((t, b) => t + b.count, 0)
  const open = (q: QueueItem) => { const next = nextActionFor(q.status, q.id); navigate(next ? next.to : `/assignments/${q.id}`) }

  return (
    <div className="space-y-5">
      {/* STATUS BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-border bg-white p-3 text-xs shadow-xs">
        <Pill dot="bg-blue-600" label="Active Cases" tone="border-blue-100 bg-blue-50 text-slate-900">{summary?.assignments?.open ?? '—'}</Pill>
        <div className="hidden h-4 w-px bg-slate-200 sm:block" />
        <Pill dot="bg-amber-500" label="Site Visits Due" tone="border-amber-100 bg-amber-50 text-slate-900">{summary?.inspections.upcomingWeek ?? '—'}</Pill>
        <div className="hidden h-4 w-px bg-slate-200 sm:block" />
        <Pill dot="bg-red-600" label="Reports Overdue" tone="border-red-200 bg-red-50 text-red-700">{summary?.assignments?.overdue ?? '—'}</Pill>
        <div className="hidden h-4 w-px bg-slate-200 sm:block" />
        <Pill dot="bg-purple-600" label="Drafts Awaiting Review" tone="border-purple-100 bg-purple-50 text-slate-900">{summary?.reports?.awaitingQc ?? '—'}</Pill>
        <div className="hidden h-4 w-px bg-slate-200 sm:block" />
        <Pill dot="bg-emerald-600" label="Fees Outstanding" tone="border-emerald-200 bg-emerald-50 text-emerald-800">{summary?.receivables ? `₹${formatInr(summary.receivables.outstanding)}` : '—'}</Pill>
        <div className="ml-auto"><Link to="/assignments/new" className="flex items-center space-x-1.5 rounded-lg bg-brand-navy px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-navyDark"><Plus className="h-3.5 w-3.5" /><span>New Case</span></Link></div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-10">
        {/* LEFT */}
        <div className="space-y-4 lg:col-span-3">
          <Card icon={<ListTodo className="h-4 w-4" />} title="Today's Work Queue" right={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{Math.min(queue.length, 6)} of {queue.length}</span>}>
            <div className="space-y-2 text-xs">
              {queue.length === 0 && <p className="text-slate-500">Nothing waiting on you.</p>}
              {queue.slice(0, 6).map((q) => {
                const late = dayOf(q.dueDate) < t0, now = dayOf(q.dueDate) === t0
                const tone = late ? ['border-red-100 bg-red-50/60 hover:bg-red-50', 'bg-red-600', 'text-red-600 font-bold'] : now ? ['border-amber-100 bg-amber-50/60 hover:bg-amber-50', 'bg-amber-500', 'text-amber-700'] : ['border-emerald-100 bg-emerald-50/60 hover:bg-emerald-50', 'bg-emerald-600', 'text-emerald-700']
                return (
                  <button key={q.id} type="button" onClick={() => open(q)} className={`group flex w-full items-center justify-between rounded-lg border p-2.5 text-left transition ${tone[0]}`}>
                    <div className="flex min-w-0 items-center space-x-2"><span className={`h-2 w-2 shrink-0 rounded-full ${tone[1]}`} /><div className="truncate"><div className="font-mono text-[11px] font-bold text-slate-900 group-hover:text-brand-navy">{q.code}</div><div className="truncate text-[10px] text-slate-500">{nextActionFor(q.status, q.id)?.label ?? ASSIGNMENT_STATUS_LABELS[q.status]} · {q.property.addressLine}</div></div></div>
                    <div className="shrink-0 text-right"><div className="text-[10px] font-semibold text-slate-700">{q.assignedValuer.fullName.split(' ')[0]}</div><div className={`font-mono text-[9px] ${tone[2]}`}>{q.visitAt ? new Date(q.visitAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : shortDate(q.dueDate)}</div></div>
                  </button>
                )
              })}
            </div>
          </Card>

          <div className="rounded-xl border border-red-200 bg-red-50/40 p-3.5 shadow-xs">
            <div className="mb-2 flex items-center justify-between"><div className="flex items-center space-x-1.5 text-xs font-bold text-red-800"><AlertTriangle className="h-4 w-4 text-brand-red" /><span>Overdue Cases (Escalation)</span></div><span className="rounded bg-red-100 px-1.5 font-mono text-[10px] font-bold text-red-700">{overdue.length} Urgent</span></div>
            <div className="space-y-1.5 text-xs">
              {overdue.length === 0 && <p className="text-slate-500">Nothing is overdue.</p>}
              {overdue.slice(0, 3).map((q) => (
                <Link key={q.id} to={`/assignments/${q.id}`} className="flex items-center justify-between rounded border border-red-200 bg-white p-2"><div><span className="font-mono font-bold text-brand-navy">{q.code}</span><p className="text-[10px] text-slate-500">{q.property.addressLine} · {ASSIGNMENT_STATUS_LABELS[q.status]}</p></div><span className="rounded bg-red-100 px-2 py-0.5 font-mono text-[10px] font-bold text-red-700">+{Math.round((t0 - dayOf(q.dueDate)) / DAY)} Days</span></Link>
              ))}
            </div>
          </div>
        </div>

        {/* CENTRE */}
        <div className="space-y-4 lg:col-span-4">
          <Card icon={<PieChart className="h-4 w-4" />} title="Case Pipeline Distribution" right={<span className="text-[10px] font-medium text-slate-500">{overview ? `${overview.pipeline.yearTotal} received this year` : ''}</span>}>
            {overview ? <Donut buckets={buckets} total={overview.pipeline.total} /> : <p className="py-16 text-center text-xs text-slate-500">{staff ? 'Loading…' : 'Shown to staff.'}</p>}
            <div className="mt-2 grid grid-cols-4 gap-1 border-t border-slate-100 pt-2 text-center text-[10px]">
              {buckets.map((b) => <div key={b.key} className="rounded bg-slate-50 p-1"><span className="block text-slate-500">{b.label}</span><span className="font-mono font-bold" style={{ color: b.key === 'compare' ? '#B45309' : b.key === 'review' ? '#7E22CE' : b.key === 'approved' ? '#047857' : '#1e293b' }}>{b.count}</span></div>)}
            </div>
          </Card>
          <div className="rounded-xl border border-brand-border bg-white p-3.5 shadow-xs">
            <span className="mb-2 block text-xs font-bold text-slate-700">Stage-by-Stage Throughput</span>
            <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
              {[['1. Intake', count('new', 'docs'), 'New / Documents', 'blue'], ['2. Field & Evidence', count('site', 'compare'), 'Visit / Comparison', 'amber'], ['3. Valuation', count('draft', 'review'), 'Draft / Review', 'purple'], ['4. Final Sign & Bill', count('approved', 'closed'), 'Approved / Closed', 'emerald']].map(([title, n, sub, c]) => (
                <div key={String(title)} className={`rounded-lg border p-2 ${c === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-900' : c === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : c === 'purple' ? 'border-purple-200 bg-purple-50 text-purple-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><div className="font-bold">{title}</div><div className="mt-0.5 font-mono text-base font-extrabold">{n}</div><div className="text-[9px] opacity-80">{sub}</div></div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-4 lg:col-span-3">
          <Card icon={<CalendarClock className="h-4 w-4" />} title="Deadlines — Next 7 Days" right={<span className="text-[10px] text-slate-400">Chronological</span>}>
            <div className="space-y-2 text-xs">
              {upcoming.length === 0 && <p className="text-slate-500">No deadline in the next week.</p>}
              {upcoming.slice(0, 5).map((q) => {
                const isToday = dayOf(q.dueDate) === t0
                return (
                  <Link key={q.id} to={`/assignments/${q.id}`} className="flex items-start space-x-2.5 rounded border border-transparent p-2 transition hover:border-slate-200 hover:bg-slate-50">
                    <div className={`w-12 shrink-0 rounded px-2 py-1 text-center ${isToday ? 'bg-brand-navy text-white' : 'border border-slate-200 bg-slate-100 text-slate-700'}`}><span className="block text-[8px] font-semibold uppercase tracking-wider">{isToday ? 'Today' : new Date(q.dueDate).toLocaleDateString('en-IN', { weekday: 'short' })}</span><span className="block font-mono text-xs font-bold">{shortDate(q.dueDate)}</span></div>
                    <div className="min-w-0 flex-1"><div className="font-mono text-[11px] font-bold text-slate-900">{q.code}</div><div className="truncate text-[10px] text-slate-600">{nextActionFor(q.status, q.id)?.label ?? ASSIGNMENT_STATUS_LABELS[q.status]}</div><div className="text-[9px] font-medium text-brand-navy">Resp: {q.assignedValuer.fullName}</div></div>
                  </Link>
                )
              })}
            </div>
          </Card>

          {staff && (
            <Card icon={<Users className="h-4 w-4" />} title="Team Pulse" right={<span className="text-[10px] text-slate-400">Open work</span>}>
              <div className="space-y-2 text-xs">
                {team.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2">
                    <div className="flex items-center space-x-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-navy text-[10px] font-bold text-brand-gold">{p.fullName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span><div><div className="font-semibold text-slate-800">{p.fullName}</div><div className="text-[10px] capitalize text-slate-500">{p.role.replace('_', ' ').toLowerCase()}</div></div></div>
                    <div className="text-right font-mono text-[10px]"><div className="font-bold text-slate-800">{p.openAssignments + p.pendingInspections} open</div>{p.overdueAssignments > 0 && <div className="font-bold text-red-600">{p.overdueAssignments} late</div>}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {overview && (
        <div className="rounded-xl border border-brand-border bg-white p-4 shadow-xs">
          <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2.5"><h3 className="text-xs font-bold text-slate-800">Monthly Operational Performance (6 Months Trend)</h3></div>
          <Bars monthly={overview.monthly} />
        </div>
      )}
    </div>
  )
}
