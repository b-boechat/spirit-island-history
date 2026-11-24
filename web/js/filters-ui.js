// The filter sidebar and the "active filter" chips above the list.
//
// buildSidebar() creates the controls once per set of games (options come from
// the games, so they change when you switch device). It returns update(f),
// which refreshes counts / checked states in place after each filter change,
// so typing in the search box never loses focus.

import { h, clear } from "./dom.js";
import { portrait } from "./art.js";
import {
  FACETS, NONE, applyFilters, facetOptions, outcomeCounts, bounds, activeFilterCount,
  spiritEntries, spiritOfAspectKey,
} from "./filters.js";

const PORTRAIT_FACETS = { spirits: "spirits", adversaries: "adversaries", supporting: "adversaries" };

// Sidebar order. "more: true" groups start collapsed unless in use.
// Aspects have no group of their own: they're listed under their spirit.
const LAYOUT = [
  { facet: "spirits" },
  { facet: "spiritCounts" },
  { facet: "adversaries", extra: "advLevel" },
  { range: "difficulty", label: "Difficulty" },
  { range: "date", label: "Date played" },
  { facet: "reasons" },
  { facet: "supporting", more: true },
  { facet: "scenarios", more: true },
  { facet: "boards", more: true },
  { facet: "layouts", more: true },
  { blight: true, label: "Blight card", more: true },
];

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * @param {HTMLElement} container  the <aside>
 * @param {object[]} allGames      every game of the current device(s)
 * @param {object} f               current filters (used for initial values)
 * @param {(mutate: (f) => void) => void} onChange
 * @param {{ falseStarts?: { hidden: boolean, count: number, onToggle(hide: boolean) } }} [opts]
 *        falseStarts: the "hide false starts" switch. It's a setting rather than
 *        a filter, so "Clear all" leaves it alone.
 * @returns {(f) => void} update
 */
