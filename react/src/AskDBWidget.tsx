import * as React from "react"

import { Panel } from "./Panel"
import { Shadow, useResolvedTheme } from "./Shadow"
import { useAskDB, type AskDBApi } from "./useAskDB"
import { LAUNCHER_ICONS } from "../../src/icons"
import type { AskDBConfig } from "./config"

export interface AskDBWidgetProps extends AskDBConfig {
  isolate?: boolean
  /** Drive open/closed yourself. Leave unset and the launcher does it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * The launcher in the corner, as a component.
 *
 * Same thing the script tag installs, mounted by React instead — which matters
 * more than it sounds. An app that renders this only for signed-in users, or
 * only on certain routes, or with an accent from the tenant's theme, gets all
 * of that for free from ordinary props and unmounting. Doing the same through
 * a global `askdb('init', …)` means imperative calls in effects and a widget
 * that outlives the route that wanted it.
 */
export function AskDBWidget({
  isolate = true,
  open: controlledOpen,
  onOpenChange,
  ...config
}: AskDBWidgetProps) {
  const api = useAskDB(config)
  const theme = useResolvedTheme(api.look.theme)
  const behaviour = api.behaviour

  const storageKey = `askdb.open.${config.publicKey ?? config.apiKey ?? ""}`
  const [uncontrolled, setUncontrolled] = React.useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : uncontrolled

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolled(next)
      onOpenChange?.(next)
      try {
        window.sessionStorage.setItem(storageKey, next ? "1" : "0")
      } catch {
        /* Safari private mode throws rather than returning null. Not fatal —
           the widget simply forgets across page loads. */
      }
      if (next) {
        config.onOpen?.()
      } else {
        config.onClose?.()
        // Answering into a closed widget wastes the visitor's data and our
        // tokens.
        api.stop()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controlled, onOpenChange, storageKey, api.stop],
  )

  // Restore, or auto-open. Both only once the config has loaded, so a broken
  // key never pops a panel open on somebody's marketing page.
  const restored = React.useRef(false)
  React.useEffect(() => {
    if (api.status !== "ready" || restored.current || controlled) return
    restored.current = true
    let remembered: string | null = null
    try {
      remembered = window.sessionStorage.getItem(storageKey)
    } catch {
      /* as above */
    }
    if (behaviour.rememberState && remembered === "1") setOpen(true)
    else if (behaviour.autoOpen) {
      const timer = window.setTimeout(() => setOpen(true), behaviour.openDelay)
      return () => window.clearTimeout(timer)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.status])

  // The session is created on first open, not on mount. A visitor who never
  // presses the launcher should cost one cached GET — which is what keeps the
  // rate limit meaningful and the conversation count honest.
  React.useEffect(() => {
    if (!open || api.status !== "ready") return
    api.connect()
    api.refreshThreads()
    if (api.messages.length === 0) api.greet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api.status])

  const [maximized, setMaximized] = React.useState(false)
  React.useEffect(() => {
    if (behaviour.startMaximized && api.capabilities.maximize) setMaximized(true)
  }, [behaviour.startMaximized, api.capabilities.maximize])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [open, setOpen])

  // A key that does not work must not leave a broken button on somebody's
  // page. It is logged for the developer and removed for everyone else.
  if (api.status === "failed") {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error(`[askdb] widget disabled: ${api.error?.message ?? "unknown error"}`)
    }
    return null
  }

  return (
    <Shadow
      look={api.look}
      mode="bubble"
      theme={theme}
      isolate={isolate}
      style={{ position: "relative" }}
    >
      <div className={`root${maximized ? " maximized" : ""}`}>
        {open && (
          <PanelHost
            api={api}
            maximized={maximized}
            onClose={() => setOpen(false)}
            onToggleMaximize={() => setMaximized((v) => !v)}
          />
        )}
        {!behaviour.hideLauncher && (
          <button
            className="launcher"
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={api.look.launcherLabel || `Open ${api.look.title}`}
            onClick={() => setOpen(!open)}
          >
            <span dangerouslySetInnerHTML={{ __html: LAUNCHER_ICONS[api.look.launcherIcon] }} />
            {api.look.launcherLabel && <span>{api.look.launcherLabel}</span>}
          </button>
        )}
      </div>
    </Shadow>
  )
}

/**
 * Split out only so the full-screen URL is built where the identity is, rather
 * than threading four values through the widget's own body.
 */
function PanelHost({
  api,
  maximized,
  onClose,
  onToggleMaximize,
}: {
  api: AskDBApi
  maximized: boolean
  onClose: () => void
  onToggleMaximize: () => void
}) {
  const openFullscreen = () => {
    // The identity travels in the URL because the new tab cannot ask the
    // opener for it. Those are the same two values already in this page, so
    // nothing is exposed that was not — but the URL is personal, hence
    // `noopener` and the page saying so.
    const url = new URL(`${api.baseUrl}/embed/chat`)
    url.searchParams.set("key", api.publicKey)
    if (api.identity?.id && api.identity.hash) {
      url.searchParams.set("uid", api.identity.id)
      url.searchParams.set("uh", api.identity.hash)
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer")
  }

  return (
    <Panel
      api={api}
      mode="bubble"
      maximized={maximized}
      autoFocus={api.behaviour.focusOnOpen}
      onClose={onClose}
      onToggleMaximize={onToggleMaximize}
      onOpenFullscreen={openFullscreen}
    />
  )
}
