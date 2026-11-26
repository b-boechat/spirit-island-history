// Filtering and sorting of normalized games, plus URL (de)serialization.
// Pure logic only; the sidebar UI lives in filters-ui.js.

export const NONE = "none"; // option value for "no adversary" / "no supporting adversary"

// --- Sorting ---------------------------------------------------------------

const resultRank = (g) => (g.isWin ? 2 : g.abandoned ? 0 : 1);

// Each sort key maps a game to a comparable value (number or string).
export const SORTS = {
  date: { label: "Date", value: (g) => g.date?.getTime() ?? null, firstDir: "desc" },
  spirits: { label: "Spirits", value: (g) => g.spiritLabel.toLowerCase(), firstDir: "asc" },
  adversary: {
    label: "Adversary",
    value: (g) => (g.adversary ? `${g.adversary.short.toLowerCase()}|${String(g.adversary.level ?? 0).padStart(2, "0")}` : null),
    firstDir: "asc",
  },
  difficulty: { label: "Difficulty", value: (g) => g.difficulty, firstDir: "desc" },
  result: { label: "Result", value: (g) => `${resultRank(g)}|${g.reason}`, firstDir: "desc" },
  turn: { label: "Turns", value: (g) => g.turn, firstDir: "asc" },
};

export const DEFAULT_SORT = { key: "date", dir: "desc" };

/** "difficulty-desc" -> { key, dir }; falls back to the default. */
export function parseSort(text) {
  const [key, dir] = String(text ?? "").split("-");
  return SORTS[key] && (dir === "asc" || dir === "desc") ? { key, dir } : { ...DEFAULT_SORT };
}

export const formatSort = ({ key, dir }) => `${key}-${dir}`;

/** Returns a new sorted array. Missing values always go last; ties fall back to newest first. */
export function sortGames(games, { key, dir }) {
  const value = (SORTS[key] ?? SORTS.date).value;
  const sign = dir === "asc" ? 1 : -1;
  const newest = (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  return [...games].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return newest(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return cmp !== 0 ? cmp * sign : newest(a, b);
  });
}

// --- Facets (multi-select filters) ------------------------------------------
// Each facet lists the values a game has; a game matches when it has any of
// the selected values (or all of them, for spirits in "all" mode).

/** "ShroudOfSilentMist/Stranded", or "ShroudOfSilentMist/" without an aspect. */
export const aspectKey = (spirit) => `${spirit.id}/${spirit.aspect?.id ?? ""}`;
export const spiritOfAspectKey = (key) => key.slice(0, key.indexOf("/"));

export const FACETS = {
  spirits: {
    label: "Spirits",
    param: "spirit",
    values: (g) => g.spirits.map((s) => s.id),
    labels: (g) => g.spirits.map((s) => [s.id, s.name]),
  },
  spiritCounts: {
    label: "Number of spirits",
    param: "count",
    numeric: true,
    values: (g) => [g.spiritCount],
    labels: (g) => [[g.spiritCount, `${g.spiritCount} spirit${g.spiritCount === 1 ? "" : "s"}`]],
  },
  // Aspects are shown nested under their spirit, and refine it: the value is
  // "<SpiritId>/<AspectId>", or "<SpiritId>/" for the spirit played without one.
  aspects: {
    label: "Aspects",
    param: "aspect",
    values: (g) => g.spirits.map(aspectKey),
    labels: (g) => g.spirits.map((s) => [aspectKey(s), s.aspect ? s.aspect.name : "Base (no aspect)"]),
    order: (g, value) => (value.endsWith("/") ? 0 : 1),
  },
  adversaries: {
    label: "Adversary",
    param: "adv",
    values: (g) => [g.adversary?.id ?? NONE],
    labels: (g) => [g.adversary ? [g.adversary.id, g.adversary.short] : [NONE, "No adversary"]],
  },
  supporting: {
    label: "Supporting adversary",
    param: "support",
    values: (g) => [g.supportingAdversary?.id ?? NONE],
    labels: (g) => [g.supportingAdversary ? [g.supportingAdversary.id, g.supportingAdversary.short] : [NONE, "None"]],
  },
  scenarios: {
    label: "Scenario",
    param: "scenario",
    values: (g) => [g.scenario?.id ?? NONE],
    labels: (g) => [g.scenario ? [g.scenario.id, g.scenario.name] : [NONE, "No scenario"]],
  },
  reasons: {
    label: "How it ended",
    param: "reason",
    values: (g) => [g.resultId ?? NONE],
    labels: (g) => [[g.resultId ?? NONE, g.reason]],
    order: (g) => (g.isWin ? 0 : g.abandoned ? 2 : 1),
  },
  boards: {
    label: "Boards",
    param: "board",
    values: (g) => g.boards,
    labels: (g) => g.boards.map((b) => [b, `Board ${b}`]),
  },
  layouts: {
    label: "Layout",
    param: "layout",
    values: (g) => (g.layout ? [g.layout] : []),
    labels: (g) => (g.layout ? [[g.layout, g.layout]] : []),
  },
};

