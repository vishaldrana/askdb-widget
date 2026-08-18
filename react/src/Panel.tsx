import * as React from "react"

import type { AskDBApi } from "./useAskDB"
import { Composer, ICONS, Icon, Message, Suggestions, ThreadList } from "./parts"

/**
 * The conversation itself: header, drawer, transcript, composer.
 *
 * Shared by every mode. `AskDBChat` puts it in a box on the page, `AskDBWidget`
 * puts it in a launcher's popover, and page mode fills a tab — the difference
 * between the three is a `data-mode` attribute and where the wrapper sits, not
 * three implementations of a chat window.
 */
export function Panel({
  api,
  mode,
  maximized,
  onClose,
  onToggleMaximize,
  onOpenFullscreen,
  autoFocus,
}: {
  api: AskDBApi
  mode: "bubble" | "page" | "inline"
  /** Only read for the header's restore/maximize label; the class is the caller's. */
  maximized?: boolean
  onClose?: () => void
  onToggleMaximize?: () => void
  onOpenFullscreen?: () => void
  autoFocus?: boolean
}) {
  const { look, capabilities, messages, busy, threads, threadId } = api
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const logRef = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)

  // Auto-scroll only while the reader is at the bottom. Yanking somebody down
  // mid-read is the most irritating thing a streaming panel can do.
  React.useEffect(() => {
    const log = logRef.current
    if (!log || !pinned.current) return
    log.scrollTop = log.scrollHeight
  }, [messages])

  const openDrawer = (open: boolean) => {
    setDrawerOpen(open)
    if (open) api.refreshThreads()
  }

  const last = messages[messages.length - 1]
  // Followups belong to the finished answer at the end of the transcript. Shown
  // there rather than under each message, because a chip under an answer three
  // questions ago is an invitation to lose your place.
  const followups = last && !last.pending && !last.failed ? (last.followups ?? []) : []
  // The greeting's suggestions stand in until there is something to follow up.
  const opening = messages.length <= 1 && !busy ? look.suggestions : []
  const chips = followups.length ? followups : opening

  return (
    <>
      <div className="panel" role="dialog" aria-modal="false" aria-label={look.title}>
        <div className="header">
          {capabilities.threads && (
            <button
              className="icon menu"
              type="button"
              aria-label="Conversations"
              aria-expanded={drawerOpen}
              onClick={() => openDrawer(!drawerOpen)}
              dangerouslySetInnerHTML={{ __html: ICONS.MENU }}
            />
          )}
          {look.avatarUrl && <img className="avatar" alt="" src={look.avatarUrl} />}
          <div className="titles">
            <div className="title">{look.title || api.name}</div>
            {look.subtitle && <div className="subtitle">{look.subtitle}</div>}
          </div>
          <div className="actions">
            {mode === "bubble" && capabilities.maximize && onToggleMaximize && (
              <button
                className="icon act-max"
                type="button"
                aria-label={maximized ? "Restore" : "Maximize"}
                title={maximized ? "Restore" : "Maximize"}
                onClick={onToggleMaximize}
                dangerouslySetInnerHTML={{ __html: maximized ? ICONS.MINIMIZE : ICONS.MAXIMIZE }}
              />
            )}
            {mode !== "page" && capabilities.fullscreen && onOpenFullscreen && (
              <button
                className="icon act-tab"
                type="button"
                aria-label="Open in a new tab"
                title="Open in a new tab"
                onClick={onOpenFullscreen}
                dangerouslySetInnerHTML={{ __html: ICONS.EXTERNAL }}
              />
            )}
          </div>
          {onClose && (
            <button
              className="icon close"
              type="button"
              aria-label="Close"
              onClick={onClose}
              dangerouslySetInnerHTML={{ __html: ICONS.CLOSE }}
            />
          )}
        </div>

        <div className="body">
          {capabilities.threads && (
            <div className={`drawer${drawerOpen ? "" : " hidden"}`}>
              <ThreadList
                threads={threads}
                currentId={threadId}
                onOpen={(id) => {
                  api.openThread(id)
                  openDrawer(false)
                }}
                onNew={() => {
                  api.newThread()
                  openDrawer(false)
                }}
              />
            </div>
          )}

          <div
            className="log"
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={(e) => {
              const el = e.currentTarget
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
            {messages.map((message) => (
              <Message key={message.id} message={message} capabilities={capabilities} />
            ))}
            <Suggestions questions={chips} onPick={api.send} />
          </div>
        </div>

        <Composer
          placeholder={look.placeholder}
          busy={busy}
          autoFocus={autoFocus}
          onSend={api.send}
          onStop={api.stop}
          footer={
            look.disclaimer || look.showBranding ? (
              <>
                {look.disclaimer && <span>{look.disclaimer}</span>}
                {look.showBranding && (
                  <a href="https://askdb.dev" target="_blank" rel="noopener noreferrer">
                    Powered by askdb
                  </a>
                )}
              </>
            ) : null
          }
        />
      </div>
      <div className="sr" aria-live="assertive">
        {busy ? "Answering" : ""}
      </div>
    </>
  )
}

export { Icon }
