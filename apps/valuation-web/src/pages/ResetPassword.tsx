import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell.tsx'
import { api } from '../lib/api.ts'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await api.post('/auth/reset-password', { token, newPassword: password })
      setDone(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset the password')
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 12 characters. You will sign in with it straight away.">
      {done ? <p className="pd-notice">Your password has been changed. <Link className="auth-link" to="/">Sign in</Link></p> : (
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="password">New password<input id="password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p role="alert" className="ui-error">{error}</p>}
          <button type="submit" className="pd-btn is-primary is-block">Change password</button>
        </form>
      )}
    </AuthShell>
  )
}