// --- Filter state ------------------------------------------------------------

export function emptyFilters() {
  const f = {
    q: "",
    outcome: "all",          // "all" | "win" | "loss"
    hideAbandoned: false,
    spiritMode: "any",       // "any" | "all"
    advLevel: [null, null],  // [min, max]
    difficulty: [null, null],
    date: ["", ""],          // ["YYYY-MM-DD", "YYYY-MM-DD"], local dates
    blight: "all",           // "all" | "flipped" | "not"
  };
  for (const key of Object.keys(FACETS)) f[key] = new Set();
  return f;
}

const inRange = (v, [min, max]) =>
  (min == null || (v != null && v >= min)) && (max == null || (v != null && v <= max));

function searchText(g) {
  return (g._search ??= [
    g.spiritLabel,
    ...g.spirits.map((s) => s.aspect?.name ?? ""),
    g.adversary?.name, g.adversary?.short,
    g.supportingAdversary?.name, g.supportingAdversary?.short,
    g.scenario?.name,
    g.reason,
    g.blight.card?.name,
    ...Object.values(g.powerCards.owned).flat().map((c) => c.name),
    ...g.powerCards.discard.map((c) => c.name),
    g.device?.name,
  ].filter(Boolean).join(" \u0001 ").toLowerCase());
}

/** Single-value filters: name -> { active(f), test(g, f) }. */
const SCALARS = {
  q: {
    active: (f) => f.q.trim() !== "",
    test: (g, f) => f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => searchText(g).includes(t)),
  },
  outcome: {
    active: (f) => f.outcome !== "all",
    test: (g, f) => (f.outcome === "win" ? g.isWin : !g.isWin),
  },
  hideAbandoned: { active: (f) => f.hideAbandoned, test: (g) => !g.abandoned },
  advLevel: {
    active: (f) => f.advLevel.some((v) => v != null),
    test: (g, f) => inRange(g.adversary?.level ?? null, f.advLevel),
  },
  difficulty: {
    active: (f) => f.difficulty.some((v) => v != null),
    test: (g, f) => inRange(g.difficulty, f.difficulty),
  },
  date: {
    active: (f) => f.date.some(Boolean),
    test: (g, f) => (!f.date[0] || (g.dayKey && g.dayKey >= f.date[0])) && (!f.date[1] || (g.dayKey && g.dayKey <= f.date[1])),
  },
  blight: {
    active: (f) => f.blight !== "all",
    test: (g, f) => (f.blight === "flipped" ? g.blight.flipped : !g.blight.flipped),
  },
};

// Spirits and aspects form one tree, filtered together.
const SPIRIT_TREE = new Set(["spirits", "aspects"]);

/**
 * The spirit tree as entries: spiritId -> null (any version of that spirit)
 * or a Set of aspect keys (only those versions). Ticking an aspect refines
 * its spirit, so it wins over the spirit itself being ticked.
 */
export function spiritEntries(f) {
  const entries = new Map();
  for (const id of f.spirits) entries.set(id, null);
  for (const key of f.aspects) {
    const id = spiritOfAspectKey(key);
    const set = entries.get(id) ?? new Set();
    set.add(key);
    entries.set(id, set);
  }
  return entries;
}

function spiritTreeTest(g, f) {
  const entries = spiritEntries(f);
  if (!entries.size) return true;
  const matches = ([id, keys]) => g.spirits.some((s) => s.id === id && (keys === null || keys.has(aspectKey(s))));
  const list = [...entries];
  return f.spiritMode === "all" ? list.every(matches) : list.some(matches);
}

function facetTest(key, g, f) {
  const selected = f[key];
  if (!selected.size) return true;
  return FACETS[key].values(g).some((v) => selected.has(v));
}

/**
 * Games matching every filter. "except" (a filter name, or several) is
 * ignored: used to count what each option of that filter would match.
 */
export function applyFilters(games, f, except = null) {
  const skip = new Set([].concat(except ?? []));
  // Leaving out either half of the spirit tree leaves out the whole tree.
  const skipTree = [...SPIRIT_TREE].some((k) => skip.has(k));
  return games.filter((g) => {
    for (const [name, s] of Object.entries(SCALARS)) {
      if (!skip.has(name) && s.active(f) && !s.test(g, f)) return false;
    }
    if (!skipTree && !spiritTreeTest(g, f)) return false;
    for (const key of Object.keys(FACETS)) {
      if (SPIRIT_TREE.has(key) || skip.has(key)) continue;
      if (!facetTest(key, g, f)) return false;
    }
    return true;
  });
}

