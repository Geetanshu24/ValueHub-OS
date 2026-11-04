import { useState, type FormEvent } from 'react'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import AuthShell from '../components/AuthShell.tsx'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  function forgot() {
    if (!email) { setError('Enter your email first, then choose “Forgot password”.'); return }
    setError(null)
    void api.post('/auth/forgot-password', { email }).then(
      () => setNotice('If that address has an account, a reset link is on its way.'),
      (caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not send the reset link'),
    )
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your valuation firm.">
      <form onSubmit={onSubmit} className="auth-form">
        <label htmlFor="email">Email<input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label htmlFor="password">Password<input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p role="alert" className="ui-error">{error}</p>}
        {notice && <p role="status" className="pd-notice">{notice}</p>}
        <button type="submit" disabled={submitting} className="pd-btn is-primary is-block">{submitting ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="auth-link" onClick={forgot}>Forgot password?</button>
      </form>
    </AuthShell>
  )
}
