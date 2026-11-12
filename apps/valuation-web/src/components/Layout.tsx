import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Bell, Calculator, ChevronRight, Database, FileCheck2, FolderKanban, HardHat, Hash, History, LayoutDashboard, LogOut, Menu, MessageSquareWarning, Receipt, Scale, Search, Settings, ShieldCheck, Stamp, Building2, Landmark, Files, Wallet,
} from 'lucide-react'
import LifecycleBar, { type Stage } from './shell/LifecycleBar.tsx'
import { SearchModal, StageModal, TrailModal } from './shell/Modals.tsx'
import { ToastProvider } from './shell/Toast.tsx'
import { useActiveCase } from './shell/useActiveCase.ts'
import AssignmentPopup from './AssignmentPopup.tsx'
import PullToRefresh from './PullToRefresh.tsx'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Life { stages: Stage[]; active: number; counts: { documents: number; openDifferences: number }; case: { id: string; code: string; status: string; bank: string; borrower: string | null; address: string } }
interface Reminder { type: string; assignmentId: string; ref: string; overdue: boolean; message: string }

const MODULES: Record<string, string> = {
  '/': 'Dashboard', '/assignments': 'Case Register', documents: 'Document Vault', inspection: 'Site Inspection', comparison: 'Comparison Engine', valuation: 'Draft Valuation',
  workbench: 'Drafter Workbench', compare: 'Compare', check: 'Valuer Check & Send', review: 'Valuer Sign-Off', submission: 'Dispatch & Billing', 'bank-report': 'Bank Report', '/rate-bank': 'Market Rate Bank',
}
const moduleName = (path: string) => {
  const step = /^\/assignments\/[^/]+\/([^/]+)/.exec(path)?.[1]
  if (step) return MODULES[step] ?? 'Case'
  if (/^\/assignments\/[^/]+$/.test(path)) return 'Case Overview'
  return MODULES[path] ?? MODULES['/' + path.split('/')[1]] ?? 'ValuerPro'
}

const nav = 'nav-item group flex w-full items-center space-x-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition hover:bg-white/10 hover:text-white'
const icon = 'h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-brand-gold'

function Item({ to, end, children, label, badge, disabled }: { to: string; end?: boolean; children: React.ReactNode; label: string; badge?: React.ReactNode; disabled?: boolean }) {
  if (disabled) return <span className={`${nav} cursor-not-allowed opacity-50`} title="Open a case first">{children}<span className="sidebar-label truncate">{label}</span></span>
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `${nav} ${isActive ? 'bg-white/20 font-bold text-white' : ''}`}>
      {children}
      <div className="sidebar-label flex flex-1 items-center justify-between"><span className="truncate">{label}</span>{badge}</div>
    </NavLink>
  )
}

