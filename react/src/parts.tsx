import * as React from "react"

import { renderChart, type ChartConfig } from "../../src/chart"
import { formatMs, when } from "../../src/defaults"
import { CLOSE, EXTERNAL, MAXIMIZE, MENU, MINIMIZE, PLUS, SEND } from "../../src/icons"
import { render } from "../../src/markdown"
import type { Capabilities, ChatMessage, Citation, ThreadSummary } from "../../src/types"

/**
 * The pieces the chat window is made of, each exported.
 *
 * They take data and callbacks and nothing else — no context, no engine — so
 * that somebody assembling their own window from `useAskDB` can use the two of
 * these they want and write the rest. That is the difference between a
 * component library and a component.
 */

/** Icon markup comes from the shared set, so both front ends draw one icon. */
function Icon({ svg, ...props }: { svg: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} dangerouslySetInnerHTML={{ __html: svg }} />
}

export const ICONS = { CLOSE, EXTERNAL, MAXIMIZE, MENU, MINIMIZE, PLUS, SEND }

// ------------------------------------------------------------------ message

export function Message({
  message,
  capabilities,
}: {
  message: ChatMessage
  capabilities: Capabilities
}) {
  if (message.role === "user") {
    // A visitor's own words are never Markdown — they typed them, and
    // rendering would turn an innocent asterisk into emphasis.
    return (
      <div className="msg user">
        <div className="bubble">{message.text}</div>
      </div>
    )
  }

  const empty = !message.text && message.pending

  return (
    <div className={`msg assistant${message.failed ? " failed" : ""}`}>
      <div className="bubble">
        {empty ? (
          <Activity label={message.activity ?? "Thinking"} />
        ) : (
          <>
            <Trace message={message} />
            <span dangerouslySetInnerHTML={{ __html: render(message.text) }} />
            {message.pending && <span className="caret" />}
            {!message.pending && capabilities.charts && <Charts charts={message.charts} />}
            {!message.pending && capabilities.citations && (
              <Citations citations={message.citations} />
            )}
            {message.activity && <Activity label={message.activity} />}
          </>
        )}
      </div>
    </div>
  )
}

function Activity({ label }: { label: string }) {
  return (
    <div className="activity">
      <span className="dots">
        <i />
        <i />
        <i />
      </span>
      {label}
    </div>
  )
}

// -------------------------------------------------------------------- trace

/**
 * What it did to get here, above the answer.
 *
 * Collapsed, because a correct answer needs no defence. Expanded it is the
 * same list of steps with the same timings, minus the SQL, which stays gated
 * by role here as it is everywhere else.
 */
