// Rendering: the games table and the game detail panel.

import { h, clear } from "./dom.js";
import { portrait, spiritPortrait } from "./art.js";
import { SORTS } from "./filters.js";

// --- Small pieces ----------------------------------------------------------

export function resultBadge(game) {
  if (game.abandoned) return h("span", { class: "badge abandoned" }, "Abandoned");
  if (game.outcome === "win") return h("span", { class: "badge win" }, "Victory");
  if (game.outcome === "loss") return h("span", { class: "badge loss" }, "Defeat");
  return h("span", { class: "badge abandoned" }, "Unknown");
}

function dateParts(game) {
  if (!game.date) return { day: "Unknown date", time: "" };
  return {
    day: game.date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    time: game.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

const dash = (v) => (v == null ? "—" : v);

function boardsLabel(game) {
  const boards = game.boards.length ? game.boards.join(" · ") : "—";
  return game.layout ? `${boards}  (${game.layout})` : boards;
}

function spiritStack(game, size) {
  return h("span", { class: "portrait-stack" },
    game.spirits.map((s) => spiritPortrait(s, size)));
}

// --- Games table -----------------------------------------------------------

const COLUMNS = [
  { key: "date", cls: "col-date" },
  { key: "spirits", cls: "col-spirits" },
  { key: "adversary", cls: "col-adv" },
  { key: "difficulty", cls: "col-diff num", label: "Difficulty" },
  { key: "result", cls: "col-result" },
  { key: "turn", cls: "col-turn num", label: "Turns" },
  { key: null, cls: "col-boards", header: "Boards", label: "Boards" },
];

function headerCell(col, sort, onSort) {
  if (!col.key) return h("th", { class: `${col.cls} no-sort`, scope: "col" }, col.header);
  const active = sort.key === col.key;
  const arrow = active ? (sort.dir === "asc" ? "▲" : "▼") : "▼";
  return h("th", {
    class: col.cls,
    scope: "col",
    "aria-sort": active ? (sort.dir === "asc" ? "ascending" : "descending") : null,
  },
  h("button", {
    class: "sort-btn",
    type: "button",
    title: `Sort by ${SORTS[col.key].label.toLowerCase()}`,
    onclick: () => onSort(col.key),
  }, SORTS[col.key].label, h("span", { class: "arrow", "aria-hidden": "true" }, arrow)));
}

function rowCells(game, showDevice) {
  const { day, time } = dateParts(game);
  return {
    date: h("div", { class: "cell-date" },
      h("div", { class: "day" }, day),
      h("div", { class: "time" }, time),
      showDevice && game.device ? h("div", { class: "time" }, game.device.name) : null),

    spirits: h("div", { class: "cell-spirits" },
      spiritStack(game),
      h("div", { class: "spirit-names" },
        game.spirits.map((s) => h("span", null,
          h("span", { class: "name" }, s.name),
          s.aspect ? h("span", { class: "aspect" }, ` · ${s.aspect.name}`) : null)))),

    adversary: game.adversary
      ? h("div", { class: "cell-adv" },
          portrait("adversaries", game.adversary.id, game.adversary.name, 22, game.adversary.short),
          h("div", { class: "adv-lines" },
            h("span", { class: "adv-name" }, game.adversary.short,
              game.adversary.level != null ? h("span", { class: "level" }, game.adversary.level) : null),
            game.supportingAdversary
              ? h("span", { class: "support" }, `+ ${game.supportingAdversary.label}`)
              : null,
            game.scenario ? h("span", { class: "support" }, game.scenario.name) : null))
      : h("span", { class: "muted" }, game.scenario ? game.scenario.name : "No adversary"),

    difficulty: h("span", { class: "diff" }, dash(game.difficulty)),
    result: h("div", { class: "cell-result" },
      resultBadge(game),
      game.abandoned ? null : h("span", { class: "reason" }, game.reason)),
    turn: dash(game.turn),
    boards: h("span", { class: "boards" }, boardsLabel(game)),
  };
}

/**
 * @param {HTMLElement} container
 * @param {object[]} games  already sorted
 * @param {{ sort, onSort(key), onOpen(index), showDevice }} opts
 */
export function renderGames(container, games, { sort, onSort, onOpen, showDevice }) {
  clear(container);
  const table = h("table", { class: "games-table" },
    h("thead", null, h("tr", null, COLUMNS.map((c) => headerCell(c, sort, onSort)))));
  const tbody = h("tbody");
  games.forEach((game, index) => {
    const cells = rowCells(game, showDevice);
    const open = () => onOpen(index);
    tbody.append(h("tr", {
      tabindex: "0",
      dataset: { index },
      "aria-label": `${game.dateLabel}: ${game.spiritLabel} vs ${game.adversaryLabel}, ${game.isWin ? "victory" : game.abandoned ? "abandoned" : "defeat"}`,
      onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    }, COLUMNS.map((c) => h("td", {
      class: c.cls,
      "data-label": c.label ?? null,
    }, cells[c.key ?? "boards"]))));
  });
  table.append(tbody);
  container.append(table);
}

export function renderEmpty(container, title, text) {
  clear(container).append(h("div", { class: "empty" }, h("h3", null, title), h("p", { class: "muted" }, text)));
}

// --- Detail panel ----------------------------------------------------------

function fact(label, value, cls) {
  return h("div", { class: cls ?? null }, h("dt", null, label), h("dd", null, value));
}

function adversaryFact(label, adv) {
  return h("div", { class: "wide" },
    portrait("adversaries", adv.id, adv.name, 44, adv.short),
    h("div", null,
      h("dt", null, label),
      h("dd", null, adv.name, adv.level != null ? h("span", { class: "level" }, `Level ${adv.level}`) : null)));
}

function cardList(cards) {
  if (!cards.length) return h("p", { class: "muted small" }, "None");
  return h("ul", { class: "card-list" },
    [...cards].sort((a, b) => a.name.localeCompare(b.name)).map((c) => h("li", null, c.name)));
}

/**
 * Fills the <dialog> with one game.
 * @param {{ index, total, onPrev, onNext, onClose, showDevice }} nav
 */
export function renderDetail(dialog, game, nav) {
  const { day, time } = dateParts(game);
  const b = game.blight;

  const owned = game.spirits.map((s) => {
    const cards = game.powerCards.owned[s.id] ?? [];
    return h("div", { class: "spirit-cards" },
      h("div", { class: "spirit-cards-head" },
        spiritPortrait(s, 30),
        h("strong", null, s.name),
        h("span", { class: "muted small" }, `${cards.length} card${cards.length === 1 ? "" : "s"}`)),
      cardList(cards));
  });

  clear(dialog).append(h("div", { class: "detail-inner" },
    h("div", { class: "detail-top" },
      h("div", { class: "detail-nav" },
        h("button", { class: "btn", type: "button", onclick: nav.onPrev, disabled: nav.index <= 0, title: "Newer game in the list (←)" }, "← Prev"),
        h("button", { class: "btn", type: "button", onclick: nav.onNext, disabled: nav.index >= nav.total - 1, title: "Older game in the list (→)" }, "Next →"),
        h("span", { class: "muted small" }, `${nav.index + 1} of ${nav.total}`)),
      h("button", { class: "btn", type: "button", onclick: nav.onClose, "aria-label": "Close" }, "Close ✕")),

    h("div", { class: "detail-body" },
      h("div", { class: "detail-hero" },
        spiritStack(game),
        h("div", null,
          h("h2", { id: "detail-title" }, game.spirits.map((s) => s.name).join(" · ")),
          game.spirits.some((s) => s.aspect)
            ? h("div", { class: "aspect" }, game.spirits.filter((s) => s.aspect).map((s) => `${s.aspect.name} aspect`).join(" · "))
            : null,
          h("div", { class: "meta" },
            resultBadge(game),
            game.abandoned ? null : h("span", null, game.reason),
            h("span", { class: "muted" }, `· ${day}, ${time}`),
            nav.showDevice && game.device ? h("span", { class: "muted" }, `· ${game.device.name}`) : null))),

      h("section", null,
        h("h3", null, "Setup"),
        h("dl", { class: "facts" },
          game.adversary ? adversaryFact("Adversary", game.adversary) : fact("Adversary", "None", "wide"),
          game.supportingAdversary ? adversaryFact("Supporting adversary", game.supportingAdversary) : null,
          game.scenario ? fact("Scenario", game.scenario.name, "wide") : null,
          fact("Difficulty", dash(game.difficulty)),
          fact("Spirits", game.spiritCount),
          fact("Boards", game.boards.join(", ") || "—"),
          fact("Layout", dash(game.layout)))),

      h("section", null,
        h("h3", null, "End of game"),
        h("dl", { class: "facts" },
          fact("Score", dash(game.score)),
          fact("Turns", dash(game.turn)),
          fact("Terror level", dash(game.terrorLevel)),
          fact("Blight card", b.flipped ? b.card.name : "Not flipped"),
          fact("Blight on island", dash(b.onIsland)),
          fact("Blight left on card", dash(b.remaining)),
          fact("Dahan on island", dash(game.dahanOnIsland)))),

      h("section", null,
        h("h3", null, "Power cards owned"),
        owned),

      h("section", null,
        h("details", null,
          h("summary", null, `Discard pile (${game.powerCards.discard.length})`),
          cardList(game.powerCards.discard))),

      h("section", null,
        h("details", null,
          h("summary", { class: "muted" }, "Raw data"),
          h("pre", null, JSON.stringify(game.raw, null, 2)))))));
}
