import type { LauncherIcon } from "./types"

/**
 * Inline SVG, because a widget must not need a second request to draw itself.
 *
 * `currentColor` throughout so the launcher, the header and the send button
 * all take their colour from the accent without any of them knowing what it
 * is. `aria-hidden` on every one: they sit beside a label or inside a button
 * that already has an accessible name, and announcing "graphic" twice is worse
 * than not announcing it at all.
 */

const svg = (body: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const LAUNCHER_ICONS: Record<LauncherIcon, string> = {
  chat: svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  sparkle: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/>'),
  question: svg('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
}

export const CLOSE = svg('<path d="M18 6L6 18M6 6l12 12"/>', 18)
export const SEND = svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>', 18)
export const CHEVRON = svg('<path d="M6 9l6 6 6-6"/>', 18)
