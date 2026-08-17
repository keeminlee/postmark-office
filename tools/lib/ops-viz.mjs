// ops-viz.mjs — the shared rendering kit for the postmark.town/ops/ dashboards.
//
// Four generators (traffic, git, economy, world) plus the hub write static HTML
// that nginx serves straight off the box: no build step, no CDN, no chart
// library, no webfont. Everything below emits inline SVG and plain CSS so a page
// is one self-contained file, readable with the network unplugged.
//
// THE PALETTE IS COMPUTED, NOT CHOSEN. The eight series hues are the dataviz
// reference ramp's dark steps, re-ORDERED (same hexes, zero new values) by
// enumerating all 40,320 orderings against this surface and keeping only those
// clearing every adjacent gate — lightness band, chroma floor, protan/deutan CVD
// separation, the normal-vision floor, and 3:1 contrast. 588 orders pass; this
// one is among the best-scoring (worst adjacent CVD ΔE 9.4, normal-vision 19.3
// against #12151c) and opens warm, which is the town's own register. Re-check
// with the dataviz skill's validate_palette.js before touching a hex:
//   node scripts/validate_palette.js "<SERIES joined>" --mode dark --surface "#12151c"
//
// SLOT ORDER IS THE SAFETY MECHANISM. Assign slots in sequence and never cycle
// past eight — a ninth series folds into "other", or the chart facets. Colour
// follows the entity, never its rank, so a filtered chart never repaints the
// survivors.
//
// STATUS IS NOT A SERIES. The three status inks are the town's existing chip
// colours (all ≥ 6:1 on this surface) and are reserved for good/warn/bad. They
// always ship with a word beside them; hue never carries state alone.
//
// Two rendering conventions worth knowing before editing:
//   1. Plots are SVG on a 720-unit viewBox inside an overflow-x wrapper with a
//      600px floor, so axis text never shrinks below ~10px on a phone — the
//      chart scrolls sideways instead of becoming unreadable.
//   2. CATEGORY BARS ARE HTML, not SVG. A horizontal bar's label is prose of
//      unpredictable length (handles, mark ids, tool names); as SVG text it
//      cannot wrap, cannot ellipsize, and scales with the viewBox. As an HTML
//      grid row it reflows, truncates cleanly, keeps its real font size on a
//      phone, and gets an exact 4px rounded data-end with no aspect distortion.
//      This is the idiom the economy page already used; it is kept on purpose.
//
// Hover is native: every mark carries an SVG <title>, and no value is reachable
// ONLY by hover — each chart has a collapsed table twin beneath it, which is
// also what serves phones (no hover) and screen readers.

// ── tokens ───────────────────────────────────────────────────────────────────
export const BG = "#12151c";      // page plane / chart surface
export const PANEL = "#191d26";   // raised card
export const LINE = "#2a303d";    // hairline border
export const GRID = "#242a36";    // gridline, one step off surface
export const INK = "#d7dae2";     // primary
export const DIM = "#8b91a0";     // secondary / axis
export const GOLD = "#e8c48b";    // the town's accent — chrome only, never a series

