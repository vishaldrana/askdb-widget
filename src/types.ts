/**
 * What a site owner can configure, and what the widget promises back.
 *
 * Two rules run through this file.
 *
 * **Everything is optional except the key.** A snippet that needs six fields
 * filled in correctly before it renders anything is a snippet that gets pasted
 * wrong, and the person pasting it is usually not the person who set the embed
 * up. Every appearance option also has a server-side default, set on the embed
 * itself, so the page can override nothing at all and still look right.
 *
 * **Anything visual can come from either side.** The server's appearance is
 * the default and the snippet's `appearance` overrides it, because the two
 * belong to different people: the embed's owner picks the greeting and the
 * suggestions, and whoever owns the page picks where it sits so it does not
 * cover their cookie banner.
 */

/** Which corner, on a desktop-sized screen. Mobile always takes the sheet. */
export type Position = "left" | "right"

export type Theme = "light" | "dark" | "system"

/** The launcher's face. `chat` unless a brand has a better idea. */
export type LauncherIcon = "chat" | "sparkle" | "question" | "search"

export interface Appearance {
  /** Header line. Defaults to the embed's name. */
  title?: string
  /** Second line, smaller. Good place for "usually replies instantly". */
  subtitle?: string
  /** First message, shown before anyone types. Markdown is allowed. */
  greeting?: string
  /** The brand colour: launcher fill, user bubble, focus ring. */
  accent?: string
  /** Text on the accent. Set it when the accent is pale. */
  accentForeground?: string
  position?: Position
  /** Distance from the corner, in pixels. */
  offset?: number
  /** Corner rounding, in pixels. 0 gives a square widget. */
  radius?: number
  /** Text beside the launcher icon, e.g. "Ask us anything". */
  launcherLabel?: string
  launcherIcon?: LauncherIcon
  /** Square image in the header. Any URL the page can load. */
  avatarUrl?: string
  placeholder?: string
  /** Buttons shown under the greeting. Three or four; they are a menu. */
  suggestions?: string[]
  theme?: Theme
  /** Small line under the composer, for a legal note. */
  disclaimer?: string
  showBranding?: boolean
  /** Highest `z-index` on the page, plus one. Raise it if something covers it. */
  zIndex?: number
}

export interface Identity {
  /** Your id for this person. Required — see `hash`. */
  id: string
  name?: string
  email?: string
  /**
   * `HMAC_SHA256(embed_secret, id)`, hex, computed **on your server**.
   *
   * Required, not optional. Without it the widget could be told it is talking
   * to any customer whose id somebody can guess; with it, the page can only
   * claim identities your own backend has vouched for. The secret never goes
   * in the page.
   */
  hash: string
}

export interface Behaviour {
  /** Open on load. Use sparingly; an assistant that opens itself is a popup. */
  autoOpen?: boolean
  /** Milliseconds before auto-opening. Ignored unless `autoOpen`. */
  openDelay?: number
  /**
   * Remember open/closed across page loads in the same tab. On by default:
   * navigating a site should not close the conversation you are having about
   * it.
   */
  rememberState?: boolean
  /** Take focus when opened. Off on mobile regardless, to avoid the keyboard. */
  focusOnOpen?: boolean
  /** Hide the launcher and drive it entirely from your own button. */
  hideLauncher?: boolean
  /** Start maximized. Only meaningful where the embed allows maximizing. */
  startMaximized?: boolean
}

export interface WidgetConfig {
  /** The publishable key from the embed's settings. Safe to put in the page. */
  key: string
  /**
   * `bubble` is the launcher in the corner. `page` fills the window and is
   * what the "open in a new tab" button opens — same code, same endpoints, so
   * the two cannot drift.
   */
  mode?: "bubble" | "page"
  /**
   * Where askdb lives. Only needed for self-hosted deployments; the default is
   * the origin the script was served from, which is right almost always.
   */
  apiUrl?: string
  appearance?: Appearance
  behaviour?: Behaviour
  /** American spelling, accepted because half the world will type it. */
  behavior?: Behaviour
  /**
   * Who is asking. **Required** — an embedded assistant only answers
   * signed-in users, because every question it can answer is a question about
   * somebody's own data.
   */
  user?: Identity
  /** Extra context sent with the first message, e.g. `{ plan: "pro" }`. */
  metadata?: Record<string, string | number | boolean>

