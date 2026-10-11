import type { User } from '@/types'

const KEY = 'bidarena.auth'

export interface PersistedAuth {
  token: string
  user: User
}

export function readAuth(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedAuth
    if (typeof parsed.token !== 'string' || typeof parsed.user?.id !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function writeAuth(auth: PersistedAuth): void {
  localStorage.setItem(KEY, JSON.stringify(auth))
}

export function clearAuth(): void {
  localStorage.removeItem(KEY)
}