// categorical slots, in assignment order (see the header)
export const SERIES = ["#d95926", "#199e70", "#3987e5", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
// de-emphasis: the "everything else" grey, and the resting sparkline hue
export const MUTED = "#5c6472";
// status — reserved, always beside a word
export const OK = "#7fbf7f";
export const WARN = "#e0a458";
export const BAD = "#d97b6c";
export const STATUS = { ok: OK, warn: WARN, red: BAD };

// ── text + numbers ───────────────────────────────────────────────────────────
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const comma = (n) => Number(n ?? 0).toLocaleString("en-US");
export const pct = (x, dp = 1) => `${(x * 100).toFixed(dp)}%`;
export function compact(n) {
  const v = Number(n ?? 0);
  const a = Math.abs(v);
  if (a < 1000) return String(Math.round(v));
  if (a < 1e6) { const k = v / 1000; return `${a < 10000 ? k.toFixed(1) : Math.round(k)}K`; }
  const m = v / 1e6;
  return `${a < 1e7 ? m.toFixed(1) : Math.round(m)}M`;
}
/** Truncate for a label slot, keeping the tail visible where the tail is the identifying part. */
export const clip = (s, n) => (String(s).length <= n ? String(s) : String(s).slice(0, n - 1) + "…");

// ── recency: the two windows every page reads against ────────────────────────
// A dashboard's first question is "what happened lately", not "what happened
// ever" (Keemin, 2026-08-11). Lifetime totals still belong on these pages — as
// the second reading, not the headline — so every page pairs a window with the
// window before it, and the pair is what gets rendered.
//
// The clock, not the newest log line, defines the window: a generator whose
// source has gone quiet must show a window that has fallen to zero, not a
// window that silently slides back to wherever the data stops.
export function windows(size = 7, now = Date.now()) {
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const curFrom = iso(now - (size - 1) * 864e5);
  const prevTo = iso(now - size * 864e5);
  const prevFrom = iso(now - (2 * size - 1) * 864e5);
  const listFrom = (from) => {
    const out = [];
    for (let d = new Date(`${from}T00:00:00Z`).getTime(); d <= now; d += 864e5) out.push(iso(d));
    return out;
  };
  return {
    size, curFrom, curTo: iso(now), prevFrom, prevTo,
    inCur: (d) => d >= curFrom,
    inPrev: (d) => d >= prevFrom && d <= prevTo,
    curDays: listFrom(curFrom),
    /** sum a { day: n } map (or via a picker) over the current / prior window */
    sum(map, pick = (v) => v) {
      let cur = 0, prev = 0;
      for (const [d, v] of Object.entries(map || {})) {
        const n = Number(pick(v)) || 0;
        if (d >= curFrom) cur += n; else if (d >= prevFrom && d <= prevTo) prev += n;
      }
      return { cur, prev };
    },
  };
}

/**
 * "▲ 27% vs prior 7d (640)" — the sub-line that turns a count into a direction.
 * Deliberately NOT colour-coded by default: more requests is not obviously good
 * and fewer marks is not obviously bad, and the method reserves status ink for
 * measures whose direction really does mean good or bad. Pass tone:"good"/"bad"
 * only where up genuinely is.
 */
export function deltaLine(cur, prev, { size = 7, unit = "", tone = null } = {}) {
  const cls = tone === "good" ? " d-good" : tone === "bad" ? " d-bad" : "";
  if (!prev && !cur) return `<span class="dim">nothing in either ${size}d window</span>`;
  if (!prev) return `<span class="k-d${cls}">new</span> · nothing in the prior ${size}d`;
  const change = (cur - prev) / prev;
  const arrow = cur === prev ? "=" : cur > prev ? "▲" : "▼";
  const mag = cur === prev ? "level" : `${Math.abs(change * 100) < 10 ? (Math.abs(change) * 100).toFixed(1) : Math.round(Math.abs(change) * 100)}%`;
  return `<span class="k-d${cls}">${arrow} ${mag}</span> vs prior ${size}d (${comma(prev)}${unit})`;
}

// A y-axis that lands on clean numbers. Returns { max, step, ticks }.
export function niceScale(rawMax, targetTicks = 4) {
  const m = Math.max(1, rawMax);
  const rough = m / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= rough) ?? 10 * mag;
  const max = Math.ceil(m / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return { max, step, ticks };
}

// ── plot geometry (shared by every SVG chart) ────────────────────────────────
// 820 user units wide, rendered between 620px (phone, wrapper scrolls) and 980px
// (desktop, fills the column). Both ends keep the 12-unit axis text between ~9px
// and ~14px, which is the whole reason the viewBox is this size and not larger.
const W = 820, PAD_L = 46, PAD_R = 14, PAD_T = 12, BAND = 20;
const plotW = W - PAD_L - PAD_R;
const svgOpen = (h, cls = "", w = W) => `<svg class="plot ${cls}" viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet">`;

function gridAndAxis(scale, plotH, fmt) {
  let s = "";
  for (const t of scale.ticks) {
    const y = (PAD_T + plotH - (t / scale.max) * plotH).toFixed(1);
    s += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="${t === 0 ? LINE : GRID}" stroke-width="1"/>`;
    s += `<text class="tick" x="${PAD_L - 7}" y="${y}" text-anchor="end" dominant-baseline="middle">${esc(fmt(t))}</text>`;
  }
  return s;
}
// x labels thin out until they fit: never overlap, never rotate.
function xLabels(labels, slot, x0, y, every) {
  const step = every ?? Math.max(1, Math.ceil(labels.length / Math.floor(plotW / 42)));
  const last = labels.length - 1;
  let s = "", drawn = -Infinity;
  labels.forEach((lab, i) => {
    // The newest column earns a label, but only if it is not about to sit on top
    // of the previous one — a forced last tick is how "08-1008-11" happens.
    const wanted = i % step === 0 || (i === last && last - drawn >= step);
    if (!wanted || i - drawn < step) return;
    drawn = i;
    s += `<text class="tick" x="${(x0 + i * slot + slot / 2).toFixed(1)}" y="${y}" text-anchor="middle">${esc(lab)}</text>`;
  });
  return s;
}
function roundedTop(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + rr).toFixed(1)}a${rr},${rr} 0 0 1 ${rr},${-rr}h${(w - 2 * rr).toFixed(1)}a${rr},${rr} 0 0 1 ${rr},${rr}V${(y + h).toFixed(1)}z`;
}

// ── sparkline ────────────────────────────────────────────────────────────────
/** A 12–30 point trend for a stat tile. Resting hue by default; the accent is
 *  spent on the final point, which is the one the reader is looking for. */
export function sparkline(values, { w = 132, h = 30, color = MUTED, accent = GOLD, fill = true, title = "" } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const span = max - min || 1;
  const step = w / (v.length - 1);
  const y = (x) => (h - 3 - ((x - min) / span) * (h - 8)).toFixed(2);
  const pts = v.map((x, i) => `${(i * step).toFixed(2)},${y(x)}`).join(" ");
  const area = fill ? `<polygon points="0,${h} ${pts} ${w},${h}" fill="${color}" opacity=".16"/>` : "";
  const last = `<circle cx="${w}" cy="${y(v.at(-1))}" r="2.6" fill="${accent}"/>`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img">${title ? `<title>${esc(title)}</title>` : ""}${area}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${last}</svg>`;
}

// ── stacked / plain columns over time ────────────────────────────────────────
/**
 * rows:   [{ label, values: { key: n } }]   — oldest left
 * keys:   the stack order, bottom → top
 * colors: { key: hex }
 */
export function columns({ rows, keys, colors, height = 168, fmt = compact, unit = "", every, annotations = [], empty = "no data in window" }) {
  if (!rows.length) return `<p class="none">${esc(empty)}</p>`;
  const totals = rows.map((r) => keys.reduce((s, k) => s + (r.values[k] || 0), 0));
  const scale = niceScale(Math.max(...totals));
  const h = PAD_T + height + BAND;
  const slot = plotW / rows.length;
  const cw = Math.min(24, Math.max(2, slot - 2));
  const base = PAD_T + height;

  let bars = "";
  rows.forEach((r, i) => {
    const x = PAD_L + i * slot + (slot - cw) / 2;
    const parts = keys.map((k) => [k, r.values[k] || 0]).filter(([, v]) => v > 0);
    const tip = `${r.label} — ${fmt(totals[i])}${unit}${parts.length ? "\n" + parts.map(([k, v]) => `${k}: ${fmt(v)}`).reverse().join("\n") : ""}`;
    let cum = 0, seg = "";
    parts.forEach(([k, v], j) => {
      const y0 = base - (cum / scale.max) * height;
      const y1 = base - ((cum + v) / scale.max) * height;
      const isTop = j === parts.length - 1;
      const top = isTop ? y1 : Math.min(y1 + 2, y0 - 0.5); // 2px surface gap between segments
      const segH = y0 - top;
      if (segH > 0.3) {
        seg += isTop && segH > 4
          ? `<path d="${roundedTop(x, top, cw, segH, 4)}" fill="${colors[k] || MUTED}"/>`
          : `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${cw.toFixed(1)}" height="${segH.toFixed(1)}" fill="${colors[k] || MUTED}"/>`;
      }
      cum += v;
    });
    bars += `<g class="col"><rect class="hit" x="${(PAD_L + i * slot).toFixed(1)}" y="${PAD_T}" width="${slot.toFixed(1)}" height="${height}" fill="rgba(0,0,0,0)"><title>${esc(tip)}</title></rect>${seg}</g>`;
  });

  // A seam — a date on which the meaning of the series changed — is drawn ON the
  // chart, not written underneath it, so it cannot be read past.
  let ann = "";
  for (const a of annotations) {
    if (!(a.at >= 0 && a.at < rows.length)) continue;
    const x = (PAD_L + a.at * slot).toFixed(1);
    ann += `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${base}" stroke="${DIM}" stroke-width="1" opacity=".6"/>`
      + `<text class="tick" x="${Number(x) + 4}" y="${PAD_T + 9}">${esc(a.text)}</text>`;
  }

  return `${svgOpen(h)}${gridAndAxis(scale, height, fmt)}${ann}${bars}${xLabels(rows.map((r) => r.label), slot, PAD_L, h - 6, every)}</svg>`;
}

// ── lines / area over time ───────────────────────────────────────────────────
/**
 * series: [{ name, color, values: [n] }] aligned to `labels`
 * A single series renders as an area wash and needs no legend — the title names it.
 * annotations: [{ at: index, text }] draws a labelled vertical rule (a seam, a launch).
 */
export function lines({ labels, series, height = 176, fmt = compact, every, annotations = [], unit = "", empty = "no data in window" }) {
  if (!labels.length || !series.length) return `<p class="none">${esc(empty)}</p>`;
  const scale = niceScale(Math.max(1, ...series.flatMap((s) => s.values.filter(Number.isFinite))));
  const h = PAD_T + height + BAND;
  const n = labels.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const X = (i) => PAD_L + i * step;
  const Y = (v) => PAD_T + height - (v / scale.max) * height;

  let ann = "";
  for (const a of annotations) {
    if (!(a.at >= 0 && a.at < n)) continue;
    const x = X(a.at).toFixed(1);
    ann += `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + height}" stroke="${DIM}" stroke-width="1" opacity=".55"/>`
      + `<text class="tick" x="${x}" y="${PAD_T - 3}" text-anchor="middle">${esc(a.text)}</text>`;
  }

  let paths = "";
  for (const s of series) {
    const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    if (series.length === 1) paths += `<polygon points="${X(0).toFixed(1)},${PAD_T + height} ${pts} ${X(n - 1).toFixed(1)},${PAD_T + height}" fill="${s.color}" opacity=".10"/>`;
    paths += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    paths += `<circle cx="${X(n - 1).toFixed(1)}" cy="${Y(s.values.at(-1)).toFixed(1)}" r="4" fill="${s.color}" stroke="${BG}" stroke-width="2"/>`;
  }

  // Direct end-labels, but only where they fit: a label is placed if it clears
  // every label already placed by 11 units. Collisions fall back to the legend.
  let ends = "";
  if (series.length <= 5) {
    const placed = [];
    for (const s of [...series].sort((a, b) => (b.values.at(-1) ?? 0) - (a.values.at(-1) ?? 0))) {
      const y = Y(s.values.at(-1) ?? 0);
      if (placed.some((p) => Math.abs(p - y) < 11)) continue;
      placed.push(y);
      ends += `<text class="endlab" x="${(X(n - 1) - 7).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${esc(fmt(s.values.at(-1) ?? 0))}${esc(unit)}</text>`;
    }
  }

  let hits = "";
  labels.forEach((lab, i) => {
    const tip = `${lab}\n` + series.map((s) => `${s.name}: ${fmt(s.values[i] ?? 0)}${unit}`).join("\n");
    hits += `<rect class="hit" x="${(X(i) - step / 2).toFixed(1)}" y="${PAD_T}" width="${Math.max(step, 6).toFixed(1)}" height="${height}" fill="rgba(0,0,0,0)"><title>${esc(tip)}</title></rect>`;
  });

  return `${svgOpen(h)}${gridAndAxis(scale, height, fmt)}${ann}${paths}${ends}${hits}${xLabels(labels, step, PAD_L - step / 2, h - 6, every)}</svg>`;
}

// ── diverging columns (one measure above the baseline, its opposite below) ───
/** Polarity, not magnitude: `up` is the good side, `down` the bad one. */
export function diverging({ labels, up, down, height = 160, fmt = compact, every }) {
  if (!labels.length) return `<p class="none">nothing in window</p>`;
  // ONE scale, both arms. Splitting the height between two independent maxima
  // would be a dual-axis chart wearing a disguise: a 2-bar and a 40-bar could
  // then be drawn the same length. The arms are sized in proportion to their own
  // maxima so a unit is the same number of pixels above the line and below it.
  const upMax = niceScale(Math.max(1, ...up.values), 2).max;
  const dnMax = niceScale(Math.max(1, ...down.values), 2).max;
  const usable = height - 8;
  const halfU = Math.max(18, (upMax / (upMax + dnMax)) * usable);
  const halfD = Math.max(18, usable - halfU);
  const perUnit = Math.min(halfU / upMax, halfD / dnMax);
  const zero = PAD_T + halfU;
  const h = PAD_T + height + BAND;
  const slot = plotW / labels.length;
  const cw = Math.min(20, Math.max(2, slot - 2));

  let grid = `<line x1="${PAD_L}" y1="${zero}" x2="${W - PAD_R}" y2="${zero}" stroke="${LINE}" stroke-width="1"/>`;
  grid += `<text class="tick" x="${PAD_L - 7}" y="${zero}" text-anchor="end" dominant-baseline="middle">0</text>`;
  for (const [v, y] of [[upMax, zero - upMax * perUnit], [dnMax, zero + dnMax * perUnit]]) {
    grid += `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`;
    grid += `<text class="tick" x="${PAD_L - 7}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${esc(fmt(v))}</text>`;
  }

  let bars = "";
  labels.forEach((lab, i) => {
    const x = PAD_L + i * slot + (slot - cw) / 2;
    const u = up.values[i] || 0, d = down.values[i] || 0;
    if (u > 0) { const hh = u * perUnit; bars += `<path d="${roundedTop(x, zero - hh, cw, hh, 3)}" fill="${up.color}"/>`; }
    if (d > 0) {
      const hh = d * perUnit;
      bars += `<g transform="translate(0 ${(2 * zero).toFixed(1)}) scale(1 -1)"><path d="${roundedTop(x, zero - hh, cw, hh, 3)}" fill="${down.color}"/></g>`;
    }
    bars += `<rect class="hit" x="${(PAD_L + i * slot).toFixed(1)}" y="${PAD_T}" width="${slot.toFixed(1)}" height="${height}" fill="rgba(0,0,0,0)"><title>${esc(`${lab}\n${up.name}: ${u}\n${down.name}: ${d}`)}</title></rect>`;
  });

  return `${svgOpen(h)}${grid}${bars}${xLabels(labels, slot, PAD_L, h - 6, every)}</svg>`;
}

// ── Lorenz curve — the shape of a distribution, with its gini ────────────────
/** values: every member's amount (any order). Renders cumulative share against
 *  the equality diagonal; the gap between the two IS the gini. */
export function lorenz({ values, gini, height = 320, xLabel = "households, poorest → richest", yLabel = "share of supply" }) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 2) return `<p class="none">not enough members to draw a distribution</p>`;
  const total = v.reduce((a, b) => a + b, 0);
  // A Lorenz plot must be square — the equality diagonal is only at 45° if it is,
  // and a stretched diagonal makes the gap read as bigger or smaller than it is.
  // So this one carries its own viewBox rather than the shared 820-unit one.
  const side = height, x0 = PAD_L + 8, y0 = PAD_T;
  const h = PAD_T + side + BAND + 8, boxW = x0 + side + PAD_R + 8;
  const X = (f) => x0 + f * side, Y = (f) => y0 + side - f * side;

  let pts = `${X(0).toFixed(1)},${Y(0).toFixed(1)}`;
  let cum = 0;
  v.forEach((x, i) => { cum += x; pts += ` ${X((i + 1) / v.length).toFixed(1)},${Y(cum / total).toFixed(1)}`; });

  let grid = "";
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    grid += `<line x1="${x0}" y1="${Y(f)}" x2="${X(1)}" y2="${Y(f)}" stroke="${f === 0 ? LINE : GRID}" stroke-width="1"/>`;
    grid += `<text class="tick" x="${x0 - 7}" y="${Y(f)}" text-anchor="end" dominant-baseline="middle">${f * 100}%</text>`;
    grid += `<text class="tick" x="${X(f)}" y="${y0 + side + 14}" text-anchor="middle">${f * 100}%</text>`;
  }
  const diag = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="${DIM}" stroke-width="1.5" stroke-dasharray="0"/>`;
  const curve = `<polygon points="${X(0)},${Y(0)} ${pts.split(" ").slice(1).join(" ")} ${X(1)},${Y(0)}" fill="${SERIES[0]}" opacity=".10"/>`
    + `<polyline points="${pts}" fill="none" stroke="${SERIES[0]}" stroke-width="2" stroke-linejoin="round"/>`;
  // The equality label rides parallel to the diagonal but sits clear of it —
  // set on the line it was unreadable against its own rule.
  const lx = X(0.30), ly = Y(0.30);
  const note = `<text class="endlab" x="${X(0.05)}" y="${Y(0.90)}">gini ${gini.toFixed(3)}</text>`
    + `<text class="tick" x="${lx}" y="${ly}" dy="-8" transform="rotate(-45 ${lx} ${ly})">perfect equality</text>`
    + `<text class="tick" x="${X(0.5)}" y="${y0 + side + BAND + 6}" text-anchor="middle">${esc(xLabel)}</text>`;
  return `${svgOpen(h, "square", boxW)}${grid}${diag}${curve}${note}<title>${esc(`${yLabel} — gini ${gini.toFixed(3)}`)}</title></svg>`;
}

// ── dot strip — a queue's ages, one lane per bucket ──────────────────────────
/** lanes: [{ label, color, dots: [{ x, title }] }] — x in the same unit as xMax. */
export function dotStrip({ lanes, xMax, xUnit = "d", height = 28 }) {
  const live = lanes.filter((l) => l.dots.length);
  if (!live.length) return `<p class="none">the queue is empty</p>`;
  const scale = niceScale(Math.max(1, xMax), 5);
  // Lane names are words, not tick values, so they get a gutter of their own
  // rather than the y-axis's 46 units (which clipped them at first render).
  const gut = 150, laneW = W - gut - PAD_R;
  const h = PAD_T + live.length * height + BAND + 4;
  let grid = "";
  for (const t of scale.ticks) {
    const x = (gut + (t / scale.max) * laneW).toFixed(1);
    grid += `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + live.length * height}" stroke="${t === 0 ? LINE : GRID}" stroke-width="1"/>`;
    grid += `<text class="tick" x="${x}" y="${h - 6}" text-anchor="middle">${t}${esc(xUnit)}</text>`;
  }
  let body = "";
  live.forEach((l, i) => {
    const cy = PAD_T + i * height + height / 2;
    body += `<text class="lane" x="${gut - 10}" y="${cy}" text-anchor="end" dominant-baseline="middle">${esc(l.label)} <tspan class="tick">${l.dots.length}</tspan></text>`;
    body += `<line x1="${gut}" y1="${cy}" x2="${gut + laneW}" y2="${cy}" stroke="${GRID}" stroke-width="1"/>`;
    for (const d of l.dots) {
      const cx = (gut + (Math.min(d.x, scale.max) / scale.max) * laneW).toFixed(1);
      body += `<circle cx="${cx}" cy="${cy}" r="5" fill="${l.color}" stroke="${BG}" stroke-width="2"><title>${esc(d.title)}</title></circle>`;
    }
  });
  return `${svgOpen(h, "strip")}${grid}${body}</svg>`;
}

