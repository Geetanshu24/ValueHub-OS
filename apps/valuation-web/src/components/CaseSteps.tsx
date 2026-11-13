import { Link, useLocation, useMatch } from 'react-router-dom'

// The five steps of a case, in the order the work is done. Other case pages (valuation, workbench,
// quality review, submission) sit under "More" on the case page and do not appear here.
export const CASE_STEPS: { label: string; path: string; also?: string[] }[] = [
  { label: 'Documents', path: 'documents' },
  { label: 'Site inspection', path: 'inspection' },
  { label: 'Check & compare', path: 'compare', also: ['comparison'] },
  { label: 'Report', path: 'bank-report' },
  { label: 'Sign-off & send', path: 'check', also: ['review', 'submission'] },
]

export default function CaseSteps() {
  const match = useMatch('/assignments/:id/*')
  const { pathname } = useLocation()
  const id = match?.params.id
  if (!id || id === 'new') return null
  const page = pathname.split('/')[3] ?? ''
  const here = CASE_STEPS.findIndex((s) => s.path === page || s.also?.includes(page))

  return (
    <nav aria-label="Case steps" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
      <Link to={`/assignments/${id}`} className={`rounded-lg px-2.5 py-1.5 font-medium ${page === '' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Case</Link>
      {CASE_STEPS.map((step, i) => (
        <Link
          key={step.path}
          to={`/assignments/${id}/${step.path}`}
          aria-current={i === here ? 'step' : undefined}
          className={`rounded-lg border px-3 py-1.5 font-medium ${i === here ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          <span className="mr-1.5 opacity-70">{i + 1}</span>{step.label}
        </Link>
      ))}
    </nav>
  )
}
