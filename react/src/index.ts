/**
 * askdb, for React.
 *
 * Three ways in, in order of how much you want to own:
 *
 * ```tsx
 * <AskDBWidget publicKey="pk_live_…" apiUrl="https://askdb.example.com"
 *              user={{ id, hash }} />               // launcher in the corner
 *
 * <AskDBChat   publicKey="pk_live_…" … />           // a panel in your layout
 *
 * const chat = useAskDB({ publicKey: "pk_live_…" }) // the state, no UI
 * ```
 *
 * The hash is `HMAC_SHA256(embed_secret, user.id)`, computed on your server.
 * The secret never reaches the browser; the key is publishable and may be
 * shipped in your bundle.
 */

export { AskDBChat, type AskDBChatProps } from "./AskDBChat"
export { AskDBWidget, type AskDBWidgetProps } from "./AskDBWidget"
export { useAskDB, type AskDBApi } from "./useAskDB"
export type { AskDBConfig } from "./config"

// The window, and the pieces it is made of. Exported so a product with its own
// design system can keep the parts it likes and replace the rest.
export { Panel } from "./Panel"
export { Shadow, useResolvedTheme } from "./Shadow"
export {
  Charts,
  Citations,
  Composer,
  ICONS,
  Message,
  Suggestions,
  ThreadList,
  Trace,
} from "./parts"

export { WidgetError } from "../../src/api"
export type { ChartConfig, ChartSeries } from "../../src/chart"
export type { EngineState } from "../../src/engine"
export type {
  Appearance,
  Behaviour,
  Capabilities,
  ChatMessage,
  Citation,
  CitationDetail,
  CitationRead,
  Identity,
  LauncherIcon,
  Position,
  Step,
  Theme,
  ThreadSummary,
} from "../../src/types"

export const VERSION = "0.1.0"
