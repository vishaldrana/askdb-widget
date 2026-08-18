import { AskDB, VERSION } from "./index"
import type { WidgetConfig } from "./types"

/**
 * The script-tag build.
 *
 * The snippet installs a stub that queues calls before this file has loaded,
 * so a page can write `askdb('init', {...})` on the line after the `<script>`
 * without caring whether the download has finished. This drains that queue and
 * replaces the stub with the real thing.
 *
 * The queue is why the snippet works at all: the alternative is `onload`
 * handlers in the page, which people forget, or a synchronous script, which
 * blocks a customer's render for our benefit.
 */

type Call = [command: string, ...args: unknown[]]

interface Stub {
  (command: string, ...args: unknown[]): void
  q?: Call[]
}

declare global {
  interface Window {
    askdb?: Stub
    AskDB?: typeof AskDB
    /** Set by the snippet when the config is written inline. */
    askdbSettings?: WidgetConfig
  }
}

const COMMANDS: Record<string, (...args: never[]) => unknown> = {
  init: AskDB.init,
  boot: AskDB.init, // the word Intercom users will reach for first
  open: AskDB.open,
  show: AskDB.open,
  close: AskDB.close,
  hide: AskDB.close,
  toggle: AskDB.toggle,
  send: AskDB.send,
  update: AskDB.update,
  reset: AskDB.reset,
  shutdown: AskDB.destroy,
  destroy: AskDB.destroy,
  maximize: AskDB.maximize,
}

function dispatch(command: string, ...args: unknown[]): unknown {
  const handler = COMMANDS[command]
  if (!handler) {
    // eslint-disable-next-line no-console
    console.warn(`[askdb] unknown command "${command}" — expected one of ${Object.keys(COMMANDS).join(", ")}`)
    return undefined
  }
  return (handler as (...a: unknown[]) => unknown)(...args)
}

const queued = window.askdb?.q ?? []

const api: Stub = (command: string, ...args: unknown[]) => {
  dispatch(command, ...args)
}

window.askdb = api
window.AskDB = AskDB

// `askdbSettings` is the other supported shape: a config object declared
// before the script, the way several widgets do it. Either works; both is
// fine, and the explicit call wins because it is the later statement.
if (window.askdbSettings) AskDB.init(window.askdbSettings)

for (const call of queued) {
  const [command, ...args] = call
  dispatch(command, ...args)
}

export { VERSION }
