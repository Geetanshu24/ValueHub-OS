import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import AssignmentPopup from './AssignmentPopup.tsx'
import PullToRefresh from './PullToRefresh.tsx'
import { useAuth } from '../lib/auth.tsx'

const GROUPS: { label: string; items: { to: string; label: string; icon: string; end?: boolean; admin?: boolean }[] }[] = [
  { label: 'Work', items: [
    { to: '/assignments', label: 'Assignment Inbox', icon: '☰', end: true },
    { to: '/assignments/new', label: 'New assignment', icon: '＋' },
  ] },
  { label: 'Business', items: [
    { to: '/accounts', label: 'Accounts', icon: '₹' },
    { to: '/admin', label: 'Administration', icon: '⚙', admin: true },
  ] },
]

export default function Layout() {
  const { user, logout } = useAuth()
  // On a phone the menu folds away behind a button instead of taking a third of the screen.
  const [menuOpen, setMenuOpen] = useState(false)
  const isAdmin = user?.role === 'FIRM_ADMIN'
  const isDrafter = user?.role === 'DRAFTER'
  // Drafters and inspectors work only on the cases given to them: no creating cases, no firm-wide pages.
  const isFieldStaff = isDrafter || user?.role === 'INSPECTOR'
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
          {GROUPS.slice(0, 1).map((group) => <div key={group.label} className="sn-group"><p>{group.label}</p>{group.items.filter((item) => !isFieldStaff || item.to === '/assignments').map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={close} className={({ isActive }) => `sn-item ${isActive ? 'is-on' : ''}`}><i>{item.icon}</i>{item.label}</NavLink>)}</div>)}


          {(isFieldStaff ? [] : GROUPS.slice(1)).map((group) => {
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
      <AssignmentPopup />
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <PullToRefresh>
          <div className="pd-page"><Outlet /></div>
        </PullToRefresh>
      </main>
    </div>
  )
}