// ── meter — one ratio against named thresholds ───────────────────────────────
/**
 * One ratio against named thresholds. The reading is set ABOVE the track and
 * the thresholds cross it below, so neither has to dodge the other: an earlier
 * pass put the label inline and it collided with the 26h rule (and, when the
 * fill reached it, sat light-ink-on-amber at about 1.5:1).
 */
export function meter({ value, max, color, ticks = [], valueText, height = 26 }) {
  const top = 18, h = top + height + 18;
  const w = plotW, x0 = PAD_L - 24;
  const f = Math.max(0, Math.min(1, value / (max || 1)));
  let marks = "";
  for (const t of ticks) {
    const x = (x0 + (t.at / (max || 1)) * w).toFixed(1);
    marks += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + height}" stroke="${BG}" stroke-width="2"/>`
      + `<line x1="${x}" y1="${top + height}" x2="${x}" y2="${top + height + 4}" stroke="${DIM}" stroke-width="1"/>`
      + `<text class="tick" x="${x}" y="${h - 3}" text-anchor="middle">${esc(t.label)}</text>`;
  }
  return `${svgOpen(h, "meter")}`
    + `<text class="endlab" x="${x0}" y="${top - 6}">${esc(valueText)}</text>`
    + `<rect x="${x0}" y="${top}" width="${w}" height="${height}" rx="4" fill="${LINE}"/>`
    + `<rect x="${x0}" y="${top}" width="${(f * w).toFixed(1)}" height="${height}" rx="4" fill="${color}"><title>${esc(valueText)}</title></rect>`
    + `${marks}</svg>`;
}

