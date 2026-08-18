import { WidgetError } from "./api"
import { renderChart, type ChartConfig } from "./chart"
import { formatMs, when } from "./defaults"
import { ChatEngine, type EngineState } from "./engine"
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
import type { Appearance, Capabilities, ChatMessage, ThreadSummary, WidgetConfig } from "./types"

/**
 * The widget: a view over `ChatEngine`, and nothing else.
 *
 * It is rendered into a shadow root attached to a `<div>` appended to
 * `<body>`, for one reason: the host page's CSS must not reach it and its CSS
 * must not reach the host page. Every site has a `* { box-sizing }` rule and a
 * `button` reset, and inheriting either is how an embedded widget ends up
 * looking broken in a way its author cannot reproduce.
 *
 * Everything that is not drawing — the session, the stream, threads, the
 * message cap — lives in the engine, which the React package uses too. This
 * class used to own all of it, and keeping that arrangement would have meant
 * two copies of the SSE reducer and the stale-token retry, fixed twice
 * forever.
 *
 * The DOM is built once and mutated afterwards. Re-rendering the message list
 * on every token would lose the visitor's text selection and reset the scroll
 * position mid-answer, which are the two things people actually do while an
 * answer is arriving — so `sync` diffs the engine's state against what is on
 * screen and touches only what changed.
 */

// Per key, for the same reason the session token is: two embeds on one origin
// must not share their remembered state.
const openKey = (key: string) => `askdb.open.${key}`
const maxKey = (key: string) => `askdb.max.${key}`

export class Widget {
  private host: HTMLDivElement
  private root: ShadowRoot
  private engine: ChatEngine
  private config: WidgetConfig

  /** The last state the engine reported. Read by every render path. */
  private state: EngineState

  private open = false
  private destroyed = false
  private themeQuery: MediaQueryList | null = null
  private maximized = false
  private drawerOpen = false
  /** Suppresses auto-scroll while the visitor is reading further up. */
  private pinned = true

  /**
   * What is on screen, by message id, with a signature of what was drawn.
   *
   * The engine mutates a streaming message in place and bumps the array's
   * identity, so "has this changed" cannot be an identity check. The signature
   * is every field the bubble reads; comparing it is one string compare per
   * message per token, which is nothing beside the paint it avoids.
   */
  private rendered = new Map<string, { row: HTMLElement; signature: string }>()
  private chips: HTMLDivElement | null = null

  /** Previous values, so a repaint only happens when its input moved. */
  private paintedLook: Required<Appearance> | null = null
  private paintedCapabilities: Capabilities | null = null
  private paintedThreads: ThreadSummary[] | null = null
  private paintedBusy: boolean | null = null

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

    this.engine = new ChatEngine({
      config,
      baseUrl: this.baseUrl,
      onChange: (state) => this.sync(state),
    })
    this.state = this.engine.current()

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
    // Config first, and rendered before any session is created: a visitor who
    // never opens the widget should cost nothing but one cached GET.
    await this.engine.start()
    if (this.destroyed) return

    if (this.state.status === "failed") {
      // A misconfigured key must not leave a broken button on somebody's
      // marketing page. Remove ourselves and tell the developer why.
      this.fail(this.state.error ?? new Error("could not start"))
      return
    }

