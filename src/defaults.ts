import type { Appearance, Behaviour, Capabilities } from "./types"

/**
 * The resolved shape of everything a caller may leave out.
 *
 * These live apart from the widget because two front ends now read them — the
 * script-tag widget and the React package — and a default that disagrees
 * between the two is a support ticket nobody can reproduce, because both
 * customers are "using askdb" and only one of them is using this file.
 */

export const DEFAULT_APPEARANCE: Required<Appearance> = {
  title: "Assistant",
  subtitle: "",
  greeting: "",
  accent: "#111827",
  accentForeground: "#ffffff",
  position: "right",
  offset: 20,
  radius: 16,
  launcherLabel: "",
  launcherIcon: "chat",
  avatarUrl: "",
  placeholder: "Ask a question…",
  suggestions: [],
  theme: "system",
  disclaimer: "",
  showBranding: true,
  zIndex: 2147483000,
}

export const DEFAULT_BEHAVIOUR: Required<Behaviour> = {
  autoOpen: false,
  openDelay: 0,
  rememberState: true,
  focusOnOpen: true,
  hideLauncher: false,
  startMaximized: false,
}

/**
 * Everything off until the server says otherwise.
 *
 * A capability the client invents is a button whose endpoint refuses it, and
 * the visitor gets the refusal rather than the developer.
 */
export const NO_CAPABILITIES: Capabilities = {
  threads: false,
  charts: false,
  citations: false,
  maximize: false,
  fullscreen: false,
}

/**
 * Strip `undefined` so a partial override never blanks a resolved default.
 *
 * `{...defaults, ...{title: undefined}}` gives `title: undefined`, which is how
 * a React caller passing `appearance={{title: props.title}}` used to erase the
 * server's title on every render where their own prop had not loaded yet.
 */
export function clean<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

/** Server appearance first, caller's overrides second. */
export function resolveAppearance(
  remote?: Partial<Appearance>,
  local?: Partial<Appearance>,
): Required<Appearance> {
  return { ...DEFAULT_APPEARANCE, ...clean(remote ?? {}), ...clean(local ?? {}) }
}

export function resolveBehaviour(
  ...sources: Array<Partial<Behaviour> | undefined>
): Required<Behaviour> {
  let out = { ...DEFAULT_BEHAVIOUR }
  for (const source of sources) out = { ...out, ...clean(source ?? {}) }
  return out
}

/** A duration a person can read at a glance. Matches the main product's. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const mins = Math.floor(ms / 60_000)
  return `${mins}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** "3m" — a thread list wants recency, not a timestamp. */
export function when(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ""
  const seconds = Math.max(0, (Date.now() - then) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

let counter = 0
export function messageId(): string {
  counter += 1
  return `m${counter}${Math.random().toString(36).slice(2, 8)}`
}