export function buildSidebar(container, allGames, f, onChange, opts = {}) {
  clear(container);
  const refs = { facets: {}, groups: {} };
  const b = bounds(allGames);
  const initialOptions = facetOptions(allGames, f);

  // Header
  const clearBtn = h("button", { type: "button", class: "btn btn-small", onclick: () => onChange((x) => x.reset = true) }, "Clear all");
  container.append(h("div", { class: "filters-head" }, h("h2", null, "Filters"), clearBtn));

  // Search
  const search = h("input", {
    type: "search", class: "filter-search", placeholder: "Search spirits, cards, adversaries…",
    "aria-label": "Search games", value: f.q,
  });
  search.addEventListener("input", debounce(() => onChange((x) => { x.q = search.value; }), 150));
  container.append(search);

  // Outcome
  const outcomeBtns = {};
  const outcomeRow = h("div", { class: "segmented", role: "group", "aria-label": "Result" },
    ["all", "win", "loss"].map((value) => {
      const count = h("span", { class: "count" });
      const btn = h("button", {
        type: "button", class: "seg",
        onclick: () => onChange((x) => { x.outcome = value; }),
      }, { all: "All", win: "Wins", loss: "Losses" }[value], " ", count);
      outcomeBtns[value] = { btn, count };
      return btn;
    }));
  const hideAbandoned = h("input", { type: "checkbox", "aria-label": "Hide abandoned games" });
  hideAbandoned.addEventListener("change", () => onChange((x) => { x.hideAbandoned = hideAbandoned.checked; }));
  let falseStartsRow = null;
  if (opts.falseStarts?.count) {
    const fs = opts.falseStarts;
    const box = h("input", { type: "checkbox", checked: fs.hidden, "aria-label": "Hide false starts (games abandoned on turn 0)" });
    box.addEventListener("change", () => fs.onToggle(box.checked));
    falseStartsRow = h("label", { class: "opt opt-toggle", title: "Games abandoned on turn 0, usually a start with the wrong setup" },
      box, h("span", { class: "label" }, "Hide false starts (abandoned on turn 0)"), h("span", { class: "count" }, fs.count));
  }
  container.append(h("div", { class: "fgroup-plain" },
    h("div", { class: "flabel" }, "Result"),
    outcomeRow,
    h("label", { class: "opt opt-toggle" }, hideAbandoned, h("span", { class: "label" }, "Hide abandoned games")),
    falseStartsRow));

  for (const item of LAYOUT) {
    if (item.facet) {
      const options = initialOptions[item.facet];
      const selected = f[item.facet];
      // Add selected values that aren't in these games (e.g. from a link for another device).
      for (const v of selected) if (!options.some((o) => o.value === v)) options.push({ value: v, label: String(v), count: 0 });
      // Skip a facet that can't narrow anything down: every game has the same
      // single value (e.g. no game has a supporting adversary).
      const useless = options.length === 0
        || (options.length === 1 && allGames.every((g) => FACETS[item.facet].values(g).includes(options[0].value)));
      // (A single spirit can still be narrowed down by its aspects.)
      const hasAspects = item.facet === "spirits" && initialOptions.aspects.some((o) => !o.value.endsWith("/"));
      if (useless && !selected.size && !hasAspects) continue;
      container.append(facetGroup(item, options, f, onChange, refs, initialOptions));
    } else if (item.range) {
      container.append(rangeGroup(item, b[item.range], f, onChange, refs));
    } else if (item.blight) {
      if (!allGames.some((g) => g.blight.flipped) || allGames.every((g) => g.blight.flipped)) continue;
      container.append(blightGroup(item, f, onChange, refs));
    }
  }

  // Phones: the panel sits above the list; this closes it and jumps to the results.
  const showBtn = h("button", { type: "button", class: "btn btn-primary show-results", onclick: () => onChange((x) => { x.closePanel = true; }) });
  container.append(showBtn);

  return function update(f2) {
    const matching = applyFilters(allGames, f2).length;
    showBtn.textContent = `Show ${matching} game${matching === 1 ? "" : "s"}`;
    const n = activeFilterCount(f2);
    clearBtn.disabled = n === 0;
    clearBtn.textContent = n ? `Clear all (${n})` : "Clear all";
    if (document.activeElement !== search && search.value !== f2.q) search.value = f2.q;

    const oc = outcomeCounts(allGames, f2);
    for (const [value, { btn, count }] of Object.entries(outcomeBtns)) {
      btn.setAttribute("aria-pressed", String(f2.outcome === value));
      count.textContent = oc[value];
    }
    hideAbandoned.checked = f2.hideAbandoned;

    const options = facetOptions(allGames, f2);
    for (const [key, items] of Object.entries(refs.facets)) {
      const counts = new Map(options[key].map((o) => [o.value, o.count]));
      for (const [value, { input, count, row }] of items) {
        const c = counts.get(value) ?? 0;
        input.checked = f2[key].has(value);
        count.textContent = c;
        row.classList.toggle("dim", c === 0 && !input.checked);
      }
      refs.groups[key]?.dot(f2[key].size > 0);
    }
    // A spirit with some of its aspects ticked shows a dash (partly selected).
    for (const [spiritId, { input }] of refs.facets.spirits ?? []) {
      input.indeterminate = !input.checked && [...f2.aspects].some((k) => spiritOfAspectKey(k) === spiritId);
    }
    refs.groups.spirits?.dot(f2.spirits.size > 0 || f2.aspects.size > 0);
    if (refs.spiritMode) {
      refs.spiritMode.wrap.hidden = spiritEntries(f2).size < 2;
      refs.spiritMode.any.checked = f2.spiritMode === "any";
      refs.spiritMode.all.checked = f2.spiritMode === "all";
    }
    for (const key of ["difficulty", "date", "advLevel"]) {
      const r = refs[key];
      if (!r) continue;
      const vals = f2[key];
      for (let i = 0; i < 2; i++) {
        const want = vals[i] == null ? "" : String(vals[i]);
        if (document.activeElement !== r.inputs[i] && r.inputs[i].value !== want) r.inputs[i].value = want;
      }
      r.dot?.(vals.some((v) => v != null && v !== ""));
    }
    if (refs.blight) {
      for (const [value, input] of Object.entries(refs.blight.inputs)) input.checked = f2.blight === value;
      refs.blight.dot(f2.blight !== "all");
    }
  };
}

function group(label, more, active) {
  const dot = h("span", { class: "active-dot", "aria-hidden": "true", hidden: true });
  const details = h("details", { class: "fgroup", open: !more || active },
    h("summary", null, label, dot));
  return { details, dot: (on) => { dot.hidden = !on; } };
}

