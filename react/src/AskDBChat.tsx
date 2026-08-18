import * as React from "react"

import { Panel } from "./Panel"
import { Shadow, useResolvedTheme } from "./Shadow"
import { useAskDB } from "./useAskDB"
import type { AskDBConfig } from "./config"

export interface AskDBChatProps extends AskDBConfig {
  /**
   * Render into a shadow root so the host page's CSS cannot reach in.
   *
   * On by default. Turn it off when the assistant is part of your own product
   * rather than an overlay on it and you want it to inherit your typography —
   * the same rules then apply through a scoping class instead.
   */
  isolate?: boolean
  className?: string
  style?: React.CSSProperties
  /** Focus the composer on mount. Off by default for an inline panel. */
  autoFocus?: boolean
}

/**
 * The assistant as a block in your layout.
 *
 * It fills the box you give it, so the height comes from the parent:
 *
 * ```tsx
 * <div style={{ height: 560 }}>
 *   <AskDBChat publicKey="pk_live_…" apiUrl="https://askdb.example.com"
 *              user={{ id: user.id, hash: user.askdbHash }} />
 * </div>
 * ```
 *
 * There is no launcher and nothing floats — that is `<AskDBWidget/>`. This is
 * for a tab in an admin screen, a panel beside a dashboard, a page of your own
 * app that happens to be a conversation.
 */
export function AskDBChat({
  isolate = true,
  className,
  style,
  autoFocus = false,
  ...config
}: AskDBChatProps) {
  const api = useAskDB(config)
  const theme = useResolvedTheme(api.look.theme)

  // The session is created on mount rather than on first question: unlike the
  // launcher, an inline panel is on screen because somebody navigated to it,
  // so they have already decided to use it.
  React.useEffect(() => {
    if (api.status === "ready") {
      api.connect()
      api.refreshThreads()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.status])

  React.useEffect(() => {
    if (api.status === "ready" && api.messages.length === 0) api.greet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.status])

  if (api.status === "failed") {
    return <FailureNote error={api.error} className={className} style={style} />
  }

  return (
    <Shadow
      look={api.look}
      mode="inline"
      theme={theme}
      isolate={isolate}
      className={className}
      style={{ display: "block", height: "100%", width: "100%", ...style }}
    >
      <div className="root">
        <Panel api={api} mode="inline" autoFocus={autoFocus} />
      </div>
    </Shadow>
  )
}

/**
 * A misconfigured assistant must not be an empty rectangle.
 *
 * The script tag can afford to remove itself and log — its audience is a
 * marketing page's visitors. Here the audience is a developer who just added a
 * component and is looking at the screen, so the reason goes on the screen.
 */
function FailureNote({
  error,
  className,
  style,
}: {
  error: Error | null
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={className}
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px solid #fecaca",
        background: "#fef2f2",
        color: "#991b1b",
        font: "13px/1.5 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
        ...style,
      }}
    >
      <strong>askdb could not start.</strong>
      <div style={{ marginTop: 4 }}>{error?.message ?? "Unknown error."}</div>
    </div>
  )
}
