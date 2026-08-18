import * as React from "react"

import { ChatEngine, type EngineState } from "../../src/engine"
import type { WidgetConfig } from "../../src/types"
import { toWidgetConfig, type AskDBConfig } from "./config"

/**
 * The whole assistant, as a hook, with nothing rendered.
 *
 * This is the honest surface of the package. `<AskDBChat/>` is a reasonable
 * chat window and most people will use it, but a product with its own design
 * system does not want our bubbles — it wants the conversation and its own
 * components. Handing those people a component with forty style props is how
 * embedded chat libraries become unmaintainable; handing them the state is
 * how they get what they actually asked for.
 *
 * Everything `<AskDBChat/>` draws, it draws from exactly this.
 */

export interface AskDBApi extends EngineState {
  /** Ask a question. No-op while an answer is streaming. */
  send: (text: string) => void
  /** Abandon the answer in flight, keeping whatever text arrived. */
  stop: () => void
  /** Forget the session and the transcript. */
  reset: () => void
  /** Start a new conversation on the server, keeping the session. */
  newThread: () => void
  openThread: (id: string) => void
  refreshThreads: () => void
  /** Create the session now. Otherwise it happens on the first question. */
  connect: () => void
  /** Show the embed's opening message, if it has one and nothing has been said. */
  greet: () => void
  /** Where this embed lives, for building a full-screen URL. */
  baseUrl: string
  /** The publishable key in play. */
  publicKey: string
  /** The signed identity in play, for building a full-screen URL. */
  identity: WidgetConfig["user"]
}

/**
 * Where askdb is.
 *
 * A React app is bundled and served from the customer's own origin, so unlike
 * the script tag there is no script `src` to infer this from — the widget's
 * trick of reading its own tag has nothing to read. `apiUrl` is therefore
 * effectively required, and saying so early beats a CORS error at runtime.
 */
function resolveBaseUrl(apiUrl?: string): string {
  if (apiUrl) return apiUrl.replace(/\/+$/, "")
  if (typeof window !== "undefined") return window.location.origin
  return ""
}

export function useAskDB(input: AskDBConfig): AskDBApi {
  const config = toWidgetConfig(input)
  const baseUrl = resolveBaseUrl(config.apiUrl)

  // The engine outlives renders and owns its own state; React only subscribes.
  // Rebuilding it when the config object's identity changes — which for most
  // callers is every render — would restart the conversation on every
  // keystroke in the parent.
  const engineRef = React.useRef<ChatEngine | null>(null)
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  const stateRef = React.useRef<EngineState | null>(null)

  // Callbacks are read through a ref so a caller can pass inline arrows —
  // which they will — without that counting as a configuration change.
  const handlers = React.useRef(config)
  handlers.current = config

  if (engineRef.current === null) {
    const engine = new ChatEngine({
      config,
      baseUrl,
      onChange: (next) => {
        stateRef.current = next
        force()
      },
      onMessage: (m) => handlers.current.onMessage?.(m),
      onError: (e) => handlers.current.onError?.(e),
      onReady: () => handlers.current.onReady?.(),
    })
    stateRef.current = engine.current()
    engineRef.current = engine
  }

  const engine = engineRef.current

  React.useEffect(() => {
    engine.attach()
    return () => engine.destroy()
    // Once. A different embed is a different assistant, and remounting on
    // React's own `key` is how to say so; restarting in place would leave the
    // old stream writing into the new conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Configuration that *can* change in place does, without a remount. The
  // serialised comparison is deliberate: `appearance={{accent: brand}}` is a
  // new object every render and a naive dependency would loop forever.
  const identity = JSON.stringify(config.user ?? null)
  const appearance = JSON.stringify(config.appearance ?? null)
  const behaviour = JSON.stringify(config.behaviour ?? config.behavior ?? null)

  React.useEffect(() => {
    engine.update({
      user: config.user,
      appearance: config.appearance,
      behaviour: config.behaviour ?? config.behavior,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, appearance, behaviour])

  const state = stateRef.current ?? engine.current()

  return React.useMemo<AskDBApi>(
    () => ({
      ...state,
      baseUrl,
      publicKey: config.key,
      send: (text) => void engine.send(text),
      stop: () => engine.stop(),
      reset: () => engine.reset(),
      newThread: () => void engine.newThread(),
      openThread: (id) => void engine.openThread(id),
      refreshThreads: () => void engine.loadThreads(),
      connect: () => void engine.openSession(),
      greet: () => engine.greet(),
      identity: engine.identity(),
    }),
    [state, engine, baseUrl, config.key],
  )
}
