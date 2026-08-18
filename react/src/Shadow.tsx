import * as React from "react"
import { createPortal } from "react-dom"

import { stylesheet } from "../../src/styles"
import type { Appearance } from "../../src/types"

/**
 * A boundary between the assistant and the page it was dropped into.
 *
 * Every site has a `* { box-sizing: content-box }` somewhere, a `button` reset
 * that strips the cursor, and a `img { width: 100% }` that turns a 32px avatar
 * into a banner. Inheriting any of those makes the assistant look broken in a
 * way its author cannot reproduce, because the bug lives in the host's
 * stylesheet.
 *
 * So by default this renders into a shadow root and nothing crosses either
 * way. `isolate={false}` opts out for callers who *want* their page's
 * typography — a component inside their own design system rather than a
 * visitor-facing widget — and gets the same rules re-anchored to a class.
 */
export function Shadow({
  look,
  mode,
  theme,
  isolate = true,
  className,
  style,
  children,
}: {
  look: Required<Appearance>
  mode: "bubble" | "page" | "inline"
  theme: "light" | "dark"
  isolate?: boolean
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const [root, setRoot] = React.useState<ShadowRoot | null>(null)

  React.useEffect(() => {
    if (!isolate || !hostRef.current || root) return
    // `attachShadow` throws if one is already attached, which happens under
    // React 18's development double-invoke.
    setRoot(hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: "open" }))
  }, [isolate, root])

  const css = React.useMemo(
    () => stylesheet(look, isolate ? ":host" : ".askdb-scope"),
    [look, isolate],
  )

  const attrs = { "data-askdb-widget": "", "data-mode": mode, "data-theme": theme }

  if (!isolate) {
    return (
      <div
        {...attrs}
        className={`askdb-scope${className ? ` ${className}` : ""}`}
        style={style}
      >
        <style>{css}</style>
        {children}
      </div>
    )
  }

  return (
    <div ref={hostRef} {...attrs} className={className} style={style}>
      {root
        ? createPortal(
            <>
              <style>{css}</style>
              {children}
            </>,
            root as unknown as Element,
          )
        : null}
    </div>
  )
}

/** Resolve `system` once and keep it resolved as the OS setting changes. */
export function useResolvedTheme(preference: Appearance["theme"]): "light" | "dark" {
  const [system, setSystem] = React.useState<"light" | "dark">(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  )

  React.useEffect(() => {
    if (preference !== "system" || typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystem(query.matches ? "dark" : "light")
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [preference])

  // Never guessed from the host page's background: reading it is unreliable
  // and gets it wrong on exactly the sites that care.
  return preference === "system" || !preference ? system : preference
}