function facetGroup(item, options, f, onChange, refs, allOptions) {
  const key = item.facet;
  const facet = FACETS[key];
  const { details, dot } = group(facet.label, item.more, f[key].size > 0 || (key === "spirits" && f.aspects.size > 0));
  refs.groups[key] = { dot };
  const items = new Map();
  const aspectItems = new Map();
  const list = h("div", { class: `opt-list ${options.length > 8 ? "scroll" : ""}` });
  for (const o of options) {
    const input = h("input", { type: "checkbox", value: String(o.value), "aria-label": o.label });
    input.addEventListener("change", () => onChange((x) => {
      if (input.checked) {
        x[key].add(o.value);
        // Ticking a spirit means "any version": drop any narrower aspect ticks.
        if (key === "spirits") for (const k of [...x.aspects]) if (spiritOfAspectKey(k) === o.value) x.aspects.delete(k);
      } else {
        x[key].delete(o.value);
      }
    }));
    const count = h("span", { class: "count" }, o.count);
    const art = PORTRAIT_FACETS[key] && o.value !== NONE
      ? portrait(PORTRAIT_FACETS[key], o.value, o.label, 22)
      : null;
    const row = h("label", { class: "opt" }, input, art, h("span", { class: "label" }, o.label), count);
    items.set(o.value, { input, count, row });
    list.append(row);

    // Aspects, nested under their spirit (only for spirits played with an aspect).
    if (key === "spirits") {
      const children = allOptions.aspects.filter((a) => spiritOfAspectKey(a.value) === o.value);
      if (!children.some((a) => !a.value.endsWith("/"))) continue;
      for (const a of children) {
        const childInput = h("input", { type: "checkbox", value: a.value, "aria-label": `${o.label}: ${a.label}` });
        childInput.addEventListener("change", () => onChange((x) => {
          if (childInput.checked) {
            x.aspects.add(a.value);
            x.spirits.delete(o.value); // the aspect narrows the spirit down
          } else {
            x.aspects.delete(a.value);
          }
        }));
        const childCount = h("span", { class: "count" }, a.count);
        const childArt = a.value.endsWith("/") ? null : portrait("aspects", a.value.split("/")[1], a.label, 18);
        const childRow = h("label", { class: "opt opt-child" },
          childInput, childArt, h("span", { class: "label" }, a.label), childCount);
        aspectItems.set(a.value, { input: childInput, count: childCount, row: childRow });
        list.append(childRow);
      }
    }
  }
  refs.facets[key] = items;
  if (aspectItems.size) refs.facets.aspects = aspectItems;
  details.append(list);

  if (key === "spirits") {
    const any = h("input", { type: "radio", name: "spirit-mode", value: "any" });
    const all = h("input", { type: "radio", name: "spirit-mode", value: "all" });
    any.addEventListener("change", () => onChange((x) => { x.spiritMode = "any"; }));
    all.addEventListener("change", () => onChange((x) => { x.spiritMode = "all"; }));
    const wrap = h("div", { class: "spirit-mode small", hidden: true },
      h("label", null, any, " Any of these"),
      h("label", null, all, " All together"));
    refs.spiritMode = { wrap, any, all };
    details.append(wrap);
  }
  if (item.extra === "advLevel") {
    details.append(levelRange(f, onChange, refs));
  }
  return details;
}

function levelRange(f, onChange, refs) {
  const mk = (i) => {
    const sel = h("select", { "aria-label": i === 0 ? "Minimum adversary level" : "Maximum adversary level" },
      h("option", { value: "" }, i === 0 ? "Any" : "Any"),
      [0, 1, 2, 3, 4, 5, 6].map((n) => h("option", { value: String(n) }, n)));
    sel.value = f.advLevel[i] == null ? "" : String(f.advLevel[i]);
    sel.addEventListener("change", () => onChange((x) => { x.advLevel[i] = sel.value === "" ? null : Number(sel.value); }));
    return sel;
  };
  const inputs = [mk(0), mk(1)];
  refs.advLevel = { inputs };
  return h("div", { class: "range-row" }, h("span", { class: "flabel-inline" }, "Level"), inputs[0], h("span", null, "to"), inputs[1]);
}

