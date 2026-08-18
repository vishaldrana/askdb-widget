import { Transport, WidgetError } from "./api"
import { renderChart, type ChartConfig } from "./chart"
import {
  CLOSE,
  EXTERNAL,
  LAUNCHER_ICONS,
  MAXIMIZE,
  MENU,
  MINIMIZE,
  PLUS,
  SEND,
} from "./icons"
import { escapeHtml, render } from "./markdown"
import { stylesheet } from "./styles"
import type {
  Appearance,
  Behaviour,
  Capabilities,
  ChatMessage,
  RemoteConfig,
  WidgetConfig,
} from "./types"

/**
 * The widget.
 *
 * Rendered into a shadow root attached to a `<div>` appended to `<body>`, for
 * one reason: the host page's CSS must not reach it and its CSS must not reach
 * the host page. Every site has a `* { box-sizing }` rule and a `button`
 * reset, and inheriting either is how an embedded widget ends up looking
 * broken in a way its author cannot reproduce.
 *
 * The DOM is built once and mutated afterwards. Re-rendering the message list
 * on every token would lose the visitor's text selection and reset the scroll
 * position mid-answer, which are the two things people actually do while an
 * answer is arriving.
 */

// Per key, for the same reason the session token is: two embeds on one origin
// must not share their remembered state.
const openKey = (key: string) => `askdb.open.${key}`
const maxKey = (key: string) => `askdb.max.${key}`