// ── horizontal category bars (HTML — see the header for why) ─────────────────
/**
 * rows: [{ label, values: { key: n }, note?, href? }]
 * keys/colors as in columns(). One key ⇒ one hue for every bar (nominal
 * categories never take a value-ramp — bar length already encodes the value).
 */
export function bars({ rows, keys, colors, fmt = comma, unit = "", max, empty = "nothing to show" }) {
  if (!rows.length) return `<p class="none">${esc(empty)}</p>`;
  const total = (r) => keys.reduce((s, k) => s + (r.values[k] || 0), 0);
  const top = max ?? Math.max(1, ...rows.map(total));
  const out = rows.map((r) => {
    const t = total(r);
    const segs = keys.map((k) => {
      const v = r.values[k] || 0;
      if (!v) return "";
      return `<i style="width:${((v / top) * 100).toFixed(2)}%;background:${colors[k] || SERIES[0]}" title="${esc(`${k}: ${fmt(v)}${unit}`)}"></i>`;
    }).join("");
    const label = r.href ? `<a href="${esc(r.href)}">${esc(clip(r.label, 40))}</a>` : esc(clip(r.label, 40));
    return `<div class="hb" title="${esc(`${r.label} — ${fmt(t)}${unit}${r.note ? ` · ${r.note}` : ""}`)}">`
      + `<span class="hb-l">${label}</span><span class="hb-t">${segs}</span>`
      + `<span class="hb-v">${esc(fmt(t))}${esc(unit)}</span></div>`;
  }).join("");
  return `<div class="hbars">${out}</div>`;
}