export function activeFilterCount(f) {
  return Object.values(SCALARS).filter((s) => s.active(f)).length
    + (f.spirits.size || f.aspects.size ? 1 : 0)
    + Object.keys(FACETS).filter((k) => !SPIRIT_TREE.has(k) && f[k].size).length;
}

/**
 * Every option of every facet, from all games (so options never disappear),
 * with how many games each would match given the *other* filters.
 * -> { facetKey: [{ value, label, count }] }
 */
export function facetOptions(allGames, f) {
  const result = {};
  for (const [key, facet] of Object.entries(FACETS)) {
    const options = new Map();
    for (const g of allGames) {
      for (const [value, label] of facet.labels(g)) {
        if (!options.has(value)) options.set(value, { value, label, count: 0, order: facet.order?.(g, value) ?? 0 });
      }
    }
    for (const g of applyFilters(allGames, f, key)) {
      for (const v of new Set(facet.values(g))) {
        const o = options.get(v);
        if (o) o.count++;
      }
    }
    result[key] = [...options.values()].sort((a, b) =>
      a.order - b.order
      || (a.value === NONE) - (b.value === NONE)
      || (facet.numeric ? a.value - b.value : a.label.localeCompare(b.label)));
  }
  return result;
}

/** Counts for the outcome buttons, ignoring the outcome filter itself. */
export function outcomeCounts(allGames, f) {
  const base = applyFilters(allGames, f, "outcome");
  const wins = base.filter((g) => g.isWin).length;
  return { all: base.length, win: wins, loss: base.length - wins };
}

/** Min/max of numeric fields across all games, for the range inputs. */
export function bounds(allGames) {
  const range = (values) => {
    const v = values.filter((x) => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
  };
  const days = allGames.map((g) => g.dayKey).filter(Boolean).sort();
  return {
    difficulty: range(allGames.map((g) => g.difficulty)),
    advLevel: range(allGames.map((g) => g.adversary?.level ?? null)),
    date: [days[0] ?? "", days[days.length - 1] ?? ""],
  };
}

// --- URL ---------------------------------------------------------------------

const LIST_SEP = ",";
const num = (s) => (s === "" || s == null || Number.isNaN(Number(s)) ? null : Number(s));

function parseRange(text, isDate = false) {
  if (!text) return isDate ? ["", ""] : [null, null];
  const [a = "", b = ""] = text.split("..");
  if (isDate) {
    const ok = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "");
    return [ok(a), ok(b)];
  }
  return [num(a), num(b)];
}

const formatRange = ([a, b]) => (a == null || a === "") && (b == null || b === "") ? null : `${a ?? ""}..${b ?? ""}`;

export function filtersFromParams(params) {
  const f = emptyFilters();
  f.q = params.get("q") ?? "";
  f.outcome = ["win", "loss"].includes(params.get("outcome")) ? params.get("outcome") : "all";
  f.hideAbandoned = params.get("abandoned") === "hide";
  f.spiritMode = params.get("spiritMode") === "all" ? "all" : "any";
  f.advLevel = parseRange(params.get("level"));
  f.difficulty = parseRange(params.get("difficulty"));
  f.date = parseRange(params.get("date"), true);
  f.blight = ["flipped", "not"].includes(params.get("blight")) ? params.get("blight") : "all";
  for (const [key, facet] of Object.entries(FACETS)) {
    const raw = params.get(facet.param);
    if (!raw) continue;
    for (const v of raw.split(LIST_SEP).filter(Boolean)) f[key].add(facet.numeric ? Number(v) : v);
  }
  // Aspect values are "<SpiritId>/<AspectId>"; drop anything else (older links).
  for (const v of f.aspects) if (!v.includes("/")) f.aspects.delete(v);
  return f;
}

/** Writes the filters into params (removing the ones not in use). */
export function filtersToParams(f, params) {
  const set = (name, value) => (value == null || value === "" ? params.delete(name) : params.set(name, value));
  set("q", f.q.trim());
  set("outcome", f.outcome === "all" ? null : f.outcome);
  set("abandoned", f.hideAbandoned ? "hide" : null);
  set("spiritMode", f.spiritMode === "all" ? "all" : null);
  set("level", formatRange(f.advLevel));
  set("difficulty", formatRange(f.difficulty));
  set("date", formatRange(f.date));
  set("blight", f.blight === "all" ? null : f.blight);
  for (const [key, facet] of Object.entries(FACETS)) {
    set(facet.param, f[key].size ? [...f[key]].join(LIST_SEP) : null);
  }
  return params;
}
