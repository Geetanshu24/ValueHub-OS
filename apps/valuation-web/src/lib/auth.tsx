import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ValuationRole } from '@value-hub/valuation-shared'
import { api, ApiError, tokenStore } from './api.ts'

export interface CurrentUser {
  id: string
  firmId: string
  email: string
  fullName: string
  role: ValuationRole
}

interface AuthState {
  user: CurrentUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(() => tokenStore.get() !== null)

  useEffect(() => {
    if (!tokenStore.get()) return
    api
      .get<CurrentUser>('/auth/me')
      .then(setUser)
      .catch((error: unknown) => {
        // Only an auth failure invalidates the token; a network blip must not log the user out.
        if (error instanceof ApiError && error.status === 401) tokenStore.clear()
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ accessToken: string; user: CurrentUser }>('/auth/login', { email, password })
    tokenStore.set(result.accessToken)
    setUser(result.user)
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