// ── chrome pieces ────────────────────────────────────────────────────────────
export const chip = (cls, txt) => `<span class="chip ${cls}">${esc(txt)}</span>`;
export const legend = (items) => items.length < 2 ? "" :
  `<div class="legend">${items.map((i) => `<span class="lg"><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join("")}</div>`;
/** The detail view every chart owes its reader: exact values, collapsed by default. */
export const details = (summary, inner) => `<details class="det"><summary>${esc(summary)}</summary><div class="tablewrap">${inner}</div></details>`;
export const table = (headers, rows) =>
  `<table><thead><tr>${headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

/**
 * The long view: lifetime totals and stock measures. They stay on the page —
 * a town with no memory of its own totals is worse off — but below a rule and
 * under their own heading, so the first read is always what happened lately.
 */
export const longView = (note, body) =>
  `<div class="longview"><p class="longview-head">the long view — lifetime and stock</p>`
  + `<p class="note">${note}</p>${body}</div>`;

/** figure — a chart with its title, legend, note and collapsed table twin. */
export function figure({ title, note, chart, legendItems = [], detail, detailLabel = "the numbers" }) {
  return `<section class="fig"><h2>${esc(title)}</h2>${note ? `<p class="note">${note}</p>` : ""}`
    + `${legend(legendItems)}<div class="plotwrap">${chart}</div>`
    + `${detail ? details(detailLabel, detail) : ""}</section>`;
}

/** KPI row. tiles: [{ label, value, sub?, spark?, status? }] — no hero, several peers. */
export function kpis(tiles) {
  return `<div class="kpis">${tiles.map((t) => `<div class="kpi${t.status ? ` k-${t.status}` : ""}">`
    + `<span class="k-l">${esc(t.label)}</span>`
    + `<span class="k-v">${t.value}</span>`
    + `${t.sub ? `<span class="k-s">${t.sub}</span>` : ""}`
    + `${t.spark ?? ""}</div>`).join("")}</div>`;
}

// The ops family, whole — including the two SITE-built consoles (graph, desk),
// because a nav that lists only the box-generated half tells the reader the
// family is smaller than it is (the graph was unreachable from every dashboard
// until 2026-08-17).
// SOURCE-OF-TRUTH NOTE: this list has a site-side twin in
// `site/src/components/OpsNav.astro`, which chromes the site-built pages; the
// two repos share no import path, so change one, change the other in the same
// act.
const NAV = [
  ["/ops/", "hub"], ["/ops/traffic/", "traffic"], ["/ops/git/", "git"],
  ["/ops/economy/", "economy"], ["/ops/world/", "world"], ["/ops/graph/", "graph"], ["/ops/desk/", "desk"],
];
export const nav = (here) => `<nav class="opsnav">${NAV.map(([h, n]) =>
  `<a href="${h}"${h === here ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav>`;

// ── the stylesheet ───────────────────────────────────────────────────────────
export const CSS = `
:root{--bg:${BG};--panel:${PANEL};--line:${LINE};--grid:${GRID};--ink:${INK};--dim:${DIM};--gold:${GOLD};
--ok:${OK};--warn:${WARN};--bad:${BAD};--muted:${MUTED}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);padding:1.1rem .9rem 3rem;
 font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1060px;margin:0 auto}
a{color:var(--gold)}
h1{font-size:1.05rem;font-weight:600;color:var(--gold);letter-spacing:.06em;margin:0}
h1 small{color:var(--dim);font-weight:400;margin-left:.6em;letter-spacing:0}
h2{font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
 border-bottom:1px solid var(--line);padding-bottom:.35rem;margin:2.1rem 0 .7rem;font-weight:400}
h3{font-size:.82rem;margin:1.1rem 0 .4rem;color:var(--ink);font-weight:600}
.stamp{color:var(--dim);font-size:.72rem;margin:.35rem 0 0}
.note{color:var(--dim);font-size:.76rem;max-width:88ch;margin:.45rem 0 .7rem}
.none{color:var(--dim);font-size:.78rem;font-style:italic;margin:.5rem 0 1rem}
code{color:var(--ink)}

.opsnav{display:flex;flex-wrap:wrap;gap:.3rem;margin:.7rem 0 1.1rem}
.opsnav a{text-decoration:none;color:var(--dim);border:1px solid var(--line);border-radius:999px;
 padding:.16rem .7rem;font-size:.72rem;letter-spacing:.08em}
.opsnav a:hover{color:var(--gold);border-color:var(--gold)}
.opsnav a[aria-current=page]{color:var(--bg);background:var(--gold);border-color:var(--gold)}

.chip{display:inline-block;padding:.08rem .55rem;border-radius:999px;font-size:.72rem;
 border:1px solid var(--line);margin:0 .45rem .3rem 0;color:var(--dim)}
.chip.ok{color:var(--ok);border-color:var(--ok)}
.chip.warn{color:var(--warn);border-color:var(--warn)}
.chip.red{color:var(--bad);border-color:var(--bad)}

/* KPI row — a handful of peers, no hero */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin:.9rem 0 .4rem}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.6rem .75rem .5rem;
 display:flex;flex-direction:column;gap:.1rem;min-width:0}