export function Trace({ message }: { message: ChatMessage }) {
  const steps = message.steps ?? []
  if (!steps.length && message.elapsedMs === undefined) return null

  const label = message.pending
    ? "Working"
    : message.elapsedMs === undefined
      ? "Processed"
      : `Processed in ${formatMs(message.elapsedMs)}`

  return (
    <details className="trace" open={message.pending}>
      <summary>
        {label}
        {steps.length ? ` · ${steps.length} step${steps.length === 1 ? "" : "s"}` : ""}
      </summary>
      <ol>
        {steps.map((step, i) => (
          <li key={i} className={`step ${step.status ?? ""}`}>
            <span className="what">{step.label || step.name || ""}</span>
            {typeof step.duration_ms === "number" && step.duration_ms > 0 && (
              <span className="took">{formatMs(step.duration_ms)}</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}

// ------------------------------------------------------------------- charts

export function Charts({ charts }: { charts?: unknown[] }) {
  if (!charts?.length) return null
  return (
    <>
      {(charts as ChartConfig[]).map((config, i) => (
        <span key={i} dangerouslySetInnerHTML={{ __html: renderChart(config) }} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- citations

/**
 * What the answer was based on: what the query read, at what grain, filtered
 * how, over what period, how long it took, and whether it was an approved
 * template or written for this question.
 *
 * The SQL is not here. That is a different kind of disclosure and it is gated
 * by role on the main product too.
 */
export function Citations({ citations }: { citations?: Citation[] }) {
  const cites = (citations ?? []).filter((c) => c.intent || c.detail)
  if (!cites.length) return null

  return (
    <details className="cites">
      <summary>
        Based on {cites.length} {cites.length === 1 ? "query" : "queries"}
      </summary>
      <ul>
        {cites.map((c, i) => (
          <li key={c.index ?? i}>
            <div className="head">
              <span className="what">{String(c.intent || "Query")}</span>
              {c.trust === "verified" ? (
                <span className="tag ok">
                  approved{c.saved_query_name ? ` · ${c.saved_query_name}` : ""}
                </span>
              ) : (
                <span className="tag">written for this question</span>
              )}
            </div>
            {!!meta(c).length && <div className="meta">{meta(c).join(" · ")}</div>}
            <Facts citation={c} />
          </li>
        ))}
      </ul>
    </details>
  )
}

function meta(c: Citation): string[] {
  const out: string[] = []
  if (typeof c.row_count === "number") {
    out.push(`${c.row_count.toLocaleString()} row${c.row_count === 1 ? "" : "s"}`)
  }
  if (c.truncated) out.push("truncated")
  if (typeof c.duration_ms === "number") out.push(formatMs(c.duration_ms))
  return out
}

function Facts({ citation }: { citation: Citation }) {
  const d = citation.detail
  const rows: Array<[string, React.ReactNode]> = []

  if (d?.reads?.length) {
    // Each read is a table plus how it was brought in — the base table, or a
    // join and what it does to unmatched rows. That last part is the
    // difference between a count of applications and a count of applications
    // that happen to have a borrower row.
    rows.push([
      "Reads",
      d.reads.map((r) => (r.role && r.role !== "base" ? `${r.table} (${r.role})` : r.table)).join(", "),
    ])
  }
  // The grain arrives as a whole sentence — "one row per status" — so the
  // label heads it rather than starting it.
  if (d?.grain) rows.push(["Grain", d.grain])
  if (d?.measures?.length) {
    rows.push(["Measures", d.measures.map((m) => `${m.label} = ${m.of}`).join(", ")])
  }
  if (d?.period) rows.push(["Period", d.period])
  if (d?.filters?.length) rows.push(["Filtered", d.filters.join("; ")])
  if (d?.ordering?.length) rows.push(["Ordered by", d.ordering.join(", ")])
  if (typeof d?.limit === "number") rows.push(["Capped at", `${d.limit} rows`])
  if (citation.columns?.length) rows.push(["Returned", citation.columns.join(", ")])
  // Last and labelled, because it is the model's account of its own work — the
  // one line here that cannot be checked against the database.
  if (citation.reasoning) rows.push(["Why", <i key="w">{citation.reasoning}</i>])

  if (!rows.length) return null
  return (
    <div className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <b>{label}</b> {value}
        </div>
      ))}
    </div>
  )
}

// --------------------------------------------------------------- followups

export function Suggestions({
  questions,
  onPick,
}: {
  questions: string[]
  onPick: (question: string) => void
}) {
  if (!questions.length) return null
  return (
    <div className="chips">
      {questions.map((question) => (
        <button key={question} type="button" className="chip" onClick={() => onPick(question)}>
          {question}
        </button>
      ))}
    </div>
  )
}

// ----------------------------------------------------------------- threads

export function ThreadList({
  threads,
  currentId,
  onOpen,
  onNew,
}: {
  threads: ThreadSummary[]
  currentId: string | null
  onOpen: (id: string) => void
  onNew: () => void
}) {
  return (
    <>
      <button className="newthread" type="button" onClick={onNew}>
        <Icon svg={PLUS} />
        <span>New conversation</span>
      </button>
      <div className="threads">
        {threads.length === 0 ? (
          <p className="empty">No past conversations yet.</p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`thread${thread.id === currentId ? " active" : ""}`}
              onClick={() => onOpen(thread.id)}
            >
              <span className="t">{thread.title}</span>
              <span className="w">{when(thread.updated_at)}</span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- composer

export function Composer({
  placeholder,
  disabled,
  busy,
  autoFocus,
  onSend,
  onStop,
  footer,
}: {
  placeholder: string
  disabled?: boolean
  busy?: boolean
  autoFocus?: boolean
  onSend: (text: string) => void
  onStop?: () => void
  /** The disclaimer and branding line, which lives inside the composer box. */
  footer?: React.ReactNode
}) {
  const [text, setText] = React.useState("")
  const ref = React.useRef<HTMLTextAreaElement>(null)

  // Grow with the content up to a cap, then scroll. A fixed one-line box makes
  // people submit half a question rather than scroll back to check it.
  React.useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [text])

  React.useEffect(() => {
    if (autoFocus && typeof window !== "undefined" && window.innerWidth > 480) {
      // Skipped on small screens: taking focus summons the on-screen keyboard
      // over the greeting the visitor came to read.
      const timer = window.setTimeout(() => ref.current?.focus(), 60)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [autoFocus])

  const submit = () => {
    const question = text.trim()
    if (!question || busy) return
    setText("")
    onSend(question)
  }

  return (
    <div className="composer">
      <div className="field">
        <textarea
          ref={ref}
          rows={1}
          aria-label="Your question"
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. IME composition is
            // excluded or every Japanese and Chinese visitor sends half a word.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {busy && onStop ? (
          <button className="send" type="button" aria-label="Stop" onClick={onStop}>
            <span className="stop" />
          </button>
        ) : (
          <button
            className="send"
            type="button"
            aria-label="Send"
            disabled={!text.trim() || busy}
            onClick={submit}
            dangerouslySetInnerHTML={{ __html: SEND }}
          />
        )}
      </div>
      {footer ? <div className="foot">{footer}</div> : null}
    </div>
  )
}

export { Icon }
