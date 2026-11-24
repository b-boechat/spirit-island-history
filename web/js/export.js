// Export the games currently shown (after filters, in the current sort order).
// CSV opens in Excel / Google Sheets; JSON keeps the original records.

const COLUMNS = [
  ["Date", (g) => (g.date ? localDateTime(g.date) : "")],
  ["Result", (g) => (g.abandoned ? "Abandoned" : g.isWin ? "Victory" : "Defeat")],
  ["How it ended", (g) => g.reason],
  ["Spirits", (g) => g.spirits.map((s) => s.name).join("; ")],
  ["Aspects", (g) => g.spirits.filter((s) => s.aspect).map((s) => `${s.name}: ${s.aspect.name}`).join("; ")],
  ["Number of spirits", (g) => g.spiritCount],
  ["Adversary", (g) => g.adversary?.name ?? ""],
  ["Adversary level", (g) => g.adversary?.level ?? ""],
  ["Supporting adversary", (g) => g.supportingAdversary?.name ?? ""],
  ["Supporting level", (g) => g.supportingAdversary?.level ?? ""],
  ["Scenario", (g) => g.scenario?.name ?? ""],
  ["Difficulty", (g) => g.difficulty ?? ""],
  ["Score", (g) => g.score ?? ""],
  ["Turns", (g) => g.turn ?? ""],
  ["Terror level", (g) => g.terrorLevel ?? ""],
  ["Boards", (g) => g.boards.join(" ")],
  ["Layout", (g) => g.layout ?? ""],
  ["Blight card", (g) => (g.blight.flipped ? g.blight.card.name : "Not flipped")],
  ["Blight on island", (g) => g.blight.onIsland ?? ""],
  ["Blight left on card", (g) => g.blight.remaining ?? ""],
  ["Dahan on island", (g) => g.dahanOnIsland ?? ""],
  ["Device", (g) => g.device?.name ?? ""],
];

const pad = (n) => String(n).padStart(2, "0");
function localDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function csvCell(value) {
  let text = String(value);
  // Stop spreadsheet apps from treating a text cell as a formula.
  if (typeof value === "string" && /^[=+@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => localDateTime(new Date()).slice(0, 10);

export function exportCsv(games) {
  const lines = [
    COLUMNS.map(([name]) => csvCell(name)).join(","),
    ...games.map((g) => COLUMNS.map(([, get]) => csvCell(get(g))).join(",")),
  ];
  // The BOM makes Excel read the file as UTF-8; CRLF line ends suit Windows apps.
  download(`spirit-island-history-${stamp()}.csv`, "﻿" + lines.join("\r\n") + "\r\n", "text/csv;charset=utf-8");
}

export function exportJson(games) {
  const records = games.map((g) => (g.device ? { device: g.device.name, ...g.raw } : g.raw));
  download(`spirit-island-history-${stamp()}.json`, JSON.stringify(records, null, 2), "application/json");
}