.kpi .k-l{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.kpi .k-v{font-size:1.6rem;line-height:1.15;color:var(--gold);word-break:break-word}
.kpi .k-s{font-size:.72rem;color:var(--dim)}
.k-d{color:var(--ink)}.k-d.d-good{color:var(--ok)}.k-d.d-bad{color:var(--bad)}
.kpi.k-ok .k-v{color:var(--ok)}.kpi.k-warn .k-v{color:var(--warn)}.kpi.k-red .k-v{color:var(--bad)}
.kpi .spark{margin-top:.35rem;width:100%;height:30px;display:block}

/* plots: a 720-unit viewBox that never renders narrower than 600px, so axis
   text stays legible on a phone; the wrapper scrolls instead. */
.plotwrap{overflow-x:auto;margin:.2rem 0 .3rem;padding-bottom:.2rem}
svg.plot{display:block;width:100%;min-width:620px;max-width:980px;height:auto}
svg.plot.square{max-width:500px;min-width:380px}
svg.plot.meter{max-width:760px}
.plot .tick{fill:var(--dim);font-size:12px;font-family:inherit}
.plot .lane{fill:var(--ink);font-size:12px;font-family:inherit}
.plot .endlab{fill:var(--ink);font-size:12px;font-family:inherit}
.plot .hit:hover{fill:rgba(232,196,139,.07)}

.legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;font-size:.72rem;color:var(--dim);margin:.1rem 0 .45rem}
.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.35rem;vertical-align:baseline}

