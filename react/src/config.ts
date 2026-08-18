import type { WidgetConfig } from "../../src/types"

/**
 * The publishable key is called `publicKey` here, and that is not a
 * preference.
 *
 * The wire and the script tag call it `key`, but `key` is reserved by React:
 * `<AskDBChat key="pk_live_..." />` is consumed by the reconciler and never
 * reaches the component at all. The failure is silent and looks like the
 * package is broken — the component renders, asks for a config with no key,
 * and reports a configuration error about a key the developer can see in their
 * own JSX.
 *
 * So the prop is `publicKey`, `apiKey` is accepted because half of everybody
 * will type it, and both are mapped back to `key` before anything reaches the
 * transport.
 */
export interface AskDBConfig extends Omit<WidgetConfig, "key"> {
  /** The publishable key from the embed's settings. Safe to ship in a bundle. */
  publicKey?: string
  /** Accepted alias for `publicKey`. */
  apiKey?: string
}

export function toWidgetConfig(config: AskDBConfig): WidgetConfig {
  const { publicKey, apiKey, ...rest } = config
  return { ...rest, key: publicKey ?? apiKey ?? "" }
}
