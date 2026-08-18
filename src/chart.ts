/**
 * Charts, in about two hundred lines of SVG.
 *
 * The obvious move is to pull in a charting library. It is also the wrong one
 * here: the smallest credible option is ten times the size of this entire
 * widget, and it would be sitting on somebody else's critical path to draw
 * four bars. The backend already decides *what* the chart is — type,
 * categories, series — so all that is left is drawing it, and drawing a bar
 * chart is not hard.
 *
 * What this deliberately does not do: tooltips, legends with toggles, zoom,
 * animation. An answer's chart is read once, at a glance, next to the sentence
 * that explains it. Everything past a glance belongs in the full product.
 */

export interface ChartSeries {
  name: string
  data: Array<number | null>
  unit?: string | null
}

export interface ChartConfig {
  /** Kept in step with the backend's `ChartSpec.type`. */
  type:
    | "bar"
    | "hbar"
    | "line"
    | "area"
    | "pie"
    | "donut"
    | "treemap"
    | "scatter"
    | "heatmap"
    | "funnel"
    | "kpi"
    | "combo"
  title?: string | null
  categories: Array<string | number | null>
  series: ChartSeries[]
  stacked?: boolean
  right_axis?: string[]
}

const W = 320
const H = 180
const PAD = { top: 8, right: 8, bottom: 26, left: 40 }

/**
 * A pie gets its own, square box.
 *
 * Drawn into the 320×180 plot like the others, the circle can only be as wide
 * as the box is tall, so a third of the width on each side is empty — and
 * because the SVG scales to its container, that empty space grows with it.
 * A square box means the drawing is the chart, and the width cap below is
 * about the circle rather than about the margins beside it.
 */
const PIE = 180

/** Enough hues to tell series apart, few enough that none shouts. */
const COLOURS = ["#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#ef4444", "#14b8a6"]

export function renderChart(config: ChartConfig): string {
  if (!config?.series?.length || !config.categories?.length) return ""
  // Two of these are not drawings at all — a number and a grid — so they leave
  // through a different door rather than being squeezed into an SVG with axes
  // they do not have.
  if (config.type === "kpi") return kpi(config)
  if (config.type === "heatmap") return heatmap(config)

  const body =
    config.type === "pie" || config.type === "donut"
      ? pie(config)
      : config.type === "treemap"
        ? treemap(config)
        : config.type === "funnel"
          ? funnel(config)
          : config.type === "hbar"
            ? hbars(config)
            : config.type === "line" || config.type === "area" || config.type === "scatter"
              ? lines(config)
              : bars(config)

  const box =
    config.type === "pie" || config.type === "donut"
      ? `0 0 ${PIE} ${PIE}`
      : config.type === "treemap" || config.type === "funnel" || config.type === "hbar"
        ? `0 0 ${W} ${tallH(config)}`
        : `0 0 ${W} ${H}`

  return `<figure class="chart chart-${config.type}">
    ${config.title ? `<figcaption>${escape(String(config.title))}</figcaption>` : ""}
    <svg viewBox="${box}" role="img" aria-label="${escape(label(config))}" preserveAspectRatio="xMidYMid meet">${body}</svg>
    ${legend(config)}
  </figure>`
}

// ------------------------------------------------------------------ scales

function bounds(config: ChartConfig): { min: number; max: number } {
  const values = config.series.flatMap((s) => s.data.filter(isNumber))
  if (!values.length) return { min: 0, max: 1 }
  let max = Math.max(...values)
  let min = Math.min(...values, 0)
  if (config.stacked) {
    max = Math.max(
      ...config.categories.map((_, i) =>
        config.series.reduce((sum, s) => sum + (isNumber(s.data[i]) ? (s.data[i] as number) : 0), 0),
      ),
    )
  }
  // A flat series would otherwise divide by zero and draw nothing.
  if (max === min) max = min + 1
  return { min, max }
}

const plotW = W - PAD.left - PAD.right
const plotH = H - PAD.top - PAD.bottom

function y(value: number, b: { min: number; max: number }): number {
  return PAD.top + plotH - ((value - b.min) / (b.max - b.min)) * plotH
}

// -------------------------------------------------------------------- bars

