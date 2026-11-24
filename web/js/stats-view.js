// Statistics view: stat tiles, games-over-time chart, win-rate lists.
// Everything follows the current filters (it receives the filtered games).

import { h, clear } from "./dom.js";
import { portrait } from "./art.js";
import { computeStats } from "./stats.js";

const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
};

const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "5–5 · incl. 3 abandoned": abandoned games are part of the losses. */
function recordText(r) {
  const parts = [`${r.wins}–${r.losses}`];
  if (r.abandoned) parts.push(`incl. ${r.abandoned} abandoned`);
  return parts.join(" · ");
}

// --- Stat tiles -------------------------------------------------------------

function tile(label, value, sub) {
  return h("div", { class: "stat-tile" },
    h("div", { class: "stat-label" }, label),
    h("div", { class: "stat-value" }, value),
    sub ? h("div", { class: "stat-sub" }, sub) : null);
}

function tiles(st) {
  const cur = st.streaks.current;
  const gameSummary = (g) => `${g.spiritLabel} vs ${g.adversaryLabel}`;
  return h("div", { class: "stat-tiles" },
    tile("Games", st.games, `${st.wins} won · ${st.losses - st.abandoned} lost · ${st.abandoned} abandoned`),
    tile("Win rate", pct(st.winRate),
      st.decided ? `${st.wins} of ${st.decided}${st.abandoned ? " (abandoned count as defeats)" : ""}` : "No games"),
    tile("Current streak",
      !cur.type ? "—" : cur.type === "win" ? plural(cur.length, "win") : `${cur.length} loss${cur.length === 1 ? "" : "es"}`,
      `Best win streak: ${st.streaks.bestWin}`),
    tile("Highest difficulty won",
      st.hardestWin ? st.hardestWin.difficulty : "—",
      st.hardestWin ? gameSummary(st.hardestWin) : "No wins yet"),
    tile("Fastest win",
      st.fastestWin ? plural(st.fastestWin.turn, "turn") : "—",
      st.fastestWin ? gameSummary(st.fastestWin) : "No wins yet"),
    tile("Average difficulty",
      st.avgDifficulty == null ? "—" : (Math.round(st.avgDifficulty * 10) / 10).toLocaleString(),
      null));
}

// --- Games over time (stacked columns) ------------------------------------------

const SERIES = [
  { key: "wins", label: "Wins", cls: "s-win" },
  { key: "defeats", label: "Defeats", cls: "s-loss" },
  { key: "abandoned", label: "Abandoned", cls: "s-abandoned" },
];

function niceStep(max) {
  for (const step of [1, 2, 5, 10, 20, 50, 100]) if (max / step <= 5) return step;
  return Math.ceil(max / 5);
}

function bucketLabel(b, size, long = false) {
  if (size === "month") return b.start.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const day = b.start.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(long ? { year: "numeric" } : {}) });
  return size === "week" ? (long ? `Week of ${day}` : day) : day;
}

