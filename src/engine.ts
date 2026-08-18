import { Transport, WidgetError } from "./api"
import {
  NO_CAPABILITIES,
  messageId,
  resolveAppearance,
  resolveBehaviour,
} from "./defaults"
import type {
  Appearance,
  Behaviour,
  Capabilities,
  ChatMessage,
  Identity,
  RemoteConfig,
  ThreadSummary,
  WidgetConfig,
} from "./types"

/**
 * The conversation, with no opinion about how it is drawn.
 *
 * This used to live inside the script-tag widget, tangled with the DOM it
 * mutated. Adding a React package made that untenable: the second front end
 * would have needed its own copy of session bootstrap, the SSE reducer, thread
 * switching, the 403-retry and the message cap — five things that are subtle,
 * that took real bugs to get right, and that would then have had to be fixed
 * twice forever.
 *
 * So the rule here is that this file knows about the wire and about state, and
 * nothing else. It reports changes through one callback; whether that becomes
 * a `setState` or a `querySelector` is the front end's business.
 */

export type Status = "idle" | "loading" | "ready" | "failed"

export interface EngineState {
  status: Status
  /** Set when the assistant could not start at all. Not per-message failures. */
  error: Error | null
  messages: ChatMessage[]
  /** True while an answer is streaming. The composer watches this. */
  busy: boolean
  look: Required<Appearance>
  behaviour: Required<Behaviour>
  capabilities: Capabilities
  threads: ThreadSummary[]
  threadId: string | null
  /** Questions left in this session, or `null` when the embed sets no cap. */
  remaining: number | null
  /** The embed's name, for a header that was given no title. */
  name: string
}

export interface EngineOptions {
  config: WidgetConfig
  baseUrl: string
  onChange: (state: EngineState) => void
  /** Mirrors the config callbacks; kept separate so React can pass fresh ones. */
  onMessage?: (message: { role: "user" | "assistant"; text: string }) => void
  onError?: (error: Error) => void
  onReady?: () => void
}

export class ChatEngine {
  private transport: Transport
  private config: WidgetConfig
  private abort: AbortController | null = null
  private destroyed = false
  /** The in-flight `/config` request, so concurrent starts share one. */
  private loading: Promise<void> | null = null

  private state: EngineState

  constructor(private readonly options: EngineOptions) {
    this.config = options.config
    this.transport = new Transport(options.baseUrl, options.config.key)
    this.state = {
      status: "idle",
      error: null,
      messages: [],
      busy: false,
      look: resolveAppearance(undefined, options.config.appearance),
      behaviour: resolveBehaviour(options.config.behaviour, options.config.behavior),
      capabilities: NO_CAPABILITIES,
      threads: [],
      threadId: null,
      remaining: null,
      name: "",
    }
  }

  current(): EngineState {
    return this.state
  }

  /**
   * The state object is replaced rather than mutated on every change.
   *
   * React's `useSyncExternalStore` compares by identity, so a mutated object
   * renders nothing; and the widget's own repaint is cheap either way. The
   * cost is an allocation per streamed token, which is nothing next to the
   * paint it triggers.
   */
  private set(patch: Partial<EngineState>): void {
    if (this.destroyed) return
    this.state = { ...this.state, ...patch }
    this.options.onChange(this.state)
  }