function bars(config: ChartConfig): string {
  const b = bounds(config)
  const groups = config.categories.length
  const slot = plotW / groups
  const stacked = !!config.stacked && config.series.length > 1
  const width = stacked ? slot * 0.6 : (slot * 0.6) / config.series.length

  const rects = config.categories
    .map((_, i) => {
      let stackTop = 0
      return config.series
        .map((series, s) => {
          const value = series.data[i]
          if (!isNumber(value)) return ""
          const x = stacked
            ? PAD.left + i * slot + slot * 0.2
            : PAD.left + i * slot + slot * 0.2 + s * width
          const top = stacked ? y(stackTop + value, b) : y(Math.max(value, 0), b)
          const bottom = stacked ? y(stackTop, b) : y(0, b)
          if (stacked) stackTop += value
          return `<rect x="${round(x)}" y="${round(top)}" width="${round(width)}" height="${round(Math.max(1, bottom - top))}" fill="${colour(s)}" rx="2"/>`
        })
        .join("")
    })
    .join("")

  // The value above each bar, when there is one series and few enough bars for
  // the numbers not to collide. A bar chart without them makes you read a
  // value off an axis by eye, and the reason to draw a chart next to a
  // sentence is that the figures should be legible without doing that.
  const labels =
    config.series.length === 1 && groups <= 8
      ? config.categories
          .map((_, i) => {
            const value = config.series[0]?.data[i]
            if (!isNumber(value)) return ""
            const top = y(Math.max(value, 0), b)
            return `<text x="${round(PAD.left + i * slot + slot / 2)}" y="${round(top) - 4}" class="value" text-anchor="middle">${compact(value)}</text>`
          })
          .join("")
      : ""

  return axes(config, b) + rects + labels
}

// ------------------------------------------------- lines, areas, scatter

