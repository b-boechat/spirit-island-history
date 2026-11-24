// Statistics over a list of normalized games (pure calculations, no DOM).
//
// Abandoned games count as defeats for win rates and streaks (abandonedAsLoss,
// on by default). False starts (abandoned on turn 0) never get here: they're
// hidden before filtering. To leave abandoned games out of the statistics,
// use the "Hide abandoned games" filter.

const chrono = (games) => [...games].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

/** Outcome of a game for stats purposes: "win" | "loss" | null (not counted). */
function outcomeOf(g, abandonedAsLoss) {
  if (g.abandoned) return abandonedAsLoss ? "loss" : null;
  return g.isWin ? "win" : "loss";
}

function record(games, abandonedAsLoss) {
  let wins = 0, losses = 0, abandoned = 0;
  for (const g of games) {
    if (g.abandoned) abandoned++;
    const o = outcomeOf(g, abandonedAsLoss);
    if (o === "win") wins++;
    else if (o === "loss") losses++;
  }
  const decided = wins + losses;
  return { games: games.length, wins, losses, abandoned, decided, winRate: decided ? wins / decided : null };
}

function streaks(games, abandonedAsLoss) {
  const results = chrono(games).map((g) => outcomeOf(g, abandonedAsLoss)).filter(Boolean);
  let best = 0, run = 0;
  for (const r of results) {
    run = r === "win" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = { type: null, length: 0 };
  for (let i = results.length - 1; i >= 0; i--) {
    if (current.type === null) current = { type: results[i], length: 1 };
    else if (results[i] === current.type) current.length++;
    else break;
  }
  return { current, bestWin: best };
}

/** Groups games by key(g) -> [{ key, label, ...record, extra }], most played first. */
function breakdown(games, keyOf, labelOf, abandonedAsLoss, extraOf) {
  const groups = new Map();
  for (const g of games) {
    for (const key of [].concat(keyOf(g))) {
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, { key, label: labelOf(g, key), games: [], extra: extraOf?.(g, key) });
      groups.get(key).games.push(g);
    }
  }
  return [...groups.values()]
    .map((grp) => ({ key: grp.key, label: grp.label, extra: grp.extra, ...record(grp.games, abandonedAsLoss) }))
    .sort((a, b) => b.games - a.games || (b.winRate ?? -1) - (a.winRate ?? -1) || String(a.label).localeCompare(String(b.label)));
}

/** "day" | "week" | "month" depending on how long a period the games cover. */
function bucketSize(games) {
  const times = games.map((g) => g.date?.getTime()).filter(Boolean);
  if (!times.length) return "day";
  const days = (Math.max(...times) - Math.min(...times)) / 86400000;
  return days <= 45 ? "day" : days <= 365 ? "week" : "month";
}

const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function bucketStart(date, size) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (size === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (size === "month") d.setDate(1);
  return d;
}

function nextBucket(d, size) {
  const n = new Date(d);
  if (size === "day") n.setDate(n.getDate() + 1);
  else if (size === "week") n.setDate(n.getDate() + 7);
  else n.setMonth(n.getMonth() + 1);
  return n;
}

/** Games per day/week/month, including empty periods, split into wins / defeats / abandoned. */
function timeline(games) {
  const dated = games.filter((g) => g.date);
  if (!dated.length) return { size: "day", buckets: [] };
  const size = bucketSize(dated);
  const counts = new Map();
  for (const g of dated) {
    const key = localDay(bucketStart(g.date, size));
    const c = counts.get(key) ?? { wins: 0, defeats: 0, abandoned: 0 };
    if (g.abandoned) c.abandoned++;
    else if (g.isWin) c.wins++;
    else c.defeats++;
    counts.set(key, c);
  }
  const times = dated.map((g) => g.date.getTime());
  const buckets = [];
  const end = bucketStart(new Date(Math.max(...times)), size);
  for (let d = bucketStart(new Date(Math.min(...times)), size); d <= end; d = nextBucket(d, size)) {
    const key = localDay(d);
    const c = counts.get(key) ?? { wins: 0, defeats: 0, abandoned: 0 };
    buckets.push({ key, start: new Date(d), ...c, total: c.wins + c.defeats + c.abandoned });
  }
  return { size, buckets };
}

export function computeStats(games, { abandonedAsLoss = true } = {}) {
  const rec = record(games, abandonedAsLoss);
  const wins = games.filter((g) => g.isWin);
  const hardestWin = wins.reduce((best, g) =>
    g.difficulty != null && (best == null || g.difficulty > best.difficulty
      || (g.difficulty === best.difficulty && g.date > best.date)) ? g : best, null);
  const fastestWin = wins.reduce((best, g) =>
    g.turn != null && g.turn > 0 && (best == null || g.turn < best.turn) ? g : best, null);
  const diffs = games.map((g) => g.difficulty).filter((d) => d != null);

  return {
    ...rec,
    streaks: streaks(games, abandonedAsLoss),
    hardestWin,
    fastestWin,
    avgDifficulty: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,

    bySpirit: breakdown(games, (g) => g.spirits.map((s) => s.id),
      (g, id) => g.spirits.find((s) => s.id === id).name, abandonedAsLoss,
      (g, id) => ({ kind: "spirits", id, name: g.spirits.find((s) => s.id === id).name })),
    byAdversary: breakdown(games,
      (g) => (g.adversary ? `${g.adversary.id}|${g.adversary.level ?? ""}` : "none"),
      (g) => (g.adversary ? g.adversary.label : "No adversary"), abandonedAsLoss,
      (g) => (g.adversary ? { kind: "adversaries", id: g.adversary.id, name: g.adversary.name, short: g.adversary.short } : null)),
    byDifficulty: breakdown(games, (g) => g.difficulty, (g) => `Difficulty ${g.difficulty}`, abandonedAsLoss)
      .sort((a, b) => b.key - a.key),
    bySpiritCount: breakdown(games, (g) => g.spiritCount,
      (g) => `${g.spiritCount} spirit${g.spiritCount === 1 ? "" : "s"}`, abandonedAsLoss)
      .sort((a, b) => a.key - b.key),
    endings: breakdown(games, (g) => g.resultId ?? "unknown", (g) => g.reason, abandonedAsLoss,
      (g) => ({ outcome: g.abandoned ? "abandoned" : g.isWin ? "win" : "loss" })),
    timeline: timeline(games),
  };
}
