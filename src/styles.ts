import type { Appearance } from "./types"

/**
 * The widget's stylesheet, built from the resolved appearance.
 *
 * It lives inside a shadow root, so none of it escapes and nothing on the host
 * page reaches in — which is the entire reason for the shadow root. Sites have
 * `* { box-sizing: content-box }`, `img { width: 100% }` and a `button` reset
 * that removes the cursor, and a widget that inherits any of those looks
 * broken in a way its author can never reproduce.
 *
 * Everything is a custom property so `update()` can restyle a live widget by
 * setting variables rather than regenerating and re-parsing the sheet.
 *
 * One rule for anyone editing below: **no backticks inside the returned
 * template literal**, comments included. A backtick ends the literal, and the
 * error you get points at whatever happens to parse badly forty lines later.
 */
export function stylesheet(look: Required<Appearance>, scope = ":host"): string {
  const sheet = sheetFor(look)
  // The React package can render without a shadow root, for callers who want
  // the assistant to inherit their own page rather than be walled off from it.
  // Same rules, re-anchored: `:host(...)` becomes `.askdb(...)`, which is a
  // valid compound selector on the wrapper element.
  return scope === ":host"
    ? sheet
    : sheet.replace(/:host\(([^)]*)\)/g, `${scope}$1`).replace(/:host/g, scope)
}

