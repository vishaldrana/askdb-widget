import type { Citation, Identity, RemoteConfig, Step, StreamEvent, ThreadSummary } from "./types"

/**
 * Talking to askdb from somebody else's page.
 *
 * Three things this has to survive that a first-party client does not: a
 * network that drops, a browser that suspends the tab, and a visitor who
 * closes the widget mid-answer. All three end up in the same place — an
 * aborted `fetch` — so the shape here is that every call takes a signal and
 * every failure is a typed `WidgetError` rather than whatever the platform
 * happened to throw.
 */

export class WidgetError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "network" | "server" | "aborted" | "limit",
    readonly status?: number,
  ) {
    super(message)
    this.name = "WidgetError"
  }
}

/** One stored message, as a replayed conversation returns it. */
export interface StoredMessage {
  id: string
  role: "user" | "assistant"
  text: string
  charts?: unknown[]
  citations?: Citation[]
  followups?: string[]
  steps?: Step[]
  elapsed_ms?: number
}

/**
 * Where the session token lives, per key.
 *
 * Namespaced by the publishable key, and that is not decoration. It was one
 * shared name, so two embeds on the same origin — or one page swapped from a
 * staging key to a production one — reused each other's token. The symptom is
 * the worst kind: everything works, and the assistant confidently answers from
 * the wrong database.
 */
function tokenKey(publicKey: string): string {
  return `askdb.session.${publicKey}`
}

export class Transport {
  private token: string | null = null

