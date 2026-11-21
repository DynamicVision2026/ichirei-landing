// Sign-in on the page (2026-11-20): what the server says about the visitor and which ways in exist right now (Google, LINE, the email link — each shows only when its keys exist).
// One small store for the whole page, asked once and again when told (after a sign-in or out).

import { useEffect, useState } from 'react'

export interface AuthState {
  loaded: boolean
  providers: { google: boolean; line: boolean; email: boolean }
  signedIn: boolean
  /** The header text: a masked email or the LINE name. */
  display: string | null
  kind: 'email' | 'line' | null
  /** The signed-in person's own email (to prefill the free-gift hold and the checkout) — never shown in a page. */
  email: string | null
  /** The provider's display name (LINE only): Part 21 prefills the sender's name on the order step with it. */
  name: string | null
  needsEmail: boolean
}

const EMPTY: AuthState = { loaded: false, providers: { google: false, line: false, email: false }, signedIn: false, display: null, kind: null, email: null, name: null, needsEmail: false }
let state: AuthState = EMPTY
let inflight: Promise<void> | null = null
const subs = new Set<(s: AuthState) => void>()

const set = (s: AuthState): void => {
  state = s
  for (const f of subs) f(s)
}

export async function refreshAuth(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' })
      if (!r.ok) return set({ ...EMPTY, loaded: true })
      const j = (await r.json()) as { providers?: Partial<AuthState['providers']>; signed_in?: boolean; display?: string; kind?: 'email' | 'line'; email?: string; name?: string; needs_email?: boolean }
      set({
        loaded: true,
        providers: { google: j.providers?.google === true, line: j.providers?.line === true, email: j.providers?.email === true },
        signedIn: j.signed_in === true,
        display: typeof j.display === 'string' ? j.display : null,
        kind: j.kind ?? null,
        email: typeof j.email === 'string' ? j.email : null,
        name: typeof j.name === 'string' && j.name.trim() ? j.name.trim() : null,
        needsEmail: j.needs_email === true,
      })
    } catch {
      set({ ...EMPTY, loaded: true })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** The visitor's sign-in state; it asks the server on first use. */
export function useAuth(): AuthState {
  const [s, setS] = useState<AuthState>(state)
  useEffect(() => {
    subs.add(setS)
    if (!state.loaded) void refreshAuth()
    else setS(state)
    return () => {
      subs.delete(setS)
    }
  }, [])
  return s
}

/** Sign-in is the precondition of the free trial once at least one way in exists; until then nobody is turned away. */
export const signInRequired = (a: AuthState): boolean => a.loaded && (a.providers.google || a.providers.line || a.providers.email)

/** The marker that keeps "press 「字を見つける」" across a sign-in: the story is in the saved draft, and this says the round starts right after. */
export const AFTER_KEY = 'ichirei.afterSignin'
export const markAfterSignIn = (what: 'find' | 'back'): void => {
  try {
    window.sessionStorage.setItem(AFTER_KEY, what)
  } catch {
    // without storage the draft banner still offers the story back
  }
}
export const takeAfterSignIn = (): 'find' | 'back' | null => {
  try {
    const v = window.sessionStorage.getItem(AFTER_KEY)
    window.sessionStorage.removeItem(AFTER_KEY)
    return v === 'find' || v === 'back' ? v : null
  } catch {
    return null
  }
}
export const peekAfterSignIn = (): boolean => {
  try {
    return window.sessionStorage.getItem(AFTER_KEY) === 'find'
  } catch {
    return false
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // the cookie is cleared by the answer; a failed request leaves things as they were
  }
  set({ ...state, signedIn: false, display: null, kind: null, email: null, needsEmail: false })
}
