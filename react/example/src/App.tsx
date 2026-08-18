import * as React from "react"
import { AskDBChat, AskDBWidget, useAskDB } from "@askdb/react"

import { LOCAL } from "./local"

/**
 * The three ways in, on one page, so a change to any of them is visible
 * immediately rather than at somebody else's integration.
 */
export function App() {
  const [tab, setTab] = React.useState<"inline" | "headless">("inline")

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 96px" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>@askdb/react</h1>
      <p style={{ marginTop: 6, opacity: 0.7 }}>
        The launcher is in the corner — that is <code>&lt;AskDBWidget/&gt;</code>. Below is{" "}
        <code>&lt;AskDBChat/&gt;</code> and a window built by hand from{" "}
        <code>useAskDB()</code>.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "24px 0 12px" }}>
        {(["inline", "headless"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              background: tab === value ? "#111827" : "transparent",
              color: tab === value ? "#fff" : "inherit",
              cursor: "pointer",
              font: "inherit",
              fontSize: 13,
            }}
          >
            {value === "inline" ? "<AskDBChat/>" : "useAskDB()"}
          </button>
        ))}
      </div>

      {tab === "inline" ? (
        <div
          style={{
            height: 560,
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid #e5e7eb",
          }}
        >
          <AskDBChat {...LOCAL} autoFocus />
        </div>
      ) : (
        <Headless />
      )}

      <AskDBWidget
        {...LOCAL}
        appearance={{ launcherLabel: "Ask the data", accent: "#b91c1c" }}
        onMessage={(m) => console.log("[example]", m.role, m.text.slice(0, 60))}
      />
    </div>
  )
}

/**
 * The same conversation with none of our chrome — proof that the hook is a
 * real surface and not a formality wrapped around a component.
 */
function Headless() {
  const chat = useAskDB(LOCAL)
  const [text, setText] = React.useState("")

  React.useEffect(() => {
    if (chat.status === "ready") chat.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status])

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>
        {chat.status} · {chat.capabilities.charts ? "charts" : "no charts"} ·{" "}
        {chat.remaining === null ? "no cap" : `${chat.remaining} left`}
      </div>

      {chat.messages.map((m) => (
        <div key={m.id} style={{ margin: "10px 0" }}>
          <b style={{ fontSize: 12, opacity: 0.6 }}>{m.role}</b>
          <div style={{ whiteSpace: "pre-wrap" }}>
            {m.text || (m.pending ? (m.activity ?? "thinking…") : "")}
          </div>
          {!!m.citations?.length && (
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              based on {m.citations.length} quer{m.citations.length === 1 ? "y" : "ies"}
            </div>
          )}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          chat.send(text)
          setText("")
        }}
        style={{ display: "flex", gap: 8, marginTop: 16 }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask something…"
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            font: "inherit",
          }}
        />
        <button type="submit" disabled={chat.busy} style={{ padding: "8px 14px", font: "inherit" }}>
          {chat.busy ? "…" : "Ask"}
        </button>
        {chat.busy && (
          <button type="button" onClick={chat.stop} style={{ padding: "8px 14px", font: "inherit" }}>
            Stop
          </button>
        )}
      </form>
    </div>
  )
}