const DEFAULTS: Required<Appearance> = {
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

const DEFAULT_BEHAVIOUR: Required<Behaviour> = {
  autoOpen: false,
  openDelay: 0,
  rememberState: true,
  focusOnOpen: true,
  hideLauncher: false,
  startMaximized: false,
}

/** Everything off until the server says otherwise — a capability the widget
 *  invents is a button whose endpoint refuses it. */
const NO_CAPABILITIES: Capabilities = {
  threads: false,
  charts: false,
  citations: false,
  maximize: false,
  fullscreen: false,
}

export class Widget {
  private host: HTMLDivElement
  private root: ShadowRoot
  private transport: Transport
  private config: WidgetConfig
  private look: Required<Appearance> = DEFAULTS
  private behaviour: Required<Behaviour> = DEFAULT_BEHAVIOUR

  private open = false
  private busy = false
  private messages: ChatMessage[] = []
  private abort: AbortController | null = null
  private destroyed = false
  private themeQuery: MediaQueryList | null = null
  private capabilities: Capabilities = NO_CAPABILITIES
  private maximized = false
  private threadId: string | null = null
  private drawerOpen = false
  /** Suppresses auto-scroll while the visitor is reading further up. */
  private pinned = true
  /** How many questions this session may ask, from the server. */
  private limit = 0
  private asked = 0

  private el!: {
    style: HTMLStyleElement
    root: HTMLDivElement
    launcher: HTMLButtonElement
    panel: HTMLDivElement
    log: HTMLDivElement
    input: HTMLTextAreaElement
    send: HTMLButtonElement
    title: HTMLDivElement
    subtitle: HTMLDivElement
    avatar: HTMLImageElement
    live: HTMLDivElement
    foot: HTMLDivElement
    actions: HTMLDivElement
    drawer: HTMLDivElement
    threads: HTMLDivElement
  }

  private readonly mode: "bubble" | "page"
  private readonly baseUrl: string

  constructor(config: WidgetConfig) {
    this.config = config
    this.mode = config.mode === "page" ? "page" : "bubble"
    this.baseUrl = baseUrl(config.apiUrl)
    this.transport = new Transport(this.baseUrl, config.key)

    this.host = document.createElement("div")
    this.host.setAttribute("data-askdb-widget", "")
    this.host.setAttribute("data-mode", this.mode)
    // Deliberately not `all: initial` here. An inline declaration outranks the
    // `:host` rule, so `all: initial` on the element resets font-family to the
    // browser default *and wins*, and the widget renders in Times on a page
    // that had nothing to do with it. The reset belongs inside the shadow
    // root, where the stylesheet can set what it wants afterwards.
    this.host.style.cssText = "position:relative;"
    this.root = this.host.attachShadow({ mode: "open" })

    this.build()
    document.body.appendChild(this.host)
    void this.boot()
  }

  // ------------------------------------------------------------ lifecycle

  private async boot(): Promise<void> {
    try {
      // Config first, and rendered before any session is created: a visitor
      // who never opens the widget should cost nothing but one cached GET.
      const remote = await this.transport.config()
      this.applyRemote(remote)
      this.config.onReady?.()

      // Page mode *is* the widget: there is no launcher to press and nothing
      // else on the page to go back to.
      if (this.mode === "page") this.show()
      else if (this.behaviour.rememberState && read(openKey(this.config.key)) === "1") this.show()
      else if (this.behaviour.autoOpen) {
        window.setTimeout(() => this.show(), this.behaviour.openDelay)
      }
    } catch (error) {
      // A misconfigured key must not leave a broken button on somebody's
      // marketing page. Remove ourselves and tell the developer why.
      this.fail(error as Error)
    }
  }

  private fail(error: Error): void {
    this.config.onError?.(error)
    const detail = error instanceof WidgetError ? error.kind : "unknown"
    // eslint-disable-next-line no-console
    console.error(`[askdb] widget disabled (${detail}): ${error.message}`)
    this.destroy()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.abort?.abort()
    this.themeQuery?.removeEventListener("change", this.onSystemTheme)
    document.removeEventListener("keydown", this.onKeydown, true)
    this.host.remove()
  }

  // ---------------------------------------------------------------- state

  isOpen(): boolean {
    return this.open
  }

  show(): void {
    if (this.destroyed || this.open) return
    this.open = true
    this.el.panel.classList.remove("hidden")
    this.el.launcher.setAttribute("aria-expanded", "true")
    write(openKey(this.config.key), "1")
    this.config.onOpen?.()

    // Only now. A visitor who never opens the widget never gets a session,
    // which keeps the rate limit meaningful and the logs honest about how many
    // people actually talked to it.
    if (!this.transport.hasSession()) void this.startSession()
    if (!this.messages.length) this.greet()

    // Focus is deliberately skipped on small screens: taking it summons the
    // on-screen keyboard over the greeting the visitor came to read.
    if (this.behaviour.focusOnOpen && window.innerWidth > 480) {
      window.setTimeout(() => this.el.input.focus(), 60)
    }
    this.scrollToEnd(true)
  }

  hide(): void {
    if (this.destroyed || !this.open || this.mode === "page") return
    this.open = false
    this.el.panel.classList.add("hidden")
    this.el.launcher.setAttribute("aria-expanded", "false")
    write(openKey(this.config.key), "0")
    this.config.onClose?.()
    // Answering into a closed widget wastes the visitor's data and our tokens.
    this.abort?.abort()
    this.el.launcher.focus()
  }

  toggle(): void {
    this.open ? this.hide() : this.show()
  }

  reset(): void {
    this.abort?.abort()
    this.transport.forget()
    this.messages = []
    this.asked = 0
    this.el.log.replaceChildren()
    this.busy = false
    this.setBusy(false)
    if (this.open) {
      void this.startSession()
      this.greet()
    }
  }

  update(patch: Partial<WidgetConfig>): void {
    this.config = { ...this.config, ...patch }
    if (patch.appearance) {
      this.look = { ...this.look, ...clean(patch.appearance) }
      this.restyle()
    }
    if (patch.behaviour || patch.behavior) {
      this.behaviour = {
        ...this.behaviour,
        ...clean(patch.behaviour ?? {}),
        ...clean(patch.behavior ?? {}),
      }
      this.el.launcher.classList.toggle("hidden", this.behaviour.hideLauncher)
    }
    // A changed identity is a different person: keeping the conversation would
    // show one customer the answers given to another.
    if (patch.user && patch.user.id !== this.config.user?.id) this.reset()
  }


  // ------------------------------------------------------------ size

  /**
   * The 80% dialog.
   *
   * Between the corner panel and a whole tab there is a real gap: a table of
   * twenty rows and a chart beside it need room the panel does not have, and
   * do not need a page of their own. This is that middle, and it is a mode
   * rather than a resize handle because the two useful sizes are "out of the
   * way" and "I am reading this now" — nobody wants to negotiate pixels.
   */
  maximize(on = !this.maximized): void {
    if (!this.capabilities.maximize || this.mode === "page") return
    this.maximized = on
    this.el.root.classList.toggle("maximized", on)
    write(maxKey(this.config.key), on ? "1" : "0")
    this.renderActions()
    this.scrollToEnd(true)
  }

  /**
   * The same conversation, in a tab of its own.
   *
   * The identity travels in the URL because the new tab has no way to ask the
   * opener for it. That is the same pair of values already sitting in the
   * page's own snippet, so nothing is exposed that was not, but it does mean
   * the URL is personal and should not be pasted into a chat — hence
   * `noopener`, and hence the page telling the visitor so.
   */
  private openFullscreen(): void {
    const user = this.config.user
    const url = new URL(`${this.baseUrl}/embed/chat`)
    url.searchParams.set("key", this.config.key)
    if (user?.id && user.hash) {
      url.searchParams.set("uid", user.id)
      url.searchParams.set("uh", user.hash)
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer")
  }

  // --------------------------------------------------------- conversations

  private toggleDrawer(open = !this.drawerOpen): void {
    if (!this.capabilities.threads) return
    this.drawerOpen = open
    this.el.drawer.classList.toggle("hidden", !open)
    this.el.root.querySelector(".menu")?.setAttribute("aria-expanded", String(open))
    if (open) void this.loadThreads()
  }

  private async loadThreads(): Promise<void> {
    try {
      const threads = await this.transport.threads()
      this.el.threads.replaceChildren()
      if (!threads.length) {
        const empty = document.createElement("p")
        empty.className = "empty"
        empty.textContent = "No past conversations yet."
        this.el.threads.appendChild(empty)
        return
      }
      for (const thread of threads) {
        const row = document.createElement("button")
        row.type = "button"
        row.className = `thread${thread.id === this.threadId ? " active" : ""}`
        row.innerHTML = `<span class="t">${escapeHtml(thread.title)}</span><span class="w">${escapeHtml(when(thread.updated_at))}</span>`
        row.addEventListener("click", () => void this.openThread(thread.id))
        this.el.threads.appendChild(row)
      }
    } catch (error) {
      this.config.onError?.(error as Error)
    }
  }

  private async startThread(): Promise<void> {
    try {
      const thread = await this.transport.newThread()
      this.threadId = thread.id
      this.messages = []
      this.el.log.replaceChildren()
      this.greet()
      this.toggleDrawer(false)
      void this.loadThreads()
    } catch (error) {
      this.showError(error as Error)
    }
  }

  private async openThread(id: string): Promise<void> {
    try {
      const history = await this.transport.history(id)
      this.threadId = id
      this.messages = []
      this.el.log.replaceChildren()
      for (const stored of history) {
        this.push({
          id: stored.id,
          role: stored.role,
          text: stored.text,
          charts: stored.charts,
          citations: stored.citations,
          followups: stored.followups,
        })
      }
      if (!history.length) this.greet()
      this.toggleDrawer(false)
      this.scrollToEnd(true)
    } catch (error) {
      this.showError(error as Error)
    }
  }

  /** The header's right-hand controls, rebuilt when capabilities change. */
  private renderActions(): void {
    const buttons: string[] = []
    if (this.mode !== "page" && this.capabilities.maximize) {
      buttons.push(
        `<button class="icon act-max" type="button" aria-label="${this.maximized ? "Restore" : "Maximize"}" title="${this.maximized ? "Restore" : "Maximize"}">${this.maximized ? MINIMIZE : MAXIMIZE}</button>`,
      )
    }
    if (this.mode !== "page" && this.capabilities.fullscreen) {
      buttons.push(
        `<button class="icon act-tab" type="button" aria-label="Open in a new tab" title="Open in a new tab">${EXTERNAL}</button>`,
      )
    }
    this.el.actions.innerHTML = buttons.join("")
    this.el.actions
      .querySelector(".act-max")
      ?.addEventListener("click", () => this.maximize())
    this.el.actions
      .querySelector(".act-tab")
      ?.addEventListener("click", () => this.openFullscreen())

    const menu = this.el.root.querySelector(".menu") as HTMLElement | null
    menu?.classList.toggle("hidden", !this.capabilities.threads)
  }

  // -------------------------------------------------------------- session

  private async startSession(): Promise<void> {
    try {
      const remote = await this.transport.session(this.config.user)
      this.applyRemote(remote)
    } catch (error) {
      this.showError(error as Error)
    }
  }

  private applyRemote(remote: RemoteConfig): void {
    // Server first, page second. The embed's owner sets the greeting and the
    // suggestions; whoever owns the page sets where it sits so it does not
    // cover their cookie banner. Neither can silently win the other's field.
    this.look = {
      ...DEFAULTS,
      ...clean(remote.appearance as Partial<Appearance>),
      ...clean(this.config.appearance ?? {}),
    }
    this.behaviour = {
      ...DEFAULT_BEHAVIOUR,
      ...clean(this.config.behaviour ?? {}),
      ...clean(this.config.behavior ?? {}),
    }
    this.restyle()

    this.limit = remote.limits?.messagesPerSession ?? 0
    this.capabilities = { ...NO_CAPABILITIES, ...(remote.capabilities ?? {}) }
    this.renderActions()
    if (this.behaviour.startMaximized && this.capabilities.maximize) this.maximize(true)
    else if (read(maxKey(this.config.key)) === "1" && this.capabilities.maximize) this.maximize(true)

    if (remote.requiresSignedIdentity && this.config.user?.id && !this.config.user.hash) {
      // eslint-disable-next-line no-console
      console.warn(
        "[askdb] this assistant requires a signed user id — compute " +
          "HMAC_SHA256(secret, user.id) on your server and pass it as user.hash",
      )
    }
  }

  // --------------------------------------------------------------- sending

  send(text: string): void {
    const question = text.trim()
    if (!question || this.destroyed) return
    if (!this.open) this.show()
    if (this.busy) return
    void this.ask(question)
  }

  private async ask(question: string): Promise<void> {
    // Checked here rather than at the server's refusal, so the visitor is told
    // before they type the next one rather than after.
    if (this.limit && this.asked >= this.limit) {
      this.push({
        id: id(),
        role: "assistant",
        text: "This conversation has reached its limit. Reload the page to start a new one.",
        failed: true,
      })
      return
    }
    this.asked += 1
    this.setBusy(true)
    this.el.input.value = ""
    this.autosize()

    this.push({ id: id(), role: "user", text: question })
    this.config.onMessage?.({ role: "user", text: question })

    const reply: ChatMessage = { id: id(), role: "assistant", text: "", pending: true }
    this.push(reply)

    this.abort = new AbortController()
    try {
      if (!this.transport.hasSession()) await this.transport.session(this.config.user)
      await this.consume(question, reply)
    } catch (error) {
      const err = error as WidgetError
      if (err?.kind === "aborted") {
        // The visitor closed the widget or asked something else. Drop the
        // half-written answer rather than leaving a truncated one on screen.
        this.remove(reply)
      } else if (err?.status === 403 && this.transport.hasSession()) {
        // A stale token from a previous visit. Start a new session once and
        // retry — silently, because "your session expired" means nothing to
        // somebody who has been on the page for ten seconds.
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
      this.setBusy(false)
    }
  }

  private async consume(question: string, reply: ChatMessage): Promise<void> {
    const signal = this.abort!.signal
    for await (const event of this.transport.ask(question, signal)) {
      switch (event.type) {
        case "token":
          reply.text += event.text
          reply.activity = undefined
          this.repaint(reply)
          break
        case "tool_start":
          // The label is written server-side for a reader — "Counting orders",
          // not "run_query". Shown because a five-second silence with nothing
          // on screen reads as broken.
          reply.activity = event.label
          this.repaint(reply)
          break
        case "tool_end":
          reply.activity = undefined
          this.repaint(reply)
          break
        case "chart":
          // Collected rather than drawn now: a chart mid-stream would be
          // redrawn on every subsequent token, and `complete` carries the
          // final set anyway.
          reply.charts = [...(reply.charts ?? []), event.config]
          break
        case "complete":
          reply.text = event.fullText || reply.text
          reply.charts = (event.charts as unknown[]) ?? reply.charts
          reply.citations = event.citations ?? []
          reply.followups = (event.followups ?? []).map((f) => f.question).slice(0, 3)
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
    this.repaint(reply)
    if (!reply.failed) this.config.onMessage?.({ role: "assistant", text: reply.text })
  }

  private failMessage(message: ChatMessage, error: Error): void {
    message.pending = false
    message.failed = true
    message.text =
      error instanceof WidgetError
        ? error.message
        : "Something went wrong. Please try again."
    this.repaint(message)
    this.config.onError?.(error)
  }

  private showError(error: Error): void {
    this.push({
      id: id(),
      role: "assistant",
      text: error instanceof WidgetError ? error.message : "Something went wrong.",
      failed: true,
    })
  }

  // ---------------------------------------------------------------- render

  private build(): void {
    const style = document.createElement("style")
    const wrap = document.createElement("div")
    wrap.className = "root"

    wrap.innerHTML = `
      <div class="panel hidden" role="dialog" aria-modal="false" aria-label="Assistant">
        <div class="header">
          <button class="icon menu hidden" type="button" aria-label="Conversations" aria-expanded="false">${MENU}</button>
          <img class="avatar hidden" alt="" />
          <div class="titles">
            <div class="title"></div>
            <div class="subtitle hidden"></div>
          </div>
          <div class="actions"></div>
          <button class="icon close" type="button" aria-label="Close">${CLOSE}</button>
        </div>
        <div class="body">
          <div class="drawer hidden">
            <button class="newthread" type="button">${PLUS}<span>New conversation</span></button>
            <div class="threads"></div>
          </div>
          <div class="log" role="log" aria-live="polite" aria-relevant="additions text"></div>
        </div>
        <div class="composer">
          <div class="field">
            <textarea rows="1" aria-label="Your question"></textarea>
            <button class="send" type="button" aria-label="Send" disabled>${SEND}</button>
          </div>
          <div class="foot"></div>
        </div>
      </div>
      <button class="launcher" type="button" aria-expanded="false" aria-haspopup="dialog"></button>
      <div class="sr" aria-live="assertive"></div>
    `

    this.root.append(style, wrap)

    const q = <T extends Element>(selector: string) => wrap.querySelector(selector) as T
    this.el = {
      style,
      root: wrap,
      launcher: q<HTMLButtonElement>(".launcher"),
      panel: q<HTMLDivElement>(".panel"),
      log: q<HTMLDivElement>(".log"),
      input: q<HTMLTextAreaElement>("textarea"),
      send: q<HTMLButtonElement>(".send"),
      title: q<HTMLDivElement>(".title"),
      subtitle: q<HTMLDivElement>(".subtitle"),
      avatar: q<HTMLImageElement>(".avatar"),
      live: q<HTMLDivElement>(".sr"),
      foot: q<HTMLDivElement>(".foot"),
      actions: q<HTMLDivElement>(".actions"),
      drawer: q<HTMLDivElement>(".drawer"),
      threads: q<HTMLDivElement>(".threads"),
    }

    this.el.launcher.addEventListener("click", () => this.toggle())
    q<HTMLButtonElement>(".close").addEventListener("click", () => this.hide())
    q<HTMLButtonElement>(".menu").addEventListener("click", () => this.toggleDrawer())
    q<HTMLButtonElement>(".newthread").addEventListener("click", () => void this.startThread())
    this.el.send.addEventListener("click", () => this.send(this.el.input.value))

    this.el.input.addEventListener("input", () => {
      this.autosize()
      this.el.send.disabled = this.busy || !this.el.input.value.trim()
    })
    this.el.input.addEventListener("keydown", (event) => {
      // Enter sends, Shift+Enter breaks the line. IME composition is excluded
      // or every Japanese and Chinese visitor sends half a word.
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        this.send(this.el.input.value)
      }
    })

    // Auto-scroll only while the visitor is at the bottom. Yanking them down
    // mid-read is the most irritating thing a streaming panel can do.
    this.el.log.addEventListener("scroll", () => {
      const { scrollTop, scrollHeight, clientHeight } = this.el.log
      this.pinned = scrollHeight - scrollTop - clientHeight < 40
    })

    document.addEventListener("keydown", this.onKeydown, true)
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.open) {
      event.stopPropagation()
      this.hide()
    }
  }

  private onSystemTheme = (): void => this.applyTheme()

  private restyle(): void {
    this.el.style.textContent = stylesheet(this.look)
    this.applyTheme()

    this.el.title.textContent = this.look.title
    this.el.subtitle.textContent = this.look.subtitle
    this.el.subtitle.classList.toggle("hidden", !this.look.subtitle)
    this.el.panel.setAttribute("aria-label", this.look.title)

    if (this.look.avatarUrl) {
      this.el.avatar.src = this.look.avatarUrl
      this.el.avatar.classList.remove("hidden")
    } else {
      this.el.avatar.classList.add("hidden")
    }

    this.el.input.placeholder = this.look.placeholder
    this.el.launcher.innerHTML =
      LAUNCHER_ICONS[this.look.launcherIcon] +
      (this.look.launcherLabel ? `<span>${escapeHtml(this.look.launcherLabel)}</span>` : "")
    this.el.launcher.setAttribute(
      "aria-label",
      this.look.launcherLabel || `Open ${this.look.title}`,
    )
    this.el.launcher.classList.toggle("hidden", this.behaviour.hideLauncher)

    const parts: string[] = []
    if (this.look.disclaimer) parts.push(`<span>${escapeHtml(this.look.disclaimer)}</span>`)
    if (this.look.showBranding) {
      parts.push(
        '<a href="https://askdb.dev" target="_blank" rel="noopener noreferrer">Powered by askdb</a>',
      )
    }
    this.el.foot.innerHTML = parts.join("")
    this.el.foot.classList.toggle("hidden", !parts.length)
  }

  private applyTheme(): void {
    const wanted =
      this.look.theme === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : this.look.theme

    this.host.setAttribute("data-theme", wanted)
    // The attribute is on the host because `:host([data-theme])` is the only
    // selector that can style across the boundary from outside.
    if (this.look.theme === "system" && !this.themeQuery && window.matchMedia) {
      this.themeQuery = window.matchMedia("(prefers-color-scheme: dark)")
      this.themeQuery.addEventListener("change", this.onSystemTheme)
    }
  }

  private greet(): void {
    if (this.look.greeting) {
      this.push({ id: id(), role: "assistant", text: this.look.greeting })
    }
    if (this.look.suggestions.length) this.renderChips(this.look.suggestions)
  }

  private renderChips(questions: string[]): void {
    const chips = document.createElement("div")
    chips.className = "chips"
    for (const question of questions) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "chip"
      chip.textContent = question
      chip.addEventListener("click", () => {
        chips.remove()
        this.send(question)
      })
      chips.appendChild(chip)
    }
    this.el.log.appendChild(chips)
    this.scrollToEnd()
  }

  private push(message: ChatMessage): void {
    this.messages.push(message)
    const row = document.createElement("div")
    row.className = `msg ${message.role}`
    row.dataset["id"] = message.id
    row.innerHTML = `<div class="bubble"></div>`
    this.el.log.appendChild(row)
    this.paint(message, row)
    this.scrollToEnd()
  }

  private repaint(message: ChatMessage): void {
    const row = this.el.log.querySelector(`[data-id="${message.id}"]`)
    if (row) this.paint(message, row as HTMLElement)
    this.scrollToEnd()
  }

  private remove(message: ChatMessage): void {
    this.messages = this.messages.filter((m) => m !== message)
    this.el.log.querySelector(`[data-id="${message.id}"]`)?.remove()
  }

  private paint(message: ChatMessage, row: HTMLElement): void {
    row.className = `msg ${message.role}${message.failed ? " failed" : ""}`
    const bubble = row.querySelector(".bubble") as HTMLElement

    if (message.role === "user") {
      // A visitor's own words are never Markdown — they typed them, and
      // rendering them would turn an innocent asterisk into emphasis.
      bubble.textContent = message.text
      return
    }

    if (!message.text && message.pending) {
      bubble.innerHTML = `<div class="activity"><span class="dots"><i></i><i></i><i></i></span>${
        message.activity ? escapeHtml(message.activity) : "Thinking"
      }</div>`
      return
    }

    bubble.innerHTML =
      render(message.text) +
      (message.pending ? '<span class="caret"></span>' : "") +
      (message.pending ? "" : this.charts(message)) +
      (message.pending ? "" : this.citations(message)) +
      (message.activity
        ? `<div class="activity"><span class="dots"><i></i><i></i><i></i></span>${escapeHtml(message.activity)}</div>`
        : "")

    if (!message.pending && message.followups?.length) {
      // Rendered after the answer, once, so they do not flicker in and out
      // while tokens are still arriving.
      const existing = row.nextElementSibling
      if (!existing?.classList.contains("chips")) this.renderChips(message.followups)
    }
  }


  /** Charts, drawn once the answer has stopped moving. */
  private charts(message: ChatMessage): string {
    if (!this.capabilities.charts || !message.charts?.length) return ""
    return (message.charts as ChartConfig[])
      .map((config) => renderChart(config))
      .join("")
  }

  /**
   * What the answer was based on.
   *
   * Its intent and how many rows it read — enough to judge whether the answer
   * is about the right thing, which is the entire job of a citation. The SQL,
   * the spec and the table names stay behind: they describe the shape of
   * somebody's database to a person who only asked a question about it, and
   * the server does not send them here in the first place.
   */
  private citations(message: ChatMessage): string {
    if (!this.capabilities.citations || !message.citations?.length) return ""
    const rows = message.citations
      .filter((c) => c.intent)
      .map(
        (c) =>
          `<li>${escapeHtml(String(c.intent))}${
            typeof c.row_count === "number"
              ? ` <span class="rows">${c.row_count.toLocaleString()} rows</span>`
              : ""
          }</li>`,
      )
    if (!rows.length) return ""
    return `<details class="cites">
      <summary>Based on ${rows.length} ${rows.length === 1 ? "query" : "queries"}</summary>
      <ul>${rows.join("")}</ul>
    </details>`
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    this.el.input.disabled = busy
    this.el.send.disabled = busy || !this.el.input.value.trim()
    this.el.live.textContent = busy ? "Answering" : ""
  }

  private autosize(): void {
    const input = this.el.input
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }

  private scrollToEnd(force = false): void {
    if (!force && !this.pinned) return
    // After paint, or the height being scrolled to is the previous one.
    requestAnimationFrame(() => {
      this.el.log.scrollTop = this.el.log.scrollHeight
    })
  }
}

// ------------------------------------------------------------------ utils

/** Strip `undefined` so a partial override never blanks a resolved default. */
function clean<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) (out as Record<string, unknown>)[key] = value
  }
  return out
}

function baseUrl(configured?: string): string {
  if (configured) return configured.replace(/\/+$/, "")
  // The origin the script came from. A snippet that has to be told where the
  // API lives is a snippet with one more thing to get wrong, and the answer is
  // already sitting in `document.currentScript`.
  const script = document.currentScript as HTMLScriptElement | null
  const src = script?.src || findScriptSrc()
  if (src) {
    try {
      return new URL(src).origin
    } catch {
      /* fall through */
    }
  }
  return window.location.origin
}

function findScriptSrc(): string | null {
  // `document.currentScript` is null inside an async callback, which is where
  // this runs when the snippet defers.
  const tags = document.querySelectorAll<HTMLScriptElement>("script[src]")
  for (const tag of Array.from(tags)) {
    if (tag.src.includes("askdb")) return tag.src
  }
  return null
}

/** "3 min ago" — a thread list wants recency, not a timestamp. */
function when(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ""
  const seconds = Math.max(0, (Date.now() - then) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

let counter = 0
function id(): string {
  counter += 1
  return `m${counter}`
}

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
    /* a widget that cannot remember still works */
  }
}