function lines(config: ChartConfig): string {
  const b = bounds(config)
  const step = config.categories.length > 1 ? plotW / (config.categories.length - 1) : 0
  const x = (i: number) =>
    config.categories.length > 1 ? PAD.left + i * step : PAD.left + plotW / 2

  const drawn = config.series
    .map((series, s) => {
      const points = series.data
        .map((value, i) => (isNumber(value) ? `${round(x(i))},${round(y(value, b))}` : null))
        .filter(Boolean) as string[]
      if (!points.length) return ""

      if (config.type === "scatter") {
        return points
          .map((p) => {
            const [px, py] = p.split(",")
            return `<circle cx="${px}" cy="${py}" r="3" fill="${colour(s)}"/>`
          })
          .join("")
      }

      const line = `<polyline points="${points.join(" ")}" fill="none" stroke="${colour(s)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      if (config.type !== "area") return line

      const first = points[0]!.split(",")[0]
      const last = points[points.length - 1]!.split(",")[0]
      const base = round(y(Math.max(b.min, 0), b))
      return (
        `<polygon points="${first},${base} ${points.join(" ")} ${last},${base}" fill="${colour(s)}" opacity="0.15"/>` +
        line
      )
    })
    .join("")

  return axes(config, b) + drawn
}

// --------------------------------------------------------------------- pie

function pie(config: ChartConfig): string {
  // One series only: a pie of two series is two pies, and the backend does not
  // send that. Slices come from the first series across the categories.
  const data = (config.series[0]?.data ?? []).map((v) => (isNumber(v) ? Math.max(v, 0) : 0))
  const total = data.reduce((a, b) => a + b, 0)
  if (!total) return ""

  const cx = PIE / 2
  const cy = PIE / 2
  const r = PIE / 2 - 4
  // A ring rather than a disc, and the hole is not decoration: it is where the
  // total goes. A pie of five slices used to say nothing but "one of these is
  // most of it" — no values, no shares, no total — which is a picture of a
  // number rather than the number.
  const inner = r * 0.58

  let angle = -Math.PI / 2
  const slices = data
    .map((value, i) => {
      const sweep = (value / total) * Math.PI * 2
      const from = angle
      angle += sweep
      if (sweep <= 0) return ""
      // A slice at exactly 360° cannot be drawn as an arc — the start and end
      // points coincide and the path collapses. Two circles instead.
      if (sweep >= Math.PI * 2 - 1e-6) {
        return (
          `<circle cx="${cx}" cy="${cy}" r="${round(r)}" fill="${colour(i)}"/>` +
          `<circle cx="${cx}" cy="${cy}" r="${round(inner)}" class="hole"/>`
        )
      }
      return `<path d="${ring(cx, cy, r, inner, from, angle)}" fill="${colour(i)}" class="slice"/>`
    })
    .join("")

  // The total, in the middle, at the size of a headline. It is the one figure
  // every reader of a breakdown wants and the only one a pie cannot show.
  const middle =
    `<text x="${cx}" y="${cy - 1}" class="total" text-anchor="middle">${compact(total)}</text>` +
    `<text x="${cx}" y="${cy + 13}" class="total-label" text-anchor="middle">total</text>`

  return slices + middle
}

/** The path for one segment of a ring: outer arc out, inner arc back. */
function ring(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  to: number,
): string {
  const large = to - from > Math.PI ? 1 : 0
  const x1 = cx + outer * Math.cos(from)
  const y1 = cy + outer * Math.sin(from)
  const x2 = cx + outer * Math.cos(to)
  const y2 = cy + outer * Math.sin(to)
  const x3 = cx + inner * Math.cos(to)
  const y3 = cy + inner * Math.sin(to)
  const x4 = cx + inner * Math.cos(from)
  const y4 = cy + inner * Math.sin(from)
  return [
    `M ${round(x1)} ${round(y1)}`,
    `A ${round(outer)} ${round(outer)} 0 ${large} 1 ${round(x2)} ${round(y2)}`,
    `L ${round(x3)} ${round(y3)}`,
    `A ${round(inner)} ${round(inner)} 0 ${large} 0 ${round(x4)} ${round(y4)}`,
    "Z",
  ].join(" ")
}

// -------------------------------------------------------------------- axes

function axes(config: ChartConfig, b: { min: number; max: number }): string {
  const ticks = [b.min, b.min + (b.max - b.min) / 2, b.max]
  const grid = ticks
    .map(
      (t) =>
        `<line x1="${PAD.left}" y1="${round(y(t, b))}" x2="${W - PAD.right}" y2="${round(y(t, b))}" class="grid"/>` +
        `<text x="${PAD.left - 5}" y="${round(y(t, b)) + 3}" class="tick" text-anchor="end">${compact(t)}</text>`,
    )
    .join("")

  // Category labels thin themselves out rather than overlapping: twelve months
  // fit, thirty days do not, and rotated text at this size is unreadable.
  const every = Math.ceil(config.categories.length / 6)
  const slot = plotW / config.categories.length
  const labels = config.categories
    .map((c, i) =>
      i % every === 0
        ? `<text x="${round(PAD.left + i * slot + slot / 2)}" y="${H - 8}" class="tick" text-anchor="middle">${escape(short(String(c ?? "")))}</text>`
        : "",
    )
    .join("")

  return grid + labels
}

function legend(config: ChartConfig): string {
  // A pie's legend carries the numbers. The slices show the shape and the
  // legend shows the figures — colour, name, value, share — because "which of
  // these is 8%" is not a question anybody should answer by eye, and there are
  // no tooltips here to ask.
  if (config.type === "pie" || config.type === "donut") {
    const data = (config.series[0]?.data ?? []).map((v) => (isNumber(v) ? Math.max(v, 0) : 0))
    const total = data.reduce((a, b) => a + b, 0)
    if (!total) return ""
    const rows = config.categories
      .map((name, i) => ({ name: String(name ?? ""), value: data[i] ?? 0, index: i }))
      // Largest first: a legend in the data's arbitrary order makes you read
      // all of it to find the big one.
      .sort((a, b) => b.value - a.value)
      .map(
        (row) =>
          `<span><i style="background:${colour(row.index)}"></i>` +
          `<b>${escape(short(row.name, 22))}</b>` +
          `<em>${compact(row.value)}</em>` +
          `<u>${share(row.value, total)}</u></span>`,
      )
    return `<div class="legend keyed">${rows.join("")}</div>`
  }

  if (config.type === "treemap" || config.type === "funnel") return ""
  const names = config.series.length > 1 ? config.series.map((s) => s.name) : []
  if (!names.length) return ""
  return `<div class="legend">${names
    .map(
      (name, i) =>
        `<span><i style="background:${colour(i)}"></i>${escape(short(name, 18))}</span>`,
    )
    .join("")}</div>`
}

/** `18.5%`, and never `0%` for something that is actually there. */
function share(value: number, total: number): string {
  if (!total) return ""
  const pct = (value / total) * 100
  if (pct > 0 && pct < 0.1) return "<0.1%"
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`
}

// ------------------------------------------------------------------- utils

function colour(i: number): string {
  return COLOURS[i % COLOURS.length]!
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/** `12.4k`, not `12400` — an axis label has about four characters of room. */
function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${trim(n / 1e9)}b`
  if (abs >= 1e6) return `${trim(n / 1e6)}m`
  if (abs >= 1e3) return `${trim(n / 1e3)}k`
  return trim(n)
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10)
}

function short(text: string, max = 10): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function label(config: ChartConfig): string {
  return `${config.type} chart${config.title ? `: ${config.title}` : ""}, ${config.categories.length} categories`
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ------------------------------------------------------ the wider repertoire

/**
 * How tall a chart needs to be when its rows are horizontal.
 *
 * Horizontal bars, treemaps and funnels all grow downward with the number of
 * categories rather than sideways, so a fixed 180 either squashes twenty rows
 * into nothing or leaves a third of the box empty for three.
 */
function tallH(config: ChartConfig): number {
  const rows = config.categories.length
  if (config.type === "hbar") return Math.max(90, PAD.top + rows * 22 + 10)
  if (config.type === "funnel") return Math.max(90, rows * 34 + 8)
  return Math.max(140, Math.min(280, 60 + rows * 12))
}

/** Bars on their side: room for the names, and reads like the text beside it. */
function hbars(config: ChartConfig): string {
  const height = tallH(config)
  const rows = config.categories.length
  const slot = (height - PAD.top - 6) / Math.max(1, rows)
  const values = config.series[0]?.data ?? []
  const max = Math.max(...values.map((v) => (isNumber(v) ? v : 0)), 0)
  // Labels live inside the plot on the left, so the axis is the label column.
  const left = Math.min(120, 8 + longest(config) * 5.2)
  const width = W - left - 34

  return config.categories
    .map((name, i) => {
      const value = values[i]
      if (!isNumber(value)) return ""
      const y = PAD.top + i * slot
      const bar = max > 0 ? Math.max(1, (value / max) * width) : 1
      return (
        `<text x="${round(left - 6)}" y="${round(y + slot / 2 + 3)}" class="tick" text-anchor="end">${escape(short(String(name ?? ""), 22))}</text>` +
        `<rect x="${round(left)}" y="${round(y + slot * 0.18)}" width="${round(bar)}" height="${round(slot * 0.64)}" fill="${colour(0)}" rx="2"/>` +
        `<text x="${round(left + bar + 4)}" y="${round(y + slot / 2 + 3)}" class="value">${compact(value)}</text>`
      )
    })
    .join("")
}

/**
 * Parts of a whole when there are too many for a circle.
 *
 * A squarified treemap would be better and is a great deal more code; this
 * lays rows of proportional width, which is honest about area and stays
 * readable to about thirty categories.
 */
function treemap(config: ChartConfig): string {
  const height = tallH(config)
  const values = (config.series[0]?.data ?? []).map((v) => (isNumber(v) ? Math.max(v, 0) : 0))
  const total = values.reduce((a, b) => a + b, 0)
  if (!total) return ""

  // Rows of roughly equal height, filled left to right until each is full.
  const perRow = Math.ceil(Math.sqrt(values.length))
  const rows = Math.ceil(values.length / perRow)
  const rowH = height / rows
  let out = ""

  for (let r = 0; r < rows; r++) {
    const slice = values.slice(r * perRow, (r + 1) * perRow)
    const sum = slice.reduce((a, b) => a + b, 0) || 1
    let x = 0
    slice.forEach((value, i) => {
      const index = r * perRow + i
      const width = (value / sum) * W
      const name = String(config.categories[index] ?? "")
      out +=
        `<rect x="${round(x)}" y="${round(r * rowH)}" width="${round(Math.max(0, width - 1))}" height="${round(rowH - 1)}" fill="${colour(index)}" rx="2"/>` +
        // Only labelled where the label fits. A name clipped to two letters is
        // noise that makes the block look broken.
        (width > 46
          ? `<text x="${round(x + 5)}" y="${round(r * rowH + 14)}" class="inbox">${escape(short(name, Math.floor(width / 6)))}</text>` +
            `<text x="${round(x + 5)}" y="${round(r * rowH + 27)}" class="inbox-value">${compact(value)}</text>`
          : "")
      x += width
    })
  }
  return out
}

/** Ordered stages that shrink. The drop between rungs is the point. */
function funnel(config: ChartConfig): string {
  const values = (config.series[0]?.data ?? []).map((v) => (isNumber(v) ? Math.max(v, 0) : 0))
  const top = values[0] || Math.max(...values, 1)
  const rowH = 34

  return config.categories
    .map((name, i) => {
      const value = values[i] ?? 0
      const width = top > 0 ? Math.max(2, (value / top) * W) : 2
      const x = (W - width) / 2
      const y = i * rowH
      // The share of the first stage, which is the number people actually want
      // from a funnel — "we lose 40% at underwriting".
      const share = top > 0 ? `${Math.round((value / top) * 100)}%` : ""
      return (
        `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${rowH - 8}" fill="${colour(i)}" rx="3"/>` +
        `<text x="${round(W / 2)}" y="${round(y + 17)}" class="inbox" text-anchor="middle">${escape(short(String(name ?? ""), 24))} · ${compact(value)} · ${share}</text>`
      )
    })
    .join("")
}

