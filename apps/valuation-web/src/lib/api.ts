import type { Paginated } from '@value-hub/valuation-shared'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3100/api/v1'
const TOKEN_KEY = 'valuehub-os-token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  status: number
  // Each problem separately, when the server reported a list (e.g. a form that needs several fixes).
  problems: string[]
  constructor(status: number, message: string, problems: string[] = []) {
    super(message)
    this.status = status
    this.problems = problems
  }
}

type Query = Record<string, string | number | undefined>

async function request<T>(path: string, init: RequestInit = {}, query?: Query): Promise<T> {
  const url = new URL(BASE_URL + path)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const token = tokenStore.get()
  const response = await fetch(url, {
    ...init,
    headers: {
      // FormData sets its own multipart boundary header.
      ...(!(init.body instanceof FormData) && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (response.status === 401 && token && !path.startsWith('/auth/')) {
    // The session ended (expired, or the account was deactivated): start again from sign-in.
    tokenStore.clear()
    window.location.assign('/')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message
    throw new ApiError(response.status, message ?? `Request failed (${response.status})`, Array.isArray(body?.message) ? body.message : [])
  }
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, {}, query),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}

// Files sit behind the bearer token, so they are fetched as a blob and opened
// from an object URL instead of a plain link.
export async function openFile(path: string): Promise<void> {
  const token = tokenStore.get()
  const response = await fetch(BASE_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!response.ok) throw new ApiError(response.status, `Download failed (${response.status})`)
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// A file behind the bearer token as an object URL, for showing it inside the page.
// The caller revokes the URL when finished.
export async function fileBlobUrl(path: string): Promise<{ url: string; type: string }> {
  const token = tokenStore.get()
  const response = await fetch(BASE_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!response.ok) throw new ApiError(response.status, `Could not load the file (${response.status})`)
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), type: blob.type }
}

export type { Paginated }

// Builds a file from a POST (e.g. an evidence archive) and offers it for saving.
export async function downloadFromPost(path: string, body: unknown, fallbackName: string): Promise<void> {
  const token = tokenStore.get()
  const response = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string | string[] } | null
    const message = Array.isArray(failure?.message) ? failure.message.join(', ') : failure?.message
    throw new ApiError(response.status, message ?? `Export failed (${response.status})`)
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Saves a file behind the bearer token (a GET), under the name the server suggests.
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = tokenStore.get()
  const response = await fetch(BASE_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string | string[] } | null
    const message = Array.isArray(failure?.message) ? failure.message.join(', ') : failure?.message
    throw new ApiError(response.status, message ?? `Download failed (${response.status})`)
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