function sheetFor(look: Required<Appearance>): string {
  return `
:host {
  --accent: ${look.accent};
  --accent-fg: ${look.accentForeground};
  --radius: ${look.radius}px;
  --offset: ${look.offset}px;
  --z: ${look.zIndex};

  --bg: #ffffff;
  --fg: #111827;
  --muted: #6b7280;
  --line: #e5e7eb;
  --surface: #f9fafb;
  --shadow: 0 12px 40px -8px rgb(0 0 0 / 0.18), 0 4px 12px -4px rgb(0 0 0 / 0.1);

  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* Dark is opt-in or system, never guessed from the host page — reading its
   background is unreliable and gets it wrong on exactly the sites that care. */
:host([data-theme="dark"]) {
  --bg: #0b0f17;
  --fg: #f3f4f6;
  --muted: #9ca3af;
  --line: #1f2937;
  --surface: #111827;
  --shadow: 0 12px 40px -8px rgb(0 0 0 / 0.6);
}

*, *::before, *::after { box-sizing: border-box; }

button {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
  margin: 0;
}

.root {
  position: fixed;
  ${"" /* Both corners are set and one is cleared, so `update()` can move it. */}
  bottom: var(--offset);
  ${look.position === "left" ? "left" : "right"}: var(--offset);
  z-index: var(--z);
  display: flex;
  flex-direction: column;
  align-items: ${look.position === "left" ? "flex-start" : "flex-end"};
  gap: 12px;
}

/* ------------------------------------------------------------- launcher */

.launcher {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  min-width: 52px;
  padding: 0 ${look.launcherLabel ? "18px" : "0"};
  ${look.launcherLabel ? "" : "justify-content: center;"}
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-fg);
  box-shadow: var(--shadow);
  font-weight: 500;
  transition: transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s;
}
.launcher:hover { transform: scale(1.04); }
.launcher:active { transform: scale(.97); }
.launcher:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.launcher svg { width: 24px; height: 24px; display: block; }

.badge {
  position: absolute;
  top: -2px;
  ${look.position === "left" ? "left" : "right"}: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: grid;
  place-items: center;
}

/* ---------------------------------------------------------------- panel */

.panel {
  width: 400px;
  height: min(680px, calc(100vh - var(--offset) * 2 - 76px));
  background: var(--bg);
  color: var(--fg);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform-origin: bottom ${look.position === "left" ? "left" : "right"};
  animation: pop .22s cubic-bezier(.2,.8,.2,1);
}

@keyframes pop {
  from { opacity: 0; transform: translateY(12px) scale(.97); }
  to   { opacity: 1; transform: none; }
}

/* A visitor who has asked for less motion gets none, rather than a faster
   version of the same thing. */
@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
  .launcher { transition: none; }
  .launcher:hover, .launcher:active { transform: none; }
}

/* Below this the panel is the page. A 400px card floating over a 390px phone
   is the single most common way an embedded widget is unusable. */
@media (max-width: 480px) {
  .root { inset: 0; bottom: var(--offset); }
  .panel {
    position: fixed;
    inset: 0;
    background: var(--bg);
    width: 100%;
    height: 100%;
    max-height: none;
    border-radius: 0;
    border: 0;
    animation: slide .24s cubic-bezier(.2,.8,.2,1);
  }
  @keyframes slide {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: none; }
  }

  /* The launcher has nothing to launch once the panel is the whole screen,
     and it floats over the conversation if left alone. The panel precedes it
     in the DOM precisely so this sibling selector can reach it. */
  .panel:not(.hidden) ~ .launcher { display: none; }
}

/* ------------------------------------------------------------ sizes */

/* The middle size. A table of twenty rows and a chart beside it need room the
   corner panel does not have and do not need a page of their own. Centred
   rather than grown from the corner, because at this size it is a dialog and
   dialogs live in the middle. */
.root.maximized .panel {
  position: fixed;
  width: 80vw;
  height: 80vh;
  max-width: 1100px;
  max-height: 900px;
  top: 50%;
  left: 50%;
  right: auto;
  bottom: auto;
  transform: translate(-50%, -50%);
  animation: none;
}
.root.maximized { align-items: flex-end; }

/* Page mode: the widget is the document. No launcher, no rounding, no shadow —
   nothing to sit "on top of". */
:host([data-mode="page"]) .root {
  position: fixed;
  inset: 0;
  align-items: stretch;
  gap: 0;
}
:host([data-mode="page"]) .panel {
  width: 100%;
  height: 100%;
  max-height: none;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  animation: none;
}
:host([data-mode="page"]) .launcher { display: none; }

/* Inline mode: the assistant is a block in somebody's layout — a panel in a
   dashboard, a tab in an admin screen. It fills whatever box it was given and
   has no launcher, because the thing that opens it is the page.

   Distinct from page mode, which is fixed to the viewport and owns it.
   Inline owns nothing; if it took the viewport it would escape the container
   it was placed in, which is the whole reason somebody chose this mode. */
:host([data-mode="inline"]) .root {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  align-items: stretch;
  gap: 0;
}
:host([data-mode="inline"]) .panel {
  position: relative;
  width: 100%;
  height: 100%;
  max-height: none;
  inset: auto;
  box-shadow: none;
  animation: none;
}
:host([data-mode="inline"]) .launcher { display: none; }
:host([data-mode="inline"]) .drawer { position: static; width: 210px; }
@media (max-width: 640px) {
  :host([data-mode="inline"]) .drawer { position: absolute; inset: 0; width: 100%; }
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 14px 16px;
  background: var(--accent);
  color: var(--accent-fg);
  flex-shrink: 0;
}
.avatar {
  width: 32px; height: 32px;
  border-radius: 999px;
  object-fit: cover;
  background: rgb(255 255 255 / .2);
  flex-shrink: 0;
}
.titles { min-width: 0; flex: 1; }
.title { font-weight: 600; font-size: 15px; line-height: 1.25; }
.subtitle { font-size: 12px; opacity: .8; line-height: 1.3; }
.actions { display: flex; align-items: center; gap: 2px; }

.icon {
  width: 30px; height: 30px;
  border-radius: 8px;
  display: grid; place-items: center;
  opacity: .85;
  flex-shrink: 0;
}
.icon:hover { background: rgb(255 255 255 / .16); opacity: 1; }
.icon:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 1px; }
.icon svg { width: 17px; height: 17px; }

/* --------------------------------------------------------- conversations */

.body { display: flex; min-height: 0; flex: 1; position: relative; }

/* The drawer overlays by default and only sits beside the conversation when
   there is room for both.
   Keyed on the widget's own size rather than the viewport: the panel is 400px
   wide on a 1512px screen, so a "max-width" media query says "desktop" and
   hands 190px of a 400px panel to a list of links. Room is a property of the
   panel, and the two states that have it are maximized and page mode. */
.drawer {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  flex-shrink: 0;
  border-right: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}


.root.maximized .drawer,
:host([data-mode="page"]) .drawer {
  position: static;
  width: 210px;
}
.newthread {
  display: flex; align-items: center; gap: 6px;
  margin: 8px; padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  font-size: 13px;
  flex-shrink: 0;
}
.newthread:hover { border-color: var(--accent); }
.newthread svg { width: 14px; height: 14px; }
.threads { overflow-y: auto; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 2px; }
.thread {
  display: flex; flex-direction: column; gap: 1px;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
  font-size: 12.5px;
}
.thread:hover { background: var(--bg); }
.thread.active { background: var(--bg); box-shadow: inset 2px 0 0 var(--accent); }
.thread .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread .w { font-size: 11px; color: var(--muted); }
.empty { color: var(--muted); font-size: 12px; padding: 4px 8px; }

/* A phone is never wide enough for both, whatever mode it is in. */
@media (max-width: 640px) {
  .root.maximized .drawer,
  :host([data-mode="page"]) .drawer {
    position: absolute;
    inset: 0;
    width: 100%;
  }
}

/* ------------------------------------------------------- charts + cites */

/* Capped, and that is the whole point of the cap: the SVG scales to its
   container, so in the maximized dialog or a full-screen tab an answer's
   chart grew to fill the window — a pie the height of the viewport, above a
   sentence explaining it. A chart here is read at a glance beside the text,
   not studied, so it stops growing where it stops being legible-at-a-glance
   and the column keeps its measure. */
.chart { margin: 10px 0 4px; max-width: 400px; }
.chart-pie { max-width: 220px; }
.chart figcaption {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.chart svg { width: 100%; height: auto; display: block; overflow: visible; }
.chart .grid { stroke: var(--line); stroke-width: 1; }
.chart .tick { fill: var(--muted); font-size: 9px; }
.chart .value { fill: var(--fg); font-size: 9px; font-weight: 600; }
/* Labels drawn inside a filled block: white on the fill, and never wider than
   the block that holds them. */
.chart .inbox { fill: #fff; font-size: 9px; font-weight: 600; }
.chart .inbox-value { fill: #fff; font-size: 9px; opacity: .85; }

.chart-kpi .kpi-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.chart-kpi .kpi-label { margin-top: 2px; font-size: 11px; color: var(--muted); }

.chart-heatmap table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 2px;
  font-size: 10px;
}
.chart-heatmap th {
  font-weight: 400;
  color: var(--muted);
  text-align: right;
  padding-right: 4px;
  white-space: nowrap;
}
.chart-heatmap thead th { text-align: center; padding: 0 2px 2px; }
.chart-heatmap td {
  text-align: center;
  padding: 3px 4px;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
}
/* Slices separated by the colour behind them, so touching slices of
   similar hue still read as two. */
.chart .slice { stroke: var(--surface); stroke-width: 1; }
.chart .hole { fill: var(--surface); }
.chart .total { fill: var(--fg); font-size: 20px; font-weight: 700; }
.chart .total-label {
  fill: var(--muted);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: .08em;
}

/* A pie's legend is a small table: swatch, name, value, share. Laid out in a
   grid so the numbers line up in columns rather than wandering with the
   length of each name. */
.legend.keyed {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 2px 8px;
  align-items: baseline;
}
.legend.keyed span { display: contents; }
.legend.keyed b { font-weight: 400; color: var(--fg); }
.legend.keyed em,
.legend.keyed u {
  font-style: normal;
  text-decoration: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.legend.keyed em { color: var(--fg); font-weight: 600; }
.legend {
  display: flex; flex-wrap: wrap; gap: 4px 10px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

/* The trace, above the answer, and the evidence, below it. Both collapsed:
   a correct answer needs no defence, and both are one click from being the
   most useful thing on screen when it is wrong. */
.trace, .cites {
  font-size: 12px;
}
.trace { margin: 0 0 6px; }
.cites { margin-top: 8px; }
.trace summary, .cites summary {
  cursor: pointer;
  color: var(--muted);
  list-style: none;
}
.trace summary::-webkit-details-marker, .cites summary::-webkit-details-marker { display: none; }
.trace summary::before, .cites summary::before { content: "▸  "; }
.trace[open] summary::before, .cites[open] summary::before { content: "▾  "; }
.trace summary:hover, .cites summary:hover { color: var(--fg); }

.trace ol {
  margin: 6px 0 0;
  padding: 0 0 0 10px;
  list-style: none;
  border-left: 1px solid var(--line);
  color: var(--muted);
}
.step {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 3px 0;
}
.step .what { flex: 1; min-width: 0; }
.step .took { flex: none; opacity: .7; font-variant-numeric: tabular-nums; }
.step.error .what { color: var(--warn, #f59e0b); }

.cites ul { margin: 6px 0 0; padding: 0; list-style: none; }
.cites li {
  margin: 6px 0 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.cites .head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.cites .head .what { font-weight: 600; }
.cites .meta {
  margin-top: 2px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.cites .facts { margin-top: 6px; color: var(--muted); }
.cites .facts > div { margin: 2px 0; overflow-wrap: anywhere; }
.cites .facts b { color: var(--fg); font-weight: 600; margin-right: 4px; }
.cites .facts i { font-style: italic; }
.tag {
  flex: none;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.ok { border-color: transparent; background: var(--accent); color: var(--accent-fg); }

.log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}
.log::-webkit-scrollbar { width: 8px; }
.log::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }

.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.bubble {
  max-width: 86%;
  padding: 9px 13px;
  border-radius: 14px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.msg.user .bubble {
  background: var(--accent);
  color: var(--accent-fg);
  border-bottom-right-radius: 4px;
}
.msg.assistant .bubble {
  background: var(--surface);
  border: 1px solid var(--line);
  border-bottom-left-radius: 4px;
}
.msg.failed .bubble { border-color: #ef4444; color: #b91c1c; }

.bubble p { margin: 0 0 8px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble ul, .bubble ol { margin: 0 0 8px; padding-left: 20px; }
.bubble li { margin: 2px 0; }
.bubble code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .92em;
  background: rgb(0 0 0 / .06);
  padding: 1px 4px;
  border-radius: 4px;
}
:host([data-theme="dark"]) .bubble code { background: rgb(255 255 255 / .1); }
.bubble pre {
  margin: 0 0 8px;
  padding: 10px;
  border-radius: 8px;
  background: rgb(0 0 0 / .06);
  overflow-x: auto;
}
.bubble pre code { background: none; padding: 0; }
.bubble a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.bubble table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 8px;
  font-size: 13px;
  display: block;
  overflow-x: auto;
}
.bubble th, .bubble td {
  border: 1px solid var(--line);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}
.bubble th { background: rgb(0 0 0 / .04); font-weight: 600; }

/* The caret marks the live end of a streaming answer, so a pause reads as
   thinking rather than as finished. */
.caret {
  display: inline-block;
  width: 2px; height: 1em;
  background: currentColor;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .caret { animation: none; } }

.activity {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px;
  color: var(--muted);
  padding: 2px 2px 0;
}
.dots { display: inline-flex; gap: 3px; }
.dots i {
  width: 5px; height: 5px; border-radius: 999px;
  background: currentColor;
  animation: bounce 1.2s infinite ease-in-out;
}
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 60%, 100% { opacity: .3 } 30% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .dots i { animation: none; opacity: .6 } }

.chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
.chip {
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--fg);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  text-align: left;
  transition: background .15s, border-color .15s;
}
.chip:hover { background: var(--surface); border-color: var(--muted); }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.composer {
  flex-shrink: 0;
  border-top: 1px solid var(--line);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg);
}
.field { display: flex; align-items: flex-end; gap: 8px; }
textarea {
  flex: 1;
  font: inherit;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 9px 12px;
  resize: none;
  max-height: 120px;
  min-height: 40px;
  outline: none;
  overflow-y: auto;
}
textarea::placeholder { color: var(--muted); }
textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
textarea:disabled { opacity: .6; cursor: not-allowed; }

.send {
  width: 40px; height: 40px;
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-fg);
  display: grid; place-items: center;
  flex-shrink: 0;
  transition: opacity .15s;
}
.send:disabled { opacity: .35; cursor: not-allowed; }
.send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.send svg { width: 18px; height: 18px; }

/* Stop, while an answer is streaming. A square rather than an icon because it
   replaces the send arrow in the same 18px box, and the two need to read as
   one control changing state rather than two controls swapping places. */
.send .stop {
  display: block;
  width: 12px; height: 12px;
  border-radius: 3px;
  background: currentColor;
}

.foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
}
.foot a { color: inherit; text-decoration: none; }
.foot a:hover { text-decoration: underline; }

.hidden { display: none !important; }

.sr {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`
}