    // Page mode *is* the widget: there is no launcher to press and nothing
    // else on the page to go back to.
    if (this.mode === "page") this.show()
    else if (this.state.behaviour.rememberState && read(openKey(this.config.key)) === "1") {
      this.show()
    } else if (this.state.behaviour.autoOpen) {
      window.setTimeout(() => this.show(), this.state.behaviour.openDelay)
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
    this.engine.destroy()
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
    void this.engine.openSession()
    this.engine.greet()

    // Focus is deliberately skipped on small screens: taking it summons the
    // on-screen keyboard over the greeting the visitor came to read.
    if (this.state.behaviour.focusOnOpen && window.innerWidth > 480) {
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
    this.engine.stop()
    this.el.launcher.focus()
  }

  toggle(): void {
    this.open ? this.hide() : this.show()
  }

  reset(): void {
    this.engine.reset()
    if (this.open) {
      void this.engine.openSession()
      this.engine.greet()
    }
  }

  update(patch: Partial<WidgetConfig>): void {
    this.config = { ...this.config, ...patch }
    this.engine.update(patch)
  }

  // ------------------------------------------------------------------ size

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
    if (!this.state.capabilities.maximize || this.mode === "page") return
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
    if (!this.state.capabilities.threads) return
    this.drawerOpen = open
    this.el.drawer.classList.toggle("hidden", !open)
    this.el.root.querySelector(".menu")?.setAttribute("aria-expanded", String(open))
    if (open) {
      this.paintThreads(this.state.threads)
      void this.engine.loadThreads()
    }
  }

