// Turns raw game records from the feed into clean objects the views can use
// directly: display names, win/loss + reason, dates, combined labels.
// The original record stays available as game.raw.

import { adversaryNames, nameOf, resultInfo } from "./names.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);

/** Same identity rule as the server uses to de-duplicate games. */
export function gameKey(raw) {
  return `${raw.createdAt ?? ""}|${(raw.spirits ?? []).join(",")}`;
}

function adversaryOf(id, level) {
  if (!id) return null;
  const { full, short } = adversaryNames(id);
  const lvl = isNum(level) && level >= 0 ? level : null;
  return {
    id,
    name: full,
    short,
    level: lvl,
    label: lvl === null ? short : `${short} ${lvl}`,
  };
}

function cardList(ids) {
  return (ids ?? []).map((id) => ({ id, name: nameOf("powerCard", id) }));
}

/**
 * @param {object} raw     one record from /api/games
 * @param {object} [device] { uid, name } of the device the game came from
 */
export function normalizeGame(raw, device = null) {
  const aspects = raw.aspects ?? {};
  const spirits = (raw.spirits ?? []).map((id) => ({
    id,
    name: nameOf("spirit", id),
    aspect: aspects[id] ? { id: aspects[id], name: nameOf("aspect", aspects[id]) } : null,
  }));

  const adversary = adversaryOf(raw.adversary, raw.adversaryLevel);
  const supporting = adversaryOf(raw.supportingAdversary, raw.supportingAdversaryLevel);
  const result = resultInfo(raw.endingResult);
  const date = raw.createdAt ? new Date(raw.createdAt) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const blightCardId = raw.blightCard ?? null;

  const owned = {};
  for (const [spiritId, cards] of Object.entries(raw.powerCardsOwned ?? {})) {
    owned[spiritId] = cardList(cards);
  }

  return {
    key: gameKey(raw),
    device,
    date: validDate,
    dateLabel: validDate
      ? validDate.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "Unknown date",
    dayKey: validDate ? validDate.toLocaleDateString("en-CA") : null, // YYYY-MM-DD, local time

    spirits,
    spiritCount: spirits.length,
    spiritLabel: spirits.map((s) => s.name).join(", "),

    adversary,
    supportingAdversary: supporting,
    adversaryLabel: adversary
      ? adversary.label + (supporting ? ` + ${supporting.label}` : "")
      : "No adversary",
    scenario: raw.scenario ? { id: raw.scenario, name: nameOf("scenario", raw.scenario) } : null,
    difficulty: num(raw.difficulty),

    outcome: result.outcome,        // "win" | "loss" | "unknown"
    isWin: result.outcome === "win",
    reason: result.reason,          // e.g. "Terror Victory"
    resultId: raw.endingResult ?? null,
    abandoned: result.abandoned,
    // Abandoned before turn 1: almost always a mistaken start (wrong setup).
    falseStart: result.abandoned && num(raw.turn) === 0,

    score: num(raw.score),
    turn: num(raw.turn),
    terrorLevel: num(raw.terrorLevel),
    waveNumber: num(raw.waveNumber),

    boards: raw.boards ?? [],
    layout: raw.layoutId ?? null,

    blight: {
      card: blightCardId && blightCardId !== "NotFlipped"
        ? { id: blightCardId, name: nameOf("blightCard", blightCardId) }
        : null,
      flipped: Boolean(blightCardId) && blightCardId !== "NotFlipped",
      onIsland: num(raw.blightOnIsland),
      remaining: num(raw.blightRemaining),
    },
    dahanOnIsland: num(raw.dahanOnIsland),

    powerCards: {
      owned,                          // { spiritId: [{ id, name }] }
      discard: cardList(raw.powerCardsInDiscard),
    },

    raw,
  };
}

/**
 * Normalizes a list of raw games, newest first.
 * Pass several device lists to merge them (e.g. an "All devices" view);
 * games with the same key are only kept once.
 * @param {{ device?: object, games: object[] }[]} sources
 */
export function normalizeGames(sources) {
  const byKey = new Map();
  for (const { device = null, games } of sources) {
    for (const raw of games ?? []) {
      const game = normalizeGame(raw, device);
      if (!byKey.has(game.key)) byKey.set(game.key, game);
    }
  }
  return [...byKey.values()].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}
