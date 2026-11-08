import type { ReactNode } from 'react'

// The sign-in frame: a brand panel with the seven workflow steps, beside the form.
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const steps = ['Assignment intake', 'Property & documents', 'Drafter workbench', 'Site inspection', 'Compare', 'Bank report', 'Check & send']
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-logo"><span>VH</span><b>ValueHub OS</b></div>
        <h2>One connected system for the bank valuation workflow.</h2>
        <ol>{steps.map((s, i) => <li key={s}><span>{i + 1}</span>{s}</li>)}</ol>
        <p>Every figure has a source. Nothing issued is overwritten. Every change is on the record.</p>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-logo is-dark"><span>VH</span><b>ValueHub OS</b></div>
          <h1>{title}</h1>
          <p className="auth-sub">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  )
}
