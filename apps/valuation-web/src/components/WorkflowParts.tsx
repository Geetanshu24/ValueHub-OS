import { Link } from 'react-router-dom'
import {
  ASSIGNMENT_PRIORITY_LABELS, ASSIGNMENT_STATUS_LABELS, INTAKE_SOURCE_LABELS,
  type AssignmentPriority, type AssignmentStatus, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import type { ReactNode } from 'react'
import { formatDate } from './ui.tsx'

export interface AssignmentHead {
  id: string; code: string; purpose: string; fee?: string | null; dueDate: string; status: AssignmentStatus; priority: AssignmentPriority; borrowerName: string | null; intakeSource: IntakeSource
  bank: { name: string }; assignedValuer: { fullName: string }; property: { id: string; code: string; addressLine: string; propertyClass: PropertyClass }
}
export interface ReadinessItem { key: string; label: string; state: 'done' | 'todo' | 'warn'; detail: string; blocking: boolean }
export interface Readiness { items: ReadinessItem[]; done: number; total: number; canProceed: boolean; complete: boolean }

export const FLOW = ['Assignment intake', 'Property & documents', 'Site inspection', 'Valuation workings', 'Quality review', 'Approval & submission']
// Which workflow step an assignment's status puts the work on (0-based).
export const STEP_OF_STATUS: Record<AssignmentStatus, number> = { INTAKE: 1, DOCUMENTS: 1, INSPECTION: 2, VALUATION: 3, QUALITY_REVIEW: 4, APPROVED: 5, SUBMITTED: 5, REVISION: 3, CLOSED: 6, CANCELLED: 0 }
const MODULE_OF_STEP = ['/assignments', '/documents', '/inspections', '/valuation', '/reports', '/reports']

// Where each workflow step lives. Steps 2 and 3 have their own pages per assignment.
export function stepPath(index: number, id: string): string {
  if (index === 0) return `/assignments/${id}`
  if (index === 1) return `/assignments/${id}/documents`
  if (index === 2) return `/assignments/${id}/inspection`
  if (index === 3) return `/assignments/${id}/valuation`
  if (index === 4) return `/assignments/${id}/review`
  if (index === 5) return `/assignments/${id}/submission`
  return `${MODULE_OF_STEP[Math.min(index, 5)]}?assignment=${id}`
}

// What to do next on an assignment in each stage, and which workflow step it belongs to (0-based).
export const NEXT_ACTION: Record<AssignmentStatus, { label: string; step: number } | null> = {
  INTAKE: { label: 'Add property & documents', step: 1 },
  DOCUMENTS: { label: 'Verify the documents', step: 1 },
  INSPECTION: { label: 'Do the site inspection', step: 2 },
  VALUATION: { label: 'Work out the valuation', step: 3 },
  REVISION: { label: 'Revise the valuation', step: 3 },
  QUALITY_REVIEW: { label: 'Review & approve', step: 4 },
  APPROVED: { label: 'Issue & submit to the bank', step: 5 },
  SUBMITTED: { label: 'Track the bank’s response', step: 5 },
  CLOSED: null,
  CANCELLED: null,
}

export function nextActionFor(status: AssignmentStatus, id: string): { label: string; to: string } | null {
  const next = NEXT_ACTION[status]
  return next ? { label: next.label, to: stepPath(next.step, id) } : null
}

// "3 days overdue", "due today", "in 2 days".
export function dueLabel(due: string | Date, now = new Date()): { text: string; tone: 'late' | 'soon' | 'ok' } {
  const days = Math.round((new Date(new Date(due).toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86400000)
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, tone: 'late' }
  if (days === 0) return { text: 'due today', tone: 'soon' }
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, tone: days <= 2 ? 'soon' : 'ok' }
}

export function StepHeader({ a, here, eyebrow, title, subtitle }: { a: AssignmentHead; here: number; eyebrow: string; title: string; subtitle: string }) {
  const stepNow = STEP_OF_STATUS[a.status]
  return <>
    <div className="pd-topline"><Link to={`/assignments/${a.id}`} className="pd-back">← <span>{a.code}</span></Link><span className="pd-secure"><i /> Secure workspace</span></div>
    <header className="pd-heading"><div><p className="pd-eyebrow">VALUATION WORKFLOW <span>/</span> {eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div></header>
    <nav className="pd-flow" aria-label="Valuation workflow">{FLOW.map((label, index) => {
      const state = index < stepNow ? 'done' : index === stepNow ? 'now' : 'next'
      return <Link key={label} to={index === here ? '#' : stepPath(index, a.id)} className={`pd-flow-step is-${state} ${index === here ? 'is-here' : ''}`} aria-current={index === here ? 'step' : undefined}><span>{state === 'done' ? '✓' : index + 1}</span><b>{label}</b></Link>
    })}</nav>
    <section className="pd-summary">
      <div><small>Assignment</small><b>{a.code}</b></div><div><small>Bank</small><b>{a.bank.name}</b></div><div><small>Borrower</small><b>{a.borrowerName ?? '—'}</b></div><div><small>Purpose</small><b>{a.purpose}</b></div>
      <div><small>Due</small><b>{formatDate(a.dueDate)}</b></div><div><small>Valuer</small><b>{a.assignedValuer.fullName}</b></div>
      <div><small>Priority</small><b className={`pd-prio is-${a.priority.toLowerCase()}`}>{ASSIGNMENT_PRIORITY_LABELS[a.priority]}</b></div><div><small>Stage</small><b className="pd-stage">{ASSIGNMENT_STATUS_LABELS[a.status]}</b></div>
      <div><small>Came in via</small><b>{INTAKE_SOURCE_LABELS[a.intakeSource]}</b></div>
    </section>
  </>
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 34; const c = 2 * Math.PI * r; const share = total ? done / total : 0
  return <svg viewBox="0 0 80 80" className="pd-ring" role="img" aria-label={`${done} of ${total} checks done`}><circle cx="40" cy="40" r={r} className="pd-ring-track" /><circle cx="40" cy="40" r={r} className="pd-ring-fill" strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 40 40)" /><text x="40" y="38" textAnchor="middle" className="pd-ring-num">{done}/{total}</text><text x="40" y="52" textAnchor="middle" className="pd-ring-cap">ready</text></svg>
}

export function ReadyCard({ title, readiness, summary, children }: { title: string; readiness: Readiness | null; summary: string; children?: ReactNode }) {
  return <div className="pd-ready">
    <div className="pd-ready-head">{readiness ? <Ring done={readiness.done} total={readiness.total} /> : <span className="pd-ring-empty" />}<div><h3>{title}</h3><p>{readiness ? summary : 'Checking…'}</p></div></div>
    <ul className="pd-checks">{readiness?.items.map((item) => <li key={item.key} className={`is-${item.state}`}><span className="pd-check-dot">{item.state === 'done' ? '✓' : item.state === 'todo' ? '○' : '!'}</span><div><b>{item.label}</b><small>{item.detail}</small></div></li>)}</ul>
    {children}
  </div>
}
