import { Widget } from "./widget"
import type { WidgetApi, WidgetConfig } from "./types"

export type {
  Appearance,
  Behaviour,
  Identity,
  LauncherIcon,
  Position,
  Theme,
  WidgetApi,
  WidgetConfig,
} from "./types"

export const VERSION = "0.1.0"

let current: Widget | null = null

/**
 * Put the assistant on the page.
 *
 * Calling it twice replaces the widget rather than stacking a second one on
 * top of the first. Single-page apps re-run their bootstrap on navigation more
 * often than anyone expects, and two launchers in the same corner is a bug
 * report nobody can describe.
 */
export function init(config: WidgetConfig): void {
  if (!config?.key) {
    // eslint-disable-next-line no-console
    console.error("[askdb] init requires a `key` — copy it from the embed's settings")
    return
  }
  current?.destroy()

  // Waiting for a body to attach to. A snippet in `<head>` without `defer` is
  // a supported way to load this, and it should not be a race.
  ready(() => {
    current = new Widget(config)
  })
}

export function open(): void {
  current?.show()
}

export function close(): void {
  current?.hide()
}

export function toggle(): void {
  current?.toggle()
}

export function send(text: string): void {
  current?.send(text)
}

export function update(config: Partial<WidgetConfig>): void {
  current?.update(config)
}

export function reset(): void {
  current?.reset()
}

export function destroy(): void {
  current?.destroy()
  current = null
}

export function isOpen(): boolean {
  return current?.isOpen() ?? false
}

/** The same surface as the global, for anyone importing the package. */
export const AskDB: WidgetApi = {
  init,
  open,
  close,
  toggle,
  send,
  update,
  reset,
  destroy,
  isOpen,
  version: VERSION,
}

export default AskDB

function ready(callback: () => void): void {
  if (document.body) {
    callback()
    return
  }
  document.addEventListener("DOMContentLoaded", callback, { once: true })
}