  private touch(): void {
    // Messages are mutated in place while streaming — copying the whole list
    // per token would be the one allocation that actually shows up — so the
    // array identity is bumped explicitly when the contents have changed.
    this.set({ messages: [...this.state.messages] })
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Load the embed's public configuration. No session, no cost.
   *
   * Deliberately separate from `openSession`: a visitor who never opens the
   * launcher should be one cached GET, not a conversation in the logs and a
   * slot off the rate limit.
   *
   * Guarded by a shared promise rather than a "have I started" flag. React 18
   * in development mounts an effect, tears it down, and mounts it again — so a
   * flag meant the first call owned the request, the teardown marked the
   * engine dead before it resolved, and the second call found the flag already
   * set and did nothing. The widget rendered its built-in defaults forever and
   * the network tab showed a perfectly good 200.
   */
  async start(): Promise<void> {
    if (this.destroyed || this.state.status === "ready") return
    if (this.loading) return this.loading

    this.set({ status: "loading" })
    this.loading = (async () => {
      try {
        const remote = await this.transport.config()
        this.applyRemote(remote)
        this.set({ status: "ready", error: null })
        this.options.onReady?.()
        this.options.config.onReady?.()
      } catch (error) {
        this.set({ status: "failed", error: error as Error })
        this.options.onError?.(error as Error)
        this.options.config.onError?.(error as Error)
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /**
   * Come back to life after a teardown that was not a real unmount.
   *
   * Paired with `destroy`, which a React effect's cleanup calls on every
   * development remount. Everything the engine holds — the session token, the
   * transcript — is worth keeping across that; only the stream in flight is
   * not.
   */
  attach(): void {
    this.destroyed = false
    void this.start()
  }

  /** Create the session. Called on first open, or on first question. */
  async openSession(): Promise<void> {
    if (this.transport.hasSession() || this.destroyed) return
    try {
      this.applyRemote(await this.transport.session(this.config.user))
    } catch (error) {
      this.pushError(error as Error)
    }
  }

  hasSession(): boolean {
    return this.transport.hasSession()
  }

  private applyRemote(remote: RemoteConfig): void {
    this.remoteAppearance = (remote.appearance ?? {}) as Partial<Appearance>
    const look = resolveAppearance(this.remoteAppearance, this.config.appearance)
    const limit = remote.limits?.messagesPerSession ?? 0
    this.set({
      name: remote.name,
      look,
      capabilities: { ...NO_CAPABILITIES, ...(remote.capabilities ?? {}) },
      remaining: limit > 0 ? Math.max(0, limit - this.asked) : null,
    })
    this.limit = limit

    if (remote.requiresSignedIdentity && this.config.user?.id && !this.config.user.hash) {
      // eslint-disable-next-line no-console
      console.warn(
        "[askdb] this assistant requires a signed user id — compute " +
          "HMAC_SHA256(secret, user.id) on your server and pass it as user.hash",
      )
    }
  }

  private limit = 0
  private asked = 0

  /**
   * The appearance the server sent, kept so `update` can merge onto it.
   *
   * Without this, a page calling `update({appearance: {accent}})` re-resolved
   * from the built-in defaults and the caller's own object — silently
   * discarding the greeting, the suggestions and the title the embed's owner
   * had configured. The symptom was a widget that lost its greeting the moment
   * the host page changed one colour.
   */
  private remoteAppearance: Partial<Appearance> = {}

  /**
   * Change configuration on a live conversation.
   *
   * The identity check is the important one: a changed `user.id` is a
   * different person, and keeping the transcript would show one customer the
   * answers given to another. React makes this easy to hit by accident, since
   * a `user` object rebuilt every render arrives here as a change.
   */
  update(patch: Partial<WidgetConfig>): void {
    const previousUser = this.config.user?.id
    this.config = { ...this.config, ...patch }
    if (patch.appearance) {
      // Server first, page second — the same precedence as the initial
      // resolve, so a page override never blanks a field it did not mention.
      this.set({ look: resolveAppearance(this.remoteAppearance, this.config.appearance) })
    }
    if (patch.behaviour || patch.behavior) {
      this.set({ behaviour: resolveBehaviour(this.config.behaviour, this.config.behavior) })
    }
    if (patch.user && patch.user.id !== previousUser) this.reset()
  }

  identity(): Identity | undefined {
    return this.config.user
  }

  destroy(): void {
    this.abort?.abort()
    this.destroyed = true
  }

  // ---------------------------------------------------------------- greeting

  /**
   * The opening message, if the embed has one.
   *
   * Not persisted and not sent anywhere — it is part of the appearance, so it
   * is re-shown for a new conversation and never counted as a turn.
   */
  greet(): void {
    if (this.state.messages.length) return
    const greeting = this.state.look.greeting
    if (!greeting) return
    this.state.messages.push({ id: messageId(), role: "assistant", text: greeting })
    this.touch()
  }

  // --------------------------------------------------------------- threads

  async loadThreads(): Promise<void> {
    if (!this.state.capabilities.threads) return
    try {
      this.set({ threads: await this.transport.threads() })
    } catch (error) {
      this.options.onError?.(error as Error)
    }
  }

  async newThread(): Promise<void> {
    try {
      const thread = await this.transport.newThread()
      this.set({ threadId: thread.id, messages: [] })
      this.greet()
      void this.loadThreads()
    } catch (error) {
      this.pushError(error as Error)
    }
  }

  async openThread(id: string): Promise<void> {
    try {
      const history = await this.transport.history(id)
      this.set({
        threadId: id,
        messages: history.map((stored) => ({
          id: stored.id,
          role: stored.role,
          text: stored.text,
          charts: stored.charts,
          citations: stored.citations,
          followups: stored.followups,
          steps: stored.steps,
          elapsedMs: stored.elapsed_ms,
        })),
      })
      if (!history.length) this.greet()
    } catch (error) {
      this.pushError(error as Error)
    }
  }

  // --------------------------------------------------------------- sending

  /** Stop the answer in flight and keep whatever arrived. */
  stop(): void {
    this.abort?.abort()
  }

  async send(text: string): Promise<void> {
    const question = text.trim()
    if (!question || this.destroyed || this.state.busy) return

    // Checked here rather than at the server's refusal, so the visitor is told
    // before they type the next one rather than after.
    if (this.limit && this.asked >= this.limit) {
      this.state.messages.push({
        id: messageId(),
        role: "assistant",
        text: "This conversation has reached its limit. Reload the page to start a new one.",
        failed: true,
      })
      this.touch()
      return
    }
    this.asked += 1
    this.set({
      busy: true,
      remaining: this.limit ? Math.max(0, this.limit - this.asked) : null,
    })

    this.state.messages.push({ id: messageId(), role: "user", text: question })
    const reply: ChatMessage = { id: messageId(), role: "assistant", text: "", pending: true }
    this.state.messages.push(reply)
    this.touch()

    this.options.onMessage?.({ role: "user", text: question })
    this.config.onMessage?.({ role: "user", text: question })

    this.abort = new AbortController()
    try {
      if (!this.transport.hasSession()) await this.transport.session(this.config.user)
      await this.consume(question, reply)
    } catch (error) {
      const err = error as WidgetError
      if (err?.kind === "aborted") {
        // A stopped answer keeps whatever text arrived — deleting it throws
        // away work the visitor watched being done. An empty one goes, since
        // an empty bubble is just a mistake on screen.
        reply.pending = false
        if (!reply.text) {
          this.set({ messages: this.state.messages.filter((m) => m !== reply) })
        } else {
          this.touch()
        }
      } else if (err?.status === 403 && this.transport.hasSession()) {
        // A stale token from a previous visit. Start a new session once and
        // retry — silently, because "your session expired" means nothing to
        // somebody who has been on the page ten seconds.
        this.transport.forget()
        try {
          await this.transport.session(this.config.user)
          await this.consume(question, reply)
        } catch (retry) {
          this.failMessage(reply, retry as Error)
        }
      } else {
        this.failMessage(reply, err)
      }
    } finally {
      this.abort = null
      this.set({ busy: false })
    }
  }

  /**
   * The stream reducer.
   *
   * One `switch` and no rendering. Every front end wants the same thing out of
   * these events, and the parts that are easy to get subtly wrong — matching a
   * `tool_end` to the right `tool_start`, holding charts back until the answer
   * stops moving — are exactly the parts worth having in one place.
   */
  private async consume(question: string, reply: ChatMessage): Promise<void> {
    const signal = this.abort!.signal
    for await (const event of this.transport.ask(question, signal, this.state.threadId)) {
      switch (event.type) {
        case "token":
          reply.text += event.text
          reply.activity = undefined
          this.touch()
          break
        case "tool_start":
          // The label is written server-side for a reader — "Counting orders",
          // not "run_query". Shown because a five-second silence with nothing
          // on screen reads as broken.
          reply.activity = event.label
          reply.steps = [
            ...(reply.steps ?? []),
            { name: event.name, label: event.label, status: "running" },
          ]
          this.touch()
          break
        case "tool_end": {
          reply.activity = undefined
          const steps = [...(reply.steps ?? [])]
          // The last running step of this name: a turn can call the same tool
          // twice, and matching on name alone closes the wrong one.
          for (let i = steps.length - 1; i >= 0; i--) {
            const step = steps[i]
            if (step && step.name === event.name && step.status === "running") {
              steps[i] = { ...step, status: event.status, duration_ms: event.duration_ms }
              break
            }
          }
          reply.steps = steps
          this.touch()
          break
        }
        case "chart":
          // Collected rather than drawn now: `complete` carries the final set,
          // and a chart rendered mid-stream is a chart redrawn per token.
          reply.charts = [...(reply.charts ?? []), event.config]
          break
        case "complete":
          reply.text = event.fullText || reply.text
          reply.charts = (event.charts as unknown[]) ?? reply.charts
          reply.citations = event.citations ?? []
          reply.steps = event.steps ?? reply.steps
          reply.followups = (event.followups ?? []).map((f) => f.question).slice(0, 3)
          break
        case "timing":
          reply.elapsedMs = event.elapsed_ms
          break
        case "error":
          reply.failed = true
          reply.text = event.message
          break
        case "done":
          break
      }
    }
    reply.pending = false
    reply.activity = undefined
    this.touch()
    if (!reply.failed) {
      this.options.onMessage?.({ role: "assistant", text: reply.text })
      this.config.onMessage?.({ role: "assistant", text: reply.text })
    }
    // A first question in a session the server has just given a thread to:
    // refresh the list so the drawer is not empty behind the conversation.
    if (this.state.capabilities.threads) void this.loadThreads()
  }

  private failMessage(message: ChatMessage, error: Error): void {
    message.pending = false
    message.failed = true
    message.text =
      error instanceof WidgetError ? error.message : "Something went wrong. Please try again."
    this.touch()
    this.options.onError?.(error)
    this.config.onError?.(error)
  }

  private pushError(error: Error): void {
    this.state.messages.push({
      id: messageId(),
      role: "assistant",
      text: error instanceof WidgetError ? error.message : "Something went wrong.",
      failed: true,
    })
    this.touch()
    this.options.onError?.(error)
    this.config.onError?.(error)
  }

  /** Forget the session and the transcript, and start again. */
  reset(): void {
    this.abort?.abort()
    this.transport.forget()
    this.asked = 0
    this.set({
      messages: [],
      threadId: null,
      threads: [],
      busy: false,
      remaining: this.limit || null,
    })
  }
}