  private readonly storageKey: string

  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
  ) {
    this.storageKey = tokenKey(key)
    this.token = read(this.storageKey)
  }

  /**
   * The key travels in the query string on every request, including the ones
   * with a body.
   *
   * It has to: a CORS preflight has no body, and the server decides whether to
   * allow the origin by looking the key up. Putting it only in the body would
   * mean the preflight could not be answered and the browser would block the
   * request before the server ever saw it.
   */
  private url(path: string): string {
    const separator = path.includes("?") ? "&" : "?"
    return `${this.baseUrl}/v1/embed${path}${separator}key=${encodeURIComponent(this.key)}`
  }

  /**
   * The first call the widget makes, and the one most likely to be somebody's
   * first five minutes with this.
   *
   * A network failure *here* is almost never the network. It is a wrong key, a
   * site that is not on the allowlist, or an `apiUrl` pointing at nothing —
   * and "check your connection" sends a developer whose connection is fine to
   * look in the wrong place. Later calls keep the generic wording, because by
   * then the config has already loaded and the network genuinely is the likely
   * cause.
   */
  async config(signal?: AbortSignal): Promise<RemoteConfig> {
    try {
      const response = await this.request("/config", { method: "GET", signal })
      return (await response.json()) as RemoteConfig
    } catch (error) {
      if (error instanceof WidgetError && error.kind === "network") {
        throw new WidgetError(
          `Could not load the assistant from ${this.baseUrl}. Check that the key ` +
            "is right, that this site is on the embed's allowed origins, and " +
            "that apiUrl points at your askdb host.",
          "config",
        )
      }
      throw error
    }
  }

  /**
   * Start or resume a conversation.
   *
   * A stored token is reused so a page navigation keeps the history. If the
   * server has forgotten it — expired, revoked, redeployed — the first message
   * fails with 403 and `send` starts a fresh session once. That is cheaper
   * than validating the token up front on every page load, and it is the same
   * number of round trips in the common case.
   */
  async session(user?: Identity, signal?: AbortSignal): Promise<RemoteConfig> {
    if (!user?.id || !user?.hash) {
      // Caught here rather than at the server so the message names the fix and
      // arrives before any request goes out.
      throw new WidgetError(
        "This assistant only answers signed-in users. Pass `user: { id, hash }` " +
          "to init, with the hash computed on your server.",
        "config",
      )
    }
    const response = await this.request("/session", {
      method: "POST",
      signal,
      body: JSON.stringify({
        key: this.key,
        user_id: user.id,
        user_hash: user.hash,
      }),
    })
    const data = (await response.json()) as { token: string; config: RemoteConfig }
    this.token = data.token
    write(this.storageKey, data.token)
    return data.config
  }

  hasSession(): boolean {
    return !!this.token
  }

  forget(): void {
    this.token = null
    remove(this.storageKey)
  }

  /** This visitor's past conversations. Empty when the embed keeps none. */
  async threads(signal?: AbortSignal): Promise<ThreadSummary[]> {
    const response = await this.request("/threads", { method: "GET", signal, auth: true })
    return (await response.json()) as ThreadSummary[]
  }

  async newThread(signal?: AbortSignal): Promise<ThreadSummary> {
    const response = await this.request("/threads", {
      method: "POST",
      signal,
      auth: true,
      body: JSON.stringify({}),
    })
    return (await response.json()) as ThreadSummary
  }

  /** Replay one, and make it the session's current conversation. */
  async history(threadId: string, signal?: AbortSignal): Promise<StoredMessage[]> {
    const response = await this.request(`/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "GET",
      signal,
      auth: true,
    })
    return (await response.json()) as StoredMessage[]
  }

  /**
   * Ask a question; yield events as they arrive.
   *
   * An async generator rather than a callback because back-pressure matters:
   * the caller renders each token, and a callback would happily out-run the
   * DOM on a long answer over a fast connection.
   */
  async *ask(
    text: string,
    signal: AbortSignal,
    threadId?: string | null,
  ): AsyncGenerator<StreamEvent> {
    const response = await this.request("/message", {
      method: "POST",
      signal,
      auth: true,
      body: JSON.stringify(threadId ? { text, thread_id: threadId } : { text }),
    })

    const body = response.body
    if (!body) {
      throw new WidgetError("This browser cannot stream responses.", "network")
    }

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line. Anything after the last
        // one is a partial frame and stays in the buffer — splitting on
        // newlines instead would cut a JSON payload in half on a slow link,
        // which is the classic way streaming "works locally".
        let boundary = buffer.indexOf("\n\n")
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const event = parseFrame(frame)
          if (event) yield event
          boundary = buffer.indexOf("\n\n")
        }
      }
    } finally {
      // Cancelling releases the connection immediately rather than at the next
      // GC. A visitor who closes the widget should stop paying for the answer.
      reader.cancel().catch(() => {})
    }
  }

  private async request(
    path: string,
    init: RequestInit & { auth?: boolean },
  ): Promise<Response> {
    const { auth, ...rest } = init
    let response: Response
    try {
      response = await fetch(this.url(path), {
        ...rest,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: `Bearer ${this.token ?? ""}` } : {}),
          ...(init.headers ?? {}),
        },
        // Never cookies. The widget carries a bearer token it was handed, and
        // one that could ride the visitor's cookies would be a much bigger
        // thing to reason about.
        credentials: "omit",
        mode: "cors",
      })
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new WidgetError("Cancelled.", "aborted")
      }
      throw new WidgetError(
        "Could not reach the assistant. Check your connection and try again.",
        "network",
      )
    }

    if (!response.ok) {
      throw new WidgetError(await messageFor(response), kindFor(response.status), response.status)
    }
    return response
  }
}

function parseFrame(frame: string): StreamEvent | null {
  // A frame may carry comments (`:` lines, used as keep-alives) and multiple
  // `data:` lines. Only the data matters here, and it is always one JSON
  // object per frame.
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("")
  if (!data) return null
  try {
    return JSON.parse(data) as StreamEvent
  } catch {
    // A malformed frame is not worth killing the answer over: the next one is
    // probably fine, and dropping this token is invisible.
    return null
  }
}

function kindFor(status: number): WidgetError["kind"] {
  if (status === 403 || status === 429) return "limit"
  if (status === 404) return "config"
  return "server"
}

async function messageFor(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string }; detail?: string }
    // The server's wording is written for the person reading it, so prefer it
    // over anything invented here.
    return body?.error?.message || body?.detail || fallback(response.status)
  } catch {
    return fallback(response.status)
  }
}

function fallback(status: number): string {
  if (status === 404) return "This assistant is not available."
  if (status === 403) return "This assistant is not enabled for this website."
  if (status === 429) return "Too many questions just now — please try again shortly."
  return "Something went wrong. Please try again."
}

// Storage is wrapped because it throws rather than returning null in Safari's
// private mode and wherever a site has disabled it. A widget that cannot
// remember a token still works; one that throws on load does not.
function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    /* not fatal — the session lives in memory for this page instead */
  }
}

function remove(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    /* as above */
  }
}