const Section = ({ children, first }: { children: React.ReactNode; first?: boolean }) => (
  <div className={`sidebar-label px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400/80 ${first ? 'pb-2' : 'pt-3'}`}>{children}</div>
)

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const caseId = useActiveCase()
  const life = useFetch<Life>(caseId ? `/assignments/${caseId}/lifecycle?at=${encodeURIComponent(location.pathname)}` : null)
  const reminders = useFetch<Reminder[]>('/dashboard/reminders')
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900)
  const [bell, setBell] = useState(false)
  const [search, setSearch] = useState(false)
  const [stage, setStage] = useState<Stage | null>(null)
  const [trail, setTrail] = useState(false)
  const isAdmin = user?.role === 'FIRM_ADMIN'
  const role = user?.role
  const deskWork = role !== 'INSPECTOR' && role !== 'ACCOUNTS' && role !== 'DRAFTER'
  // The drafter and the valuer's own check-and-send flow sit beside the prototype's stages.
  const teamWork = role !== 'INSPECTOR' && role !== 'ACCOUNTS'
  const current = life.data && life.data.case.id === caseId ? life.data : null
  const active = current?.stages.find((s) => s.n === current.active)
  const to = (step: string) => (caseId ? `/assignments/${caseId}/${step}` : '/assignments')
  const initials = (user?.fullName ?? '').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const alerts = reminders.data ?? []

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => setBell(false), [location.pathname])

  return (
    <ToastProvider>
      <div className="flex h-screen flex-col bg-[#F0F4F8] font-sans text-brand-textPrimary">
        {/* TOP HEADER */}
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-brand-border bg-white px-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <button type="button" onClick={() => setCollapsed((c) => !c)} className="rounded-md p-2 text-brand-textSecondary transition hover:bg-slate-100 hover:text-brand-navy" title="Toggle navigation" aria-label="Toggle navigation"><Menu className="h-5 w-5" /></button>
            <Link to="/" className="flex items-center space-x-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-navy text-lg font-black text-white shadow-sm"><span>V</span></div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-lg font-extrabold tracking-tight text-brand-navy">ValuerPro<span className="align-top text-xs text-brand-red">™</span></span>
                  <span className="hidden rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-navy sm:inline">IBBI Registered</span>
                </div>
                <p className="hidden text-[10px] tracking-tight text-brand-textMuted sm:block">Unified Property Valuation &amp; Evidence Platform</p>
              </div>
            </Link>
          </div>

          <div className="mx-6 hidden max-w-xl flex-1 md:block">
            <button type="button" onClick={() => setSearch(true)} className="relative w-full cursor-pointer text-left">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <span className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-16 text-xs text-slate-400 shadow-inner transition hover:border-slate-300 hover:bg-white">Search case, owner, address, bank, khasra…</span>
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">Ctrl+K</kbd>
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-brand-gold ring-2 ring-brand-gold/30">{initials}</div>
              <div className="hidden text-left leading-tight md:block">
                <div className="flex items-center space-x-1"><span className="text-xs font-bold text-brand-navy">{user?.fullName}</span><span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" title="Signed in" /></div>
                <p className="text-[10px] font-medium capitalize text-slate-500">{user?.role.replace('_', ' ').toLowerCase()}</p>
              </div>
            </div>
            <div className="relative">
              <button type="button" onClick={() => setBell((b) => !b)} className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-brand-navy" aria-label="Alerts">
                <Bell className="h-5 w-5" />
                {alerts.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-red ring-2 ring-white" />}
              </button>
              {bell && (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white py-2 shadow-xl">
                  <div className="border-b border-slate-100 px-3 py-1.5"><span className="text-xs font-bold text-slate-800">Operational alerts ({alerts.length})</span></div>
                  <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-xs">
                    {alerts.length === 0 && <p className="p-3 text-slate-500">Nothing needs attention right now.</p>}
                    {alerts.slice(0, 12).map((a, i) => (
                      <Link key={i} to={`/assignments/${a.assignmentId}`} className="block p-2.5 transition hover:bg-slate-50">
                        <span className={`text-[10px] font-bold uppercase ${a.overdue ? 'text-brand-red' : 'text-brand-amber'}`}>{a.type.replace(/_/g, ' ').toLowerCase()}</span>
                        <p className="font-medium text-slate-700">{a.message}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {isAdmin && <Link to="/admin" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-brand-navy" title="Administration"><Settings className="h-5 w-5" /></Link>}
            <button type="button" onClick={logout} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-brand-navy" title="Sign out" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* LEFT SIDEBAR */}
          <aside className={`${collapsed ? 'w-16 [&_.sidebar-label]:hidden' : 'w-60'} z-30 flex select-none flex-col justify-between border-r border-slate-700/50 bg-brand-navy text-slate-300 shadow-md transition-all duration-300`} aria-label="Main navigation">
            <div className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
              <Section first>Core Workflows</Section>
              <Item to="/" end label="1. Dashboard"><LayoutDashboard className={icon} /></Item>
              <Item to="/assignments" end label="2. Case Register"><FolderKanban className={icon} /></Item>

              <Section>{current ? `Active Case (${current.case.code})` : 'Active Case'}</Section>
              <Item to={to('documents')} label="3. Document Vault" disabled={!caseId} badge={current && <span className="rounded bg-blue-500/20 px-1.5 font-mono text-[9px] text-blue-300">{current.counts.documents}</span>}><FileCheck2 className={icon} /></Item>
{teamWork && <>
              <Item to={to('workbench')} label="Drafter Workbench" disabled={!caseId}><Files className={icon} /></Item>
              <Item to={to('compare')} label="Compare (docs vs site)" disabled={!caseId}><Scale className={icon} /></Item>
              {role !== 'DRAFTER' && <Item to={to('check')} label="Valuer Check & Send" disabled={!caseId}><FileCheck2 className={icon} /></Item>}
</>}
{role !== 'ACCOUNTS' && <>
              <Item to={to('inspection')} label="4. Site Inspection" disabled={!caseId} badge={<span className="rounded bg-green-500/20 px-1.5 text-[9px] text-green-300">GPS</span>}><HardHat className={icon} /></Item>
</>}
{deskWork && <>
              <NavLink to={to('comparison')} className={({ isActive }) => `${nav} relative border border-amber-500/30 bg-white/5 ${isActive ? 'bg-white/20 font-bold text-white' : ''} ${caseId ? '' : 'pointer-events-none opacity-50'}`}>
                <Scale className="h-4 w-4 shrink-0 text-brand-gold transition group-hover:text-white" />
                <div className="sidebar-label flex flex-1 items-center justify-between"><span className="truncate font-semibold text-white">5. Comparison Engine</span>{current && current.counts.openDifferences > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{current.counts.openDifferences} Diff</span>}</div>
              </NavLink>
</>}
{deskWork && <>
              <Item to={to('valuation')} label="6. Draft Valuation" disabled={!caseId}><Calculator className={icon} /></Item>
              <Item to={to('review')} label="7. Valuer Sign-Off" disabled={!caseId} badge={<span className="rounded bg-amber-500/20 px-1.5 text-[9px] text-amber-300">IBBI</span>}><Stamp className={icon} /></Item>
</>}
{role !== 'INSPECTOR' && <>
              <Item to={to('submission')} label="8. Dispatch & Billing" disabled={!caseId}><Receipt className={icon} /></Item>
</>}
{deskWork && <>
              <Item to={to('bank-report')} label="Bank Report (Word / PDF)" disabled={!caseId}><Files className={icon} /></Item>
</>}

              <Section>Market Intelligence</Section>
              <Item to={caseId ? `/rate-bank?assignment=${caseId}` : '/rate-bank'} label="9. Market Rate Bank"><Database className={icon} /></Item>

              <Section>Records</Section>
              <Item to="/properties" label="Properties"><Building2 className={icon} /></Item>
              <Item to="/revisions" label="Bank Queries"><MessageSquareWarning className={icon} /></Item>
              <Item to="/evidence" label="Evidence Vault"><ShieldCheck className={icon} /></Item>
              {user?.role !== 'INSPECTOR' && <Item to="/accounts" label="Accounts"><Wallet className={icon} /></Item>}
              {isAdmin && <Item to="/reports" label="Report Templates"><Landmark className={icon} /></Item>}
              {isAdmin && <Item to="/admin" label="Administration"><Settings className={icon} /></Item>}
            </div>
            <div className="border-t border-white/10 p-3 text-[10px] text-slate-400">
              <div className="sidebar-label flex items-center justify-between"><span>Active Case:</span><span className="font-mono font-bold text-white">{current?.case.code ?? '—'}</span></div>
              <div className="sidebar-label mt-0.5 truncate text-[9px] text-slate-400/70">{current ? `${current.case.borrower ?? 'No borrower'} · ${current.case.bank}` : 'Pick a case from the Case Register'}</div>
            </div>
          </aside>

          {/* MAIN VIEW */}
          <main className="flex flex-1 flex-col overflow-y-auto bg-[#F0F4F8]">
            <div className="flex shrink-0 flex-col justify-between gap-2 border-b border-brand-border bg-white px-6 py-2.5 shadow-xs md:flex-row md:items-center">
              <div className="flex items-center space-x-2 text-xs">
                <Link to="/" className="font-bold text-brand-navy hover:underline">ValuerPro</Link>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-medium text-slate-700">{moduleName(location.pathname)}</span>
                {current && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    <Link to={`/assignments/${current.case.id}`} className="flex items-center space-x-1.5 rounded border border-slate-200 bg-slate-100 px-2 py-0.5">
                      <Hash className="h-3 w-3 text-slate-500" /><span className="font-mono font-bold text-brand-navy">{current.case.code}</span>
                      <span className="hidden text-[10px] text-slate-500 lg:inline">({current.case.borrower ?? 'No borrower'})</span>
                    </Link>
                  </>
                )}
              </div>
              {current && (
                <div className="flex items-center space-x-3 text-xs">
                  <span className="hidden text-[11px] text-slate-500 md:inline">Active Stage:</span>
                  <span className="flex items-center space-x-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />
                    <span>{active ? `Stage ${active.n}: ${active.label}` : 'All stages complete'}</span>
                  </span>
                  <button type="button" onClick={() => setTrail(true)} className="flex items-center space-x-1 rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200"><History className="h-3.5 w-3.5" /><span>Audit Trail</span></button>
                </div>
              )}
            </div>
            {current && <LifecycleBar stages={current.stages} blocked={current.counts.openDifferences > 0} onPick={setStage} />}
            <AssignmentPopup />
            <PullToRefresh><div className="pd-page p-6"><Outlet /></div></PullToRefresh>
          </main>
        </div>
      </div>
      {search && <SearchModal onClose={() => setSearch(false)} />}
      {stage && current && <StageModal stage={stage} caseCode={current.case.code} onClose={() => setStage(null)} />}
      {trail && current && <TrailModal caseId={current.case.id} caseCode={current.case.code} onClose={() => setTrail(false)} />}
    </ToastProvider>
  )
}
