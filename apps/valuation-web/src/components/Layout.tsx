import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'
import { ASSIGNMENT_STATUS_LABELS, type AssignmentStatus } from '@value-hub/valuation-shared'
import PullToRefresh from './PullToRefresh.tsx'
import { FLOW, STEP_OF_STATUS, stepPath } from './WorkflowParts.tsx'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Current { id: string; code: string; status: AssignmentStatus; property: { addressLine: string } }

const GROUPS: { label: string; items: { to: string; label: string; icon: string; end?: boolean; admin?: boolean }[] }[] = [
  { label: 'Work', items: [
    { to: '/', label: 'Command Centre', icon: '◫', end: true },
    { to: '/assignments', label: 'Assignment Inbox', icon: '☰', end: true },
    { to: '/assignments/new', label: 'New assignment', icon: '＋' },
  ] },
  { label: 'Records', items: [
    { to: '/properties', label: 'Properties', icon: '⌂' },
    { to: '/documents', label: 'Document Desk', icon: '▤' },
    { to: '/inspections', label: 'Visit calendar', icon: '◷' },
    { to: '/revisions', label: 'Bank queries', icon: '✉' },
    { to: '/evidence', label: 'Evidence Vault', icon: '⛁' },
  ] },
  { label: 'Business', items: [
    { to: '/accounts', label: 'Accounts', icon: '₹' },
    { to: '/reports', label: 'Report templates', icon: '❏', admin: true },
    { to: '/admin', label: 'Administration', icon: '⚙', admin: true },
  ] },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  // On a phone the menu folds away behind a button instead of taking a third of the screen.
  const [menuOpen, setMenuOpen] = useState(false)
  // Inside an assignment, the workflow steps become live links to that assignment's pages.
  const match = useMatch('/assignments/:id/*')
  const currentId = match?.params.id && match.params.id !== 'new' ? match.params.id : null
  const current = useFetch<Current>(currentId ? `/assignments/${currentId}` : null).data
  const stepNow = current ? STEP_OF_STATUS[current.status] : -1
  const isAdmin = user?.role === 'FIRM_ADMIN'
  const close = () => setMenuOpen(false)

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="sn-logo is-small">VH</span>
          ValueHub OS
        </span>
        <button type="button" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="pd-btn is-ghost">
          {menuOpen ? '×' : '☰'}
        </button>
      </header>
      <aside className={`sn ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <Link to="/" className="sn-brand" onClick={close}><span className="sn-logo">VH</span><span><b>ValueHub OS</b><small>Valuation Operating System</small></span></Link>
        <nav className="sn-scroll">
          {GROUPS.slice(0, 1).map((group) => <div key={group.label} className="sn-group"><p>{group.label}</p>{group.items.map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={close} className={({ isActive }) => `sn-item ${isActive && !(item.to === '/assignments' && location.pathname.startsWith('/assignments/') && currentId) ? 'is-on' : ''}`}><i>{item.icon}</i>{item.label}</NavLink>)}</div>)}

          <div className="sn-group sn-flow">
            <p>Workflow</p>
            {current ? <Link to={`/assignments/${current.id}`} className="sn-current" onClick={close}><b>{current.code}</b><small title={current.property.addressLine}>{current.property.addressLine}</small><em>{ASSIGNMENT_STATUS_LABELS[current.status]}</em></Link> : <span className="sn-hint">Open an assignment to work through its steps.</span>}
            <ol>
              {FLOW.map((label, index) => {
                const state = !current ? 'idle' : index < stepNow ? 'done' : index === stepNow ? 'now' : 'next'
                const to = current ? stepPath(index, current.id) : null
                const here = !!to && (location.pathname === to.split('?')[0])
                const body = <><span>{state === 'done' ? '✓' : index + 1}</span><b>{label}</b></>
                return <li key={label}>{to ? <Link to={to} onClick={close} className={`sn-step is-${state} ${here ? 'is-here' : ''}`} aria-current={here ? 'page' : undefined}>{body}</Link> : <span className="sn-step is-idle">{body}</span>}</li>
              })}
            </ol>
            {!current && <Link to="/assignments" className="sn-pick" onClick={close}>Choose an assignment →</Link>}
          </div>

          {GROUPS.slice(1).map((group) => {
            const items = group.items.filter((item) => !item.admin || isAdmin)
            return items.length > 0 && <div key={group.label} className="sn-group"><p>{group.label}</p>{items.map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={close} className={({ isActive }) => `sn-item ${isActive ? 'is-on' : ''}`}><i>{item.icon}</i>{item.label}</NavLink>)}</div>
          })}
        </nav>
        <div className="sn-user">
          <span className="sn-avatar">{user?.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
          <div><b>{user?.fullName}</b><small>{user?.role.replace('_', ' ').toLowerCase()}</small></div>
          <button type="button" onClick={logout} className="sn-out">Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <PullToRefresh>
          <div className="pd-page"><Outlet /></div>
        </PullToRefresh>
      </main>
    </div>
  )
}