function rangeGroup(item, [lo, hi], f, onChange, refs) {
  const key = item.range;
  const isDate = key === "date";
  const active = f[key].some((v) => v != null && v !== "");
  const { details, dot } = group(item.label, false, active);
  const mk = (i) => {
    const input = h("input", isDate
      ? { type: "date", min: lo, max: hi, "aria-label": i === 0 ? "From date" : "To date" }
      : { type: "number", min: 0, max: 20, step: 1, placeholder: String(i === 0 ? lo : hi), inputmode: "numeric", "aria-label": i === 0 ? "Minimum difficulty" : "Maximum difficulty" });
    input.value = f[key][i] == null ? "" : String(f[key][i]);
    const apply = () => onChange((x) => {
      x[key][i] = isDate ? input.value : (input.value === "" ? null : Number(input.value));
    });
    input.addEventListener("change", apply);
    if (!isDate) input.addEventListener("input", debounce(apply, 300));
    return input;
  };
  const inputs = [mk(0), mk(1)];
  refs[key] = { inputs, dot };
  details.append(h("div", { class: `range-row ${isDate ? "dates" : ""}` }, inputs[0], h("span", null, "to"), inputs[1]));
  return details;
}

function blightGroup(item, f, onChange, refs) {
  const { details, dot } = group(item.label, item.more, f.blight !== "all");
  const inputs = {};
  const row = h("div", { class: "opt-list" },
    [["all", "Any"], ["flipped", "Flipped during the game"], ["not", "Never flipped"]].map(([value, label]) => {
      const input = h("input", { type: "radio", name: "blight", value });
      input.addEventListener("change", () => onChange((x) => { x.blight = value; }));
      inputs[value] = input;
      return h("label", { class: "opt" }, input, h("span", { class: "label" }, label));
    }));
  refs.blight = { inputs, dot };
  details.append(row);
  return details;
}

// --- Active filter chips -------------------------------------------------------

/** Removable chips describing the filters in use. */
export function renderChips(container, allGames, f, onChange) {
  clear(container);
  const chips = [];
  const chip = (text, remove) => chips.push(h("button", {
    type: "button", class: "chip", title: "Remove this filter", onclick: () => onChange(remove),
  }, text, h("span", { "aria-hidden": "true" }, " ✕")));

  if (f.q.trim()) chip(`“${f.q.trim()}”`, (x) => { x.q = ""; });
  if (f.outcome !== "all") chip(f.outcome === "win" ? "Wins" : "Losses", (x) => { x.outcome = "all"; });
  if (f.hideAbandoned) chip("No abandoned", (x) => { x.hideAbandoned = false; });

  const labels = {};
  for (const [key, facet] of Object.entries(FACETS)) {
    labels[key] = new Map();
    for (const g of allGames) for (const [v, l] of facet.labels(g)) labels[key].set(v, l);
  }
  for (const key of Object.keys(FACETS)) {
    for (const v of f[key]) {
      let text = labels[key].get(v) ?? v;
      if (key === "supporting") text = `Support: ${text}`;
      if (key === "aspects") {
        const spirit = labels.spirits.get(spiritOfAspectKey(v)) ?? spiritOfAspectKey(v);
        text = v.endsWith("/") ? `${spirit} (no aspect)` : `${spirit} — ${text}`;
      }
      chip(text, (x) => { x[key].delete(v); });
    }
  }
  if (spiritEntries(f).size > 1 && f.spiritMode === "all") chip("Spirits together", (x) => { x.spiritMode = "any"; });

  const range = (name, [a, b], fmt = (v) => v) => {
    if ((a == null || a === "") && (b == null || b === "")) return null;
    if (a != null && a !== "" && b != null && b !== "") return a === b ? `${name} ${fmt(a)}` : `${name} ${fmt(a)}–${fmt(b)}`;
    return a != null && a !== "" ? `${name} ≥ ${fmt(a)}` : `${name} ≤ ${fmt(b)}`;
  };
  const fmtDate = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const lv = range("Level", f.advLevel);
  if (lv) chip(lv, (x) => { x.advLevel = [null, null]; });
  const df = range("Difficulty", f.difficulty);
  if (df) chip(df, (x) => { x.difficulty = [null, null]; });
  const dt = range("Played", f.date, fmtDate);
  if (dt) chip(dt, (x) => { x.date = ["", ""]; });
  if (f.blight !== "all") chip(f.blight === "flipped" ? "Blight flipped" : "Blight not flipped", (x) => { x.blight = "all"; });

  container.hidden = chips.length === 0;
  if (chips.length) {
    container.append(...chips, h("button", { type: "button", class: "chip chip-clear", onclick: () => onChange((x) => x.reset = true) }, "Clear all"));
  }
}