/** Path for a column segment with 4px rounded top corners when `round`. */
function segPath(x, y, w, hgt, round) {
  if (!round || hgt < 4) return `M${x},${y + hgt}V${y}H${x + w}V${y + hgt}Z`;
  const r = Math.min(4, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

function timelineChart(tl) {
  const wrap = h("div", { class: "chart" });
  const tooltip = h("div", { class: "chart-tip", role: "status", hidden: true });
  const legend = h("div", { class: "legend" },
    SERIES.map((sr) => h("span", { class: "legend-item" }, h("span", { class: `swatch ${sr.cls}` }), sr.label)));
  const svgHolder = h("div", { class: "chart-plot" });
  wrap.append(legend, svgHolder, tooltip);

  const draw = () => {
    if (!svgHolder.isConnected) { ro.disconnect(); return; } // view was replaced
    const width = Math.max(280, svgHolder.clientWidth || 600);
    const height = 190;
    const m = { top: 10, right: 8, bottom: 26, left: 30 };
    const pw = width - m.left - m.right;
    const ph = height - m.top - m.bottom;
    const n = tl.buckets.length;
    const maxTotal = Math.max(1, ...tl.buckets.map((b) => b.total));
    const step = niceStep(maxTotal);
    const yMax = Math.ceil(maxTotal / step) * step;
    const y = (v) => m.top + ph - (v / yMax) * ph;
    const band = pw / n;
    const bw = Math.max(3, Math.min(24, band * 0.7));

    const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img",
      "aria-label": `Games per ${tl.size}, split into wins, defeats and abandoned games. The table below lists every value.` });

    // Gridlines + y ticks
    for (let v = 0; v <= yMax; v += step) {
      svg.append(s("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }));
      svg.append(s("text", { x: m.left - 6, y: y(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, v));
    }
    // X labels: thin them out so they never overlap
    const every = Math.max(1, Math.ceil(52 / band));
    tl.buckets.forEach((b, i) => {
      if (i % every === 0 || i === n - 1 && n - 1 - (Math.floor((n - 1) / every) * every) >= every / 2) {
        svg.append(s("text", { x: m.left + band * i + band / 2, y: height - 8, class: "tick", "text-anchor": "middle" }, bucketLabel(b, tl.size)));
      }
    });

    // Columns: wins at the bottom, 2px surface gap between segments, rounded top
    tl.buckets.forEach((b, i) => {
      const x = m.left + band * i + (band - bw) / 2;
      let acc = 0;
      const present = SERIES.filter((sr) => b[sr.key] > 0);
      present.forEach((sr, j) => {
        const v = b[sr.key];
        const top = y(acc + v);
        const bottom = y(acc);
        const gap = j > 0 ? 2 : 0;
        svg.append(s("path", { d: segPath(x, top, bw, Math.max(0, bottom - top - gap), j === present.length - 1), class: `seg ${sr.cls}` }));
        acc += v;
      });
      // Hover target: the whole band, taller than the mark
      const hit = s("rect", { x: m.left + band * i, y: m.top, width: band, height: ph, class: "hit" });
      hit.addEventListener("mouseenter", () => showTip(b, m.left + band * i + band / 2));
      hit.addEventListener("mouseleave", () => { tooltip.hidden = true; hit.classList.remove("on"); });
      hit.addEventListener("mouseenter", () => hit.classList.add("on"));
      svg.append(hit);
    });
    clear(svgHolder).append(svg);
  };

  const showTip = (b, cx) => {
    const rows = b.total
      ? SERIES.filter((sr) => b[sr.key]).map((sr) =>
          h("div", { class: "tip-row" }, h("span", { class: `swatch ${sr.cls}` }), sr.label, h("b", null, b[sr.key])))
      : [h("div", { class: "tip-row muted" }, "No games")];
    clear(tooltip).append(h("div", { class: "tip-title" }, bucketLabel(b, tl.size, true)), ...rows);
    tooltip.hidden = false;
    // Beside the column (right of it, or left near the edge) so it never covers the bar.
    const w = tooltip.offsetWidth;
    const right = cx + 18;
    tooltip.style.left = `${right + w <= svgHolder.clientWidth ? right : Math.max(0, cx - 18 - w)}px`;
  };

  // Table view: every value, for screen readers and exact reading
  const table = h("details", { class: "chart-table" },
    h("summary", null, "Show as table"),
    h("table", { class: "data-table" },
      h("thead", null, h("tr", null, h("th", null, tl.size === "day" ? "Day" : tl.size === "week" ? "Week of" : "Month"),
        SERIES.map((sr) => h("th", { class: "num" }, sr.label)), h("th", { class: "num" }, "Total"))),
      h("tbody", null, tl.buckets.filter((b) => b.total).map((b) => h("tr", null,
        h("td", null, bucketLabel(b, tl.size, true)),
        SERIES.map((sr) => h("td", { class: "num" }, b[sr.key])),
        h("td", { class: "num" }, b.total))))));
  wrap.append(table);

  let lastWidth = 0;
  const ro = new ResizeObserver(() => {
    if (svgHolder.clientWidth !== lastWidth) { lastWidth = svgHolder.clientWidth; requestAnimationFrame(draw); }
  });
  ro.observe(svgHolder);
  return wrap;
}

// --- Win-rate lists (meter list) ------------------------------------------------

/**
 * One row per group: name, record, a bar showing the win rate, the % figure.
 * Clicking a row filters the history to it (when onPick is given).
 */
function meterList(rows, { art, onPick, pickLabel } = {}) {
  return h("ul", { class: "meter-list" }, rows.map((r) => {
    const content = [
      art ? art(r) : null,
      h("span", { class: "meter-name" },
        h("span", { class: "meter-title" }, r.label),
        h("span", { class: "meter-sub" }, recordText(r))),
      h("span", { class: "meter-track", "aria-hidden": "true" },
        r.winRate == null ? null : h("span", { class: "meter-fill", style: `width:${(r.winRate * 100).toFixed(1)}%` })),
      h("span", { class: "meter-figure" }, pct(r.winRate)),
    ];
    const label = `${r.label}: ${pct(r.winRate)} win rate, ${r.wins} wins, ${r.losses} losses${r.abandoned ? `, ${r.abandoned} abandoned` : ""}`;
    return h("li", null, onPick
      ? h("button", { type: "button", class: "meter-row", title: pickLabel, "aria-label": `${label}. ${pickLabel}`, onclick: () => onPick(r) }, content)
      : h("div", { class: "meter-row", "aria-label": label }, content));
  }));
}

/** How games ended: ranked bars, colored by win / defeat / abandoned like the chart. */
function endingBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.games));
  const cls = { win: "s-win", loss: "s-loss", abandoned: "s-abandoned" };
  return h("ul", { class: "bar-list" }, rows.map((r) =>
    h("li", { class: "bar-row", title: `${r.label}: ${plural(r.games, "game")}` },
      h("span", { class: "bar-name" }, r.label),
      h("span", { class: "bar-track" },
        h("span", { class: `bar-fill ${cls[r.extra.outcome]}`, style: `width:${(r.games / max * 100).toFixed(1)}%` }),
        h("span", { class: "bar-value" }, r.games)))));
}

function card(title, sub, body, cls = "") {
  return h("section", { class: `stat-card ${cls}` },
    h("div", { class: "stat-card-head" }, h("h3", null, title), sub ? h("span", { class: "muted small" }, sub) : null),
    body);
}

/**
 * @param {HTMLElement} container
 * @param {object[]} games   the filtered games
 * @param {{ onFilter(mutate) }} opts
 */
export function renderStats(container, games, { onFilter }) {
  clear(container);
  // Abandoned games count as defeats (use the "Hide abandoned games" filter to leave them out).
  const st = computeStats(games, { abandonedAsLoss: true });

  const winBarNote = "Bar = win rate";
  const list = meterList;

  container.append(
    tiles(st),
    card("Games over time", `per ${st.timeline.size}`, timelineChart(st.timeline), "wide"),
    h("div", { class: "stat-grid" },
      card("By spirit", winBarNote, list(st.bySpirit, {
        art: (r) => portrait("spirits", r.extra.id, r.extra.name, 28),
        pickLabel: "Show only games with this spirit",
        onPick: (r) => onFilter((f) => { f.spirits.clear(); f.aspects.clear(); f.spirits.add(r.key); }),
      })),
      card("By adversary", winBarNote, list(st.byAdversary, {
        art: (r) => (r.extra ? portrait("adversaries", r.extra.id, r.extra.name, 28, r.extra.short) : h("span", { class: "portrait-spacer" })),
        pickLabel: "Show only games against this adversary and level",
        onPick: (r) => onFilter((f) => {
          f.adversaries.clear();
          if (!r.extra) { f.adversaries.add("none"); f.advLevel = [null, null]; return; }
          f.adversaries.add(r.extra.id);
          const level = r.key.split("|")[1];
          f.advLevel = level === "" ? [null, null] : [Number(level), Number(level)];
        }),
      })),
      card("By difficulty", winBarNote, list(st.byDifficulty, {
        pickLabel: "Show only games at this difficulty",
        onPick: (r) => onFilter((f) => { f.difficulty = [r.key, r.key]; }),
      })),
      st.bySpiritCount.length > 1
        ? card("By number of spirits", winBarNote, list(st.bySpiritCount, {
            pickLabel: "Show only games with this many spirits",
            onPick: (r) => onFilter((f) => { f.spiritCounts.clear(); f.spiritCounts.add(r.key); }),
          }))
        : null,
      card("How games ended", null, endingBars(st.endings))),
  );
  return st;
}