  onReady?: () => void
  onOpen?: () => void
  onClose?: () => void
  /** Fired for every completed message, yours and the assistant's. */
  onMessage?: (message: { role: "user" | "assistant"; text: string }) => void
  onError?: (error: Error) => void
}

/** What an embed will let the widget do. Enforced server-side regardless. */
export interface Capabilities {
  /** Keep and revisit past conversations. */
  threads: boolean
  charts: boolean
  citations: boolean
  /** Offer the 80% dialog. */
  maximize: boolean
  /** Offer "open in a new tab". */
  fullscreen: boolean
}

/** One past conversation. */
export interface ThreadSummary {
  id: string
  title: string
  updated_at: string
  current?: boolean
}

/** What the server says the widget should look like, before page overrides. */
export interface RemoteConfig {
  name: string
  appearance: Required<
    Pick<
      Appearance,
      | "title"
      | "subtitle"
      | "greeting"
      | "accent"
      | "accentForeground"
      | "position"
      | "offset"
      | "radius"
      | "launcherLabel"
      | "launcherIcon"
      | "avatarUrl"
      | "placeholder"
      | "suggestions"
      | "theme"
      | "showBranding"
      | "disclaimer"
    >
  >
  limits: { messagesPerSession: number }
  capabilities: Capabilities
  requiresSignedIdentity: boolean
}

/** The public surface. Everything is safe to call before `init` resolves. */
export interface WidgetApi {
  init(config: WidgetConfig): void
  open(): void
  close(): void
  toggle(): void
  /** Send a question as if the visitor typed it. Opens the widget first. */
  send(text: string): void
  /** Change appearance or identity without reloading the page. */
  update(config: Partial<WidgetConfig>): void
  /** Forget the conversation and start a new one. */
  reset(): void
  /** Remove every element and listener. Safe to call twice. */
  destroy(): void
  isOpen(): boolean
  /** Grow to the 80% dialog, or shrink back. */
  maximize(on?: boolean): void
  version: string
}

// --------------------------------------------------------------- the wire

/** What an answer was based on, as much of it as a visitor is told. */
/** One table the query read, and how it was brought in. */
export interface CitationRead {
  table: string
  /** `base`, `joined`, or the join type with what it does to unmatched rows. */
  role?: string
  on?: string[]
  note?: string | null
}

/** What the executed query actually did, in plain English. */
export interface CitationDetail {
  reads?: CitationRead[]
  grain?: string | null
  measures?: Array<{ label: string; of: string }>
  filters?: string[]
  ordering?: string[]
  limit?: number | null
  period?: string | null
}

export interface Citation {
  index?: number
  intent?: string
  row_count?: number
  /** `verified` — an approved template ran. `generated` — written for this question. */
  trust?: string
  tool?: string
  saved_query_name?: string | null
  duration_ms?: number
  truncated?: boolean
  columns?: string[]
  detail?: CitationDetail | null
  /** The model's own account of why this query answers the question. */
  reasoning?: string | null
}

/** One thing the assistant did on the way to the answer. */
export interface Step {
  name?: string
  label?: string
  status?: "ok" | "error" | "running"
  duration_ms?: number
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string; label: string }
  | { type: "tool_end"; name: string; status: "ok" | "error"; duration_ms: number }
  | { type: "chart"; config: unknown }
  | {
      type: "complete"
      fullText: string
      charts?: unknown[]
      followups?: Array<{ question: string }>
      citations?: Citation[]
      steps?: Step[]
    }
  /** Wall clock for the whole turn, sent after `complete`. */
  | { type: "timing"; elapsed_ms: number }
  | { type: "error"; message: string }
  | { type: "done" }

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  charts?: unknown[]
  citations?: Citation[]
  steps?: Step[]
  /** How long the turn took end to end, server-measured. */
  elapsedMs?: number
  /** Still streaming. Drives the caret and disables the composer. */
  pending?: boolean
  failed?: boolean
  /** What the assistant is doing right now, e.g. "Querying orders". */
  activity?: string
  followups?: string[]
}