  private paintThreads(threads: ThreadSummary[]): void {
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
      row.className = `thread${thread.id === this.state.threadId ? " active" : ""}`
      row.innerHTML =
        `<span class="t">${escapeHtml(thread.title)}</span>` +
        `<span class="w">${escapeHtml(when(thread.updated_at))}</span>`
      row.addEventListener("click", () => {
        void this.engine.openThread(thread.id)
        this.toggleDrawer(false)
      })
      this.el.threads.appendChild(row)
    }
  }

  /** The header's right-hand controls, rebuilt when capabilities change. */
  private renderActions(): void {
    const capabilities = this.state.capabilities
    const buttons: string[] = []
    if (this.mode !== "page" && capabilities.maximize) {
      const label = this.maximized ? "Restore" : "Maximize"
      buttons.push(
        `<button class="icon act-max" type="button" aria-label="${label}" title="${label}">${
          this.maximized ? MINIMIZE : MAXIMIZE
        }</button>`,
      )
    }
    if (this.mode !== "page" && capabilities.fullscreen) {
      buttons.push(
        `<button class="icon act-tab" type="button" aria-label="Open in a new tab" title="Open in a new tab">${EXTERNAL}</button>`,
      )
    }
    this.el.actions.innerHTML = buttons.join("")
    this.el.actions.querySelector(".act-max")?.addEventListener("click", () => this.maximize())
    this.el.actions
      .querySelector(".act-tab")
      ?.addEventListener("click", () => this.openFullscreen())

    const menu = this.el.root.querySelector(".menu") as HTMLElement | null
    menu?.classList.toggle("hidden", !capabilities.threads)
  }

  // --------------------------------------------------------------- sending

  send(text: string): void {
    const question = text.trim()
    if (!question || this.destroyed) return
    if (!this.open) this.show()
    this.el.input.value = ""
    this.autosize()
    void this.engine.send(question)
  }

  // ---------------------------------------------------------------- render

  /**
   * Bring the DOM into line with the engine's state.
   *
   * Every branch is guarded by "did this actually change", because this runs
   * once per streamed token and most of it has not.
   */
  private sync(state: EngineState): void {
    if (this.destroyed) return
    this.state = state

    if (state.status === "failed" && state.error) {
      this.fail(state.error)
      return
    }

    if (state.look !== this.paintedLook) {
      this.paintedLook = state.look
      this.restyle()
    }

    if (state.capabilities !== this.paintedCapabilities) {
      const first = this.paintedCapabilities === null
      this.paintedCapabilities = state.capabilities
      this.renderActions()
      if (first && state.capabilities.maximize) {
        if (state.behaviour.startMaximized || read(maxKey(this.config.key)) === "1") {
          this.maximize(true)
        }
      }
    }

    if (state.threads !== this.paintedThreads) {
      this.paintedThreads = state.threads
      if (this.drawerOpen) this.paintThreads(state.threads)
    }

    if (state.busy !== this.paintedBusy) {
      this.paintedBusy = state.busy
      this.setBusy(state.busy)
    }

    this.syncMessages(state.messages)
  }

  private syncMessages(messages: ChatMessage[]): void {
    const seen = new Set<string>()
    let moved = false

    for (const message of messages) {
      seen.add(message.id)
      const signature = signatureOf(message)
      const existing = this.rendered.get(message.id)

      if (!existing) {
        const row = document.createElement("div")
        row.className = `msg ${message.role}`
        row.dataset["id"] = message.id
        row.innerHTML = `<div class="bubble"></div>`
        this.el.log.appendChild(row)
        this.paint(message, row)
        this.rendered.set(message.id, { row, signature })
        moved = true
      } else if (existing.signature !== signature) {
        this.paint(message, existing.row)
        existing.signature = signature
        moved = true
      }
    }

    // Opening a past conversation replaces the whole transcript, so anything
    // left over belongs to the one before it.
    for (const [id, entry] of this.rendered) {
      if (!seen.has(id)) {
        entry.row.remove()
        this.rendered.delete(id)
        moved = true
      }
    }

    this.renderChips(messages)
    if (moved) this.scrollToEnd()
  }

  /**
   * The one row of buttons under the conversation.
   *
   * Followups belong to the finished answer at the end of the transcript, and
   * the greeting's suggestions stand in until there is one. Both are the same
   * element, rebuilt — an earlier version appended a fresh row after each
   * answer, which left a trail of stale suggestions up the transcript.
   */
  private renderChips(messages: ChatMessage[]): void {
    const last = messages[messages.length - 1]
    const followups = last && !last.pending && !last.failed ? (last.followups ?? []) : []
    const opening = messages.length <= 1 && !this.state.busy ? this.state.look.suggestions : []
    const questions = followups.length ? followups : opening

    if (!questions.length) {
      this.chips?.remove()
      this.chips = null
      return
    }
    if (this.chips && this.chips.dataset["for"] === questions.join(" ")) {
      // Already showing exactly these. Rebuilding would restart the fade and
      // steal the click of anyone reaching for one.
      this.el.log.appendChild(this.chips)
      return
    }

    const chips = document.createElement("div")
    chips.className = "chips"
    chips.dataset["for"] = questions.join(" ")
    for (const question of questions) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "chip"
      chip.textContent = question
      chip.addEventListener("click", () => this.send(question))
      chips.appendChild(chip)
    }
    this.chips?.remove()
    this.chips = chips
    this.el.log.appendChild(chips)
  }

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
    q<HTMLButtonElement>(".newthread").addEventListener("click", () => {
      void this.engine.newThread()
      this.toggleDrawer(false)
    })
    this.el.send.addEventListener("click", () => {
      if (this.state.busy) this.engine.stop()
      else this.send(this.el.input.value)
    })

    this.el.input.addEventListener("input", () => {
      this.autosize()
      this.el.send.disabled = this.state.busy ? false : !this.el.input.value.trim()
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
    this.restyle()
  }

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.open) {
      event.stopPropagation()
      this.hide()
    }
  }

  private onSystemTheme = (): void => this.applyTheme()

  private restyle(): void {
    const look = this.state.look
    this.el.style.textContent = stylesheet(look)
    this.applyTheme()

    this.el.title.textContent = look.title || this.state.name
    this.el.subtitle.textContent = look.subtitle
    this.el.subtitle.classList.toggle("hidden", !look.subtitle)
    this.el.panel.setAttribute("aria-label", look.title)

    if (look.avatarUrl) {
      this.el.avatar.src = look.avatarUrl
      this.el.avatar.classList.remove("hidden")
    } else {
      this.el.avatar.classList.add("hidden")
    }

    this.el.input.placeholder = look.placeholder
    this.el.launcher.innerHTML =
      LAUNCHER_ICONS[look.launcherIcon] +
      (look.launcherLabel ? `<span>${escapeHtml(look.launcherLabel)}</span>` : "")
    this.el.launcher.setAttribute("aria-label", look.launcherLabel || `Open ${look.title}`)
    this.el.launcher.classList.toggle("hidden", this.state.behaviour.hideLauncher)

    const parts: string[] = []
    if (look.disclaimer) parts.push(`<span>${escapeHtml(look.disclaimer)}</span>`)
    if (look.showBranding) {
      parts.push(
        '<a href="https://askdb.dev" target="_blank" rel="noopener noreferrer">Powered by askdb</a>',
      )
    }
    this.el.foot.innerHTML = parts.join("")
    this.el.foot.classList.toggle("hidden", !parts.length)
  }

  private applyTheme(): void {
    const preference = this.state.look.theme
    const wanted =
      preference === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preference

    this.host.setAttribute("data-theme", wanted)
    // The attribute is on the host because `:host([data-theme])` is the only
    // selector that can style across the boundary from outside.
    if (preference === "system" && !this.themeQuery && window.matchMedia) {
      this.themeQuery = window.matchMedia("(prefers-color-scheme: dark)")
      this.themeQuery.addEventListener("change", this.onSystemTheme)
    }
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
      bubble.innerHTML = activityRow(message.activity ?? "Thinking")
      return
    }

    bubble.innerHTML =
      this.trace(message) +
      render(message.text) +
      (message.pending ? '<span class="caret"></span>' : "") +
      (message.pending ? "" : this.charts(message)) +
      (message.pending ? "" : this.citations(message)) +
      (message.activity ? activityRow(message.activity) : "")
  }

  /** Charts, drawn once the answer has stopped moving. */
  private charts(message: ChatMessage): string {
    if (!this.state.capabilities.charts || !message.charts?.length) return ""
    return (message.charts as ChartConfig[]).map((config) => renderChart(config)).join("")
  }

  /**
   * What it did to get here, above the answer.
   *
   * Collapsed, because a correct answer needs no defence. Expanded it is the
   * same list of steps with the same timings, minus the SQL, which stays gated
   * by role here as it is everywhere else.
   */
  private trace(message: ChatMessage): string {
    const steps = message.steps ?? []
    if (!steps.length && message.elapsedMs === undefined) return ""

    const label = message.pending
      ? "Working"
      : message.elapsedMs === undefined
        ? "Processed"
        : `Processed in ${formatMs(message.elapsedMs)}`
    const count = steps.length ? ` · ${steps.length} step${steps.length === 1 ? "" : "s"}` : ""

    const rows = steps
      .map(
        (step) =>
          `<li class="step ${step.status ?? ""}">
            <span class="what">${escapeHtml(step.label || step.name || "")}</span>
            ${
              typeof step.duration_ms === "number" && step.duration_ms > 0
                ? `<span class="took">${formatMs(step.duration_ms)}</span>`
                : ""
            }
          </li>`,
      )
      .join("")

    return `<details class="trace"${message.pending ? " open" : ""}>
      <summary>${escapeHtml(label)}${count}</summary>
      <ol>${rows}</ol>
    </details>`
  }

  /**
   * What the answer was based on.
   *
   * This used to be one line per query — its intent and a row count — on the
   * reasoning that the shape of somebody's database is not a website visitor's
   * business. That reasoning does not survive the embed requiring a signed
   * identity: the reader is the site owner's own customer, asking about their
   * own data, through a role that already decides what they may see. Leaving
   * them a number with nothing behind it does not protect anybody; it just
   * makes the answer unverifiable, which is the one thing a citation exists to
   * prevent.
   *
   * So it now says what the query read, at what grain, filtered how, over what
   * period, how long it took, and whether it was an approved template or
   * written for this question. The SQL is still not here — that is a different
   * kind of disclosure, and it is gated by role on the main site too.
   */
  private citations(message: ChatMessage): string {
    if (!this.state.capabilities.citations || !message.citations?.length) return ""
    const cites = message.citations.filter((c) => c.intent || c.detail)
    if (!cites.length) return ""

    const rows = cites.map((c) => {
      const facts: string[] = []
      const detail = c.detail

      if (detail?.reads?.length) {
        // Each read is a table plus how it was brought in — the base table, or
        // a join and what it does to unmatched rows. That last part is the
        // difference between a count of applications and a count of
        // applications that happen to have a borrower row.
        const reads = detail.reads.map((r) =>
          r.role && r.role !== "base" ? `${r.table} (${r.role})` : r.table,
        )
        facts.push(`<b>Reads</b> ${escapeHtml(reads.join(", "))}`)
      }
      // The grain arrives as a whole sentence — "one row per status" — so the
      // label is a heading for it rather than the first half of it. Prefixing
      // "One row per" produced "One row per one row per status".
      if (detail?.grain) facts.push(`<b>Grain</b> ${escapeHtml(detail.grain)}`)
      if (detail?.measures?.length) {
        facts.push(
          `<b>Measures</b> ${escapeHtml(
            detail.measures.map((m) => `${m.label} = ${m.of}`).join(", "),
          )}`,
        )
      }
      if (detail?.period) facts.push(`<b>Period</b> ${escapeHtml(detail.period)}`)
      if (detail?.filters?.length) {
        facts.push(`<b>Filtered</b> ${escapeHtml(detail.filters.join("; "))}`)
      }
      if (detail?.ordering?.length) {
        facts.push(`<b>Ordered by</b> ${escapeHtml(detail.ordering.join(", "))}`)
      }
      if (typeof detail?.limit === "number") facts.push(`<b>Capped at</b> ${detail.limit} rows`)
      if (c.columns?.length) facts.push(`<b>Returned</b> ${escapeHtml(c.columns.join(", "))}`)

      // Kept last and labelled, because it is the model's account of its own
      // work — the one line here that cannot be checked against the database.
      if (c.reasoning) facts.push(`<b>Why</b> <i>${escapeHtml(c.reasoning)}</i>`)

      const meta: string[] = []
      if (typeof c.row_count === "number") {
        meta.push(`${c.row_count.toLocaleString()} row${c.row_count === 1 ? "" : "s"}`)
      }
      if (c.truncated) meta.push("truncated")
      if (typeof c.duration_ms === "number") meta.push(formatMs(c.duration_ms))

      // "Approved template" versus "written for this question" is the most
      // useful thing a citation says about how far to trust a number, and it
      // was previously sent and then never shown.
      const badge =
        c.trust === "verified"
          ? `<span class="tag ok">approved${
              c.saved_query_name ? ` · ${escapeHtml(c.saved_query_name)}` : ""
            }</span>`
          : `<span class="tag">written for this question</span>`

      return `<li>
        <div class="head">
          <span class="what">${escapeHtml(String(c.intent || "Query"))}</span>
          ${badge}
        </div>
        ${meta.length ? `<div class="meta">${escapeHtml(meta.join(" · "))}</div>` : ""}
        ${facts.length ? `<div class="facts">${facts.map((f) => `<div>${f}</div>`).join("")}</div>` : ""}
      </li>`
    })

    return `<details class="cites">
      <summary>Based on ${rows.length} ${rows.length === 1 ? "query" : "queries"}</summary>
      <ul>${rows.join("")}</ul>
    </details>`
  }

  private setBusy(busy: boolean): void {
    this.el.input.disabled = busy
    // While an answer is streaming the button stops it rather than going grey:
    // an answer that has gone wrong is one a visitor should be able to end.
    this.el.send.innerHTML = busy ? '<span class="stop"></span>' : SEND
    this.el.send.setAttribute("aria-label", busy ? "Stop" : "Send")
    this.el.send.disabled = busy ? false : !this.el.input.value.trim()
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

/** Everything the bubble reads, so "has this changed" is one comparison. */
function signatureOf(message: ChatMessage): string {
  return [
    message.text,
    message.pending ? "1" : "",
    message.failed ? "1" : "",
    message.activity ?? "",
    message.steps?.map((s) => `${s.name}:${s.status}:${s.duration_ms ?? ""}`).join(",") ?? "",
    message.charts?.length ?? 0,
    message.citations?.length ?? 0,
    message.elapsedMs ?? "",
  ].join(" ")
}

function activityRow(label: string): string {
  return `<div class="activity"><span class="dots"><i></i><i></i><i></i></span>${escapeHtml(
    label,
  )}</div>`
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