/* horizontal category bars */
.hbars{display:flex;flex-direction:column;gap:4px;margin:.35rem 0 .5rem;max-width:760px}
.hb{display:grid;grid-template-columns:minmax(78px,30%) 1fr auto;align-items:center;gap:.6rem}
.hb-l{color:var(--ink);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-l a{text-decoration:none}
.hb-t{display:flex;gap:2px;height:13px;background:rgba(255,255,255,.035);border-radius:0 3px 3px 0;min-width:0}
.hb-t i{display:block;height:100%}
.hb-t i:last-child{border-radius:0 4px 4px 0}
.hb-v{color:var(--dim);font-size:.74rem;font-variant-numeric:tabular-nums;text-align:right}

/* the detail view under every chart */
.det{margin:.2rem 0 .4rem;max-width:860px}
.det summary{cursor:pointer;color:var(--dim);font-size:.72rem;letter-spacing:.06em;
 border:1px solid var(--line);border-radius:999px;padding:.1rem .7rem;display:inline-block;list-style:none}
.det summary::-webkit-details-marker{display:none}
.det summary::before{content:"▸ "}
.det[open] summary::before{content:"▾ "}
.det summary:hover{color:var(--gold);border-color:var(--gold)}
.tablewrap{overflow-x:auto;margin:.5rem 0 0}
table{border-collapse:collapse;width:100%;max-width:860px}
td,th{text-align:left;padding:.24rem .7rem .24rem 0;border-bottom:1px dotted var(--line);
 font-size:.76rem;vertical-align:top;font-variant-numeric:tabular-nums}
th{color:var(--dim);font-weight:400;font-size:.68rem;text-transform:uppercase;letter-spacing:.1em}
.num{text-align:right}.dim{color:var(--dim)}.who{color:var(--gold)}

/* the long view — lifetime totals and stock measures, kept but plainly second */
.longview{margin-top:3.2rem;border-top:2px solid var(--line);padding-top:.9rem}
.longview-head{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin:0 0 .3rem}
.longview h2{margin-top:1.6rem}
.fig{margin:0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 2rem}
footer{color:var(--dim);font-size:.72rem;margin-top:2.4rem;border-top:1px solid var(--line);
 padding-top:.8rem;max-width:76ch}
@media (max-width:640px){
  body{padding:.9rem .7rem 2.4rem}
  .kpi .k-v{font-size:1.35rem}
  .hb{grid-template-columns:minmax(64px,34%) 1fr auto}
}
`;

/** The document shell every ops page shares. */
export function page({ title, h1, sub, stamp, here, body, footer, extraCss = "" }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>${CSS}${extraCss}</style></head><body><div class="wrap">
<h1>${esc(h1)}${sub ? ` <small>${esc(sub)}</small>` : ""}</h1>
<div class="stamp">${stamp}</div>
${nav(here)}
${body}
<footer>${footer}</footer>
</div></body></html>`;
}