/** One number, at the size it deserves. */
function kpi(config: ChartConfig): string {
  const series = config.series[0]
  const value = series?.data[0]
  if (!isNumber(value)) return ""
  return `<figure class="chart chart-kpi">
    ${config.title ? `<figcaption>${escape(String(config.title))}</figcaption>` : ""}
    <div class="kpi-value">${escape(value.toLocaleString())}</div>
    <div class="kpi-label">${escape(series?.name ?? "")}${series?.unit ? ` · ${escape(series.unit)}` : ""}</div>
  </figure>`
}

/**
 * Two dimensions and one measure, as a grid of tinted cells.
 *
 * Categories arrive as "row | column" — the contract carries one category
 * axis, so the pair travels joined and is split here.
 */
function heatmap(config: ChartConfig): string {
  const cells = config.categories.map((category, i) => {
    const [row = "", column = ""] = String(category ?? "").split("|").map((p) => p.trim())
    return { row, column, value: config.series[0]?.data[i] ?? null }
  })
  const rows = [...new Set(cells.map((c) => c.row))]
  const columns = [...new Set(cells.map((c) => c.column))]
  const max = Math.max(...cells.map((c) => (isNumber(c.value) ? c.value : 0)), 0)

  const head =
    `<tr><th></th>${columns
      .map((c) => `<th>${escape(short(c, 10))}</th>`)
      .join("")}</tr>`
  const body = rows
    .map((row) => {
      const tds = columns
        .map((column) => {
          const value = cells.find((c) => c.row === row && c.column === column)?.value ?? null
          // Opacity of one hue rather than a colour scale: readable without a
          // legend, and without asking anyone to separate red from green.
          const weight = isNumber(value) && max > 0 ? value / max : 0
          return `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(
            8 + weight * 82,
          )}%, transparent)">${isNumber(value) ? compact(value) : "—"}</td>`
        })
        .join("")
      return `<tr><th>${escape(short(row, 14))}</th>${tds}</tr>`
    })
    .join("")

  return `<figure class="chart chart-heatmap">
    ${config.title ? `<figcaption>${escape(String(config.title))}</figcaption>` : ""}
    <table><thead>${head}</thead><tbody>${body}</tbody></table>
  </figure>`
}

function longest(config: ChartConfig): number {
  return Math.max(...config.categories.map((c) => String(c ?? "").length), 0)
}
