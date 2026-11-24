// Page controller: picks the device, loads games, keeps the URL in sync and
// wires the table and the detail panel together.

import { h, clear } from "./dom.js";
import { loadArt, missingArt, artCoverage, artFileCount, downloadArt, artProgressText } from "./art.js";
import { normalizeGames } from "./normalize.js";
import {
  SORTS, parseSort, formatSort, sortGames,
  emptyFilters, filtersFromParams, filtersToParams, applyFilters, activeFilterCount,
} from "./filters.js";
import { buildSidebar, renderChips } from "./filters-ui.js";
import { renderGames, renderEmpty, renderDetail } from "./views.js";
import { renderStats } from "./stats-view.js";
import { initTheme } from "./theme.js";
import { exportCsv, exportJson } from "./export.js";
import { renderWelcome, openManageDialog } from "./devices-ui.js";

const UID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const ALL = "__all__";
const MANAGE = "__manage__";
const LAST_DEVICE_KEY = "si-history.lastDevice";
const SERVER_DOWN = "Can't reach the local server. Is the start.bat window still open? Start it again, then press Refresh.";

const $ = (id) => document.getElementById(id);
const els = {
  select: $("device-select"),
  deviceControls: $("device-controls"),
  welcome: $("welcome"),
  main: $("main"),
  footer: document.querySelector(".footer"),
  devicesDialog: $("devices-dialog"),
  refresh: $("refresh"),
  notice: $("notice"),
  count: $("count"),
  updated: $("updated"),
  games: $("games"),
  filters: $("filters"),
  filtersToggle: $("filters-toggle"),
  chips: $("chips"),
  stats: $("stats"),
  tabHistory: $("tab-history"),
  tabStats: $("tab-stats"),
  exportBox: $("export"),
  exportCsv: $("export-csv"),
  exportJson: $("export-json"),
  theme: $("theme"),
  detail: $("detail"),
  artStatus: $("art-status"),
  artMissing: $("art-missing"),
  artBanner: $("art-banner"),
  artDownload: $("art-download"),
  artDownloadStatus: $("art-download-status"),
};

const state = {
  devices: [],        // [{ name, uid }] from data/config.json (+ an unsaved ID opened by a ?uid= link)
  selection: null,    // a uid, or ALL
  allGames: [],       // normalized, every game for the selection
  games: [],          // allGames minus false starts (when hidden): what filters work on
  view: [],           // games as shown: filtered and sorted
  // False starts = abandoned on turn 0; hidden unless the URL says falseStarts=show.
  hideFalseStarts: new URLSearchParams(location.search).get("falseStarts") !== "show",
  sort: parseSort(new URLSearchParams(location.search).get("sort")),
  filters: filtersFromParams(new URLSearchParams(location.search)),
  mode: new URLSearchParams(location.search).get("view") === "stats" ? "stats" : "history",
  updateSidebar: null, // from buildSidebar(); refreshes counts in place
  sidebarFor: null,    // which set of games the sidebar was built for
  detailIndex: -1,
  loading: false,
};

// --- Devices ---------------------------------------------------------------

const shortUid = (uid) => `Device ${uid.slice(0, 8)}…`;
const deviceFor = (uid) => state.devices.find((d) => d.uid === uid) ?? { uid, name: shortUid(uid) };

const savedDevices = () => state.devices.filter((d) => !d.unsaved);

/** A device ID opened through a ?uid= link but not in the saved list. */
function addUnsavedDevice(uid) {
  if (!state.devices.some((d) => d.uid === uid)) state.devices.push({ uid, name: `${shortUid(uid)} (not saved)`, unsaved: true });
}

function renderDeviceSelect() {
  clear(els.select).append(
    ...state.devices.map((d) => h("option", { value: d.uid, title: d.uid }, d.name)),
    savedDevices().length > 1 ? h("option", { value: ALL }, "All devices") : null,
    h("option", { value: MANAGE }, "Add or manage devices…"),
  );
  els.select.value = state.selection ?? "";
}

function chooseInitialDevice() {
  const fromUrl = new URLSearchParams(location.search).get("uid");
  if (fromUrl === "all" && savedDevices().length > 1) return ALL;
  if (fromUrl && UID_PATTERN.test(fromUrl)) { addUnsavedDevice(fromUrl); return fromUrl; }
  const remembered = localStorage.getItem(LAST_DEVICE_KEY);
  if (remembered === ALL && savedDevices().length > 1) return ALL;
  if (state.devices.some((d) => d.uid === remembered)) return remembered;
  return state.devices[0]?.uid ?? null;
}

/** First use (no device set up): the welcome screen replaces the history. */
function showWelcome(on) {
  els.welcome.hidden = !on;
  els.main.hidden = on;
  els.footer.hidden = on;
  els.deviceControls.hidden = on;
  if (!on) return;
  hideNotice();
  renderWelcome(els.welcome, {
    onAdded: (result) => {
      state.devices = result.devices.map((d) => ({ uid: d.uid, name: d.name }));
      showWelcome(false);
      selectDevice(result.device.uid);
    },
  });
}

/** After a device was added, renamed or removed in the "Manage devices" dialog. */
function devicesChanged(saved, { added, removed }) {
  const unsaved = state.devices.filter((d) => d.unsaved && !saved.some((s) => s.uid === d.uid) && d.uid !== removed);
  state.devices = [...saved.map((d) => ({ uid: d.uid, name: d.name })), ...unsaved];
  const current = state.selection;
  const stillThere = current === ALL ? savedDevices().length > 1 : state.devices.some((d) => d.uid === current);
  if (added && (!current || !stillThere)) {
    selectDevice(added.uid);
  } else if (!stillThere) {
    const next = state.devices[0]?.uid ?? null;
    if (next) selectDevice(next);
    else { state.selection = null; els.devicesDialog.close(); showWelcome(true); syncUrl(); }
  } else {
    renderDeviceSelect();
    if (current === ALL || state.games.some((g) => g.device)) render(); // device names shown in games
  }
}

async function selectDevice(selection) {
  showWelcome(false);
  state.selection = selection;
  state.allGames = [];
  state.games = [];
  state.sidebarFor = null;
  els.filters.hidden = true;
  localStorage.setItem(LAST_DEVICE_KEY, selection);
  renderDeviceSelect();
  syncUrl();
  hideNotice();
  // Saved games first (instant), then the latest from the feed.
  await loadGames({ live: false });
  await loadGames({ live: true });
}

// --- URL -------------------------------------------------------------------

function syncUrl() {
  const params = new URLSearchParams(location.search);
  if (state.selection) params.set("uid", state.selection === ALL ? "all" : state.selection);
  else params.delete("uid");
  params.set("sort", formatSort(state.sort));
  if (state.mode === "stats") params.set("view", "stats"); else params.delete("view");
  params.delete("abandonedAsLoss"); // no longer an option: abandoned games always count as defeats
  if (state.hideFalseStarts) params.delete("falseStarts"); else params.set("falseStarts", "show");
  filtersToParams(state.filters, params);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

// --- Loading ---------------------------------------------------------------

async function fetchDevice(device, live) {
  const url = `/api/games?uid=${encodeURIComponent(device.uid)}${live ? "" : "&cached=1"}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(SERVER_DOWN);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server answered ${res.status}`);
  return { device, ...body };
}

let loadToken = 0;

async function loadGames({ live }) {
  if (!state.selection) { showWelcome(true); return; }
  state.loading = true;
  els.refresh.disabled = true;
  els.refresh.textContent = "Refreshing…";
  if (!state.allGames.length) {
    els.count.textContent = "Loading…";
    els.updated.textContent = "";
    clear(els.games).append(h("p", { class: "loading" }, "Fetching games from the online feed…"));
  }

  const targets = state.selection === ALL ? savedDevices() : [deviceFor(state.selection)];
  const token = ++loadToken;
  const results = await Promise.allSettled(targets.map((d) => fetchDevice(d, live)));
  if (token !== loadToken) return; // the device was changed while this was loading
  state.loading = false;
  els.refresh.disabled = false;
  els.refresh.textContent = "Refresh";

  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const problems = [
    ...new Set(results.filter((r) => r.status === "rejected").map((r) => r.reason.message)),
    ...ok.filter((r) => r.error).map((r) => (targets.length > 1 ? `${r.device.name}: ${r.error}` : r.error)),
  ];

  const games = normalizeGames(ok.map((r) => ({ device: r.device, games: r.games })));
  // A first look at the saved copy with nothing in it: keep showing
  // "loading" until the live fetch answers.
  if (!live && !games.length && !problems.length) return;
  // Nothing came back at all (e.g. the server was closed): keep what's on screen.
  if (ok.length || !state.allGames.length) state.allGames = games;

  if (problems.length) {
    const stale = ok.some((r) => r.source === "cache" && r.games.length);
    showNotice(
      (stale ? "Showing your saved games. " : "") + problems.join(" "),
      state.allGames.length ? "warn" : "error",
    );
  } else {
    hideNotice();
  }

  const newGames = ok.reduce((n, r) => n + (r.newGames || 0), 0);
  const fetched = ok.map((r) => r.lastFetchedAt).filter(Boolean).sort().pop();
  els.updated.textContent = [
    fetched ? `Updated ${new Date(fetched).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Never fetched",
    live && !problems.length ? (newGames ? `${newGames} new` : "no new games") : null,
  ].filter(Boolean).join(" · ");

  render();
}

// --- Rendering -------------------------------------------------------------

function ensureSidebar() {
  const signature = `${state.hideFalseStarts}\n` + state.allGames.map((g) => g.key).join("\n");
  if (state.sidebarFor === signature) return;
  state.sidebarFor = signature;
  els.filters.hidden = state.games.length === 0;
  els.filtersToggle.hidden = state.games.length === 0;
  state.updateSidebar = state.games.length
    ? buildSidebar(els.filters, state.games, state.filters, changeFilters, {
        falseStarts: {
          hidden: state.hideFalseStarts,
          count: state.allGames.filter((g) => g.falseStart).length,
          onToggle: setHideFalseStarts,
        },
      })
    : null;
}

function setHideFalseStarts(hide) {
  state.hideFalseStarts = hide;
  syncUrl();
  render();
}

function changeFilters(mutate) {
  mutate(state.filters);
  if (state.filters.reset) state.filters = emptyFilters();
  if (state.filters.closePanel) {
    delete state.filters.closePanel;
    setPanelOpen(false);
    els.count.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  syncUrl();
  render();
}

function setPanelOpen(open) {
  els.filters.classList.toggle("open", open);
  els.filtersToggle.setAttribute("aria-expanded", String(open));
}
els.filtersToggle.addEventListener("click", () => setPanelOpen(!els.filters.classList.contains("open")));

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  syncUrl();
  render();
}
els.tabHistory.addEventListener("click", () => setMode("history"));
els.tabStats.addEventListener("click", () => setMode("stats"));
els.exportCsv.addEventListener("click", () => exportCsv(state.view));
els.exportJson.addEventListener("click", () => exportJson(state.view));
initTheme(els.theme);

// Keyboard: "/" jumps to the search box (like many sites), unless already typing.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("input, select, textarea, [contenteditable]")) return;
  if (els.detail.open) return;
  const search = els.filters.querySelector(".filter-search");
  if (!search || els.filters.hidden) return;
  e.preventDefault();
  setPanelOpen(true);
  search.focus();
});

function render() {
  state.games = state.hideFalseStarts ? state.allGames.filter((g) => !g.falseStart) : state.allGames;
  ensureSidebar();
  const filtered = applyFilters(state.games, state.filters);
  state.view = sortGames(filtered, state.sort);
  const n = state.view.length;
  const total = state.games.length;
  const wins = state.view.filter((g) => g.isWin).length;
  const nFilters = activeFilterCount(state.filters);
  els.count.textContent = !total ? "No games"
    : n === total ? `${n} game${n === 1 ? "" : "s"} · ${wins} won`
    : `${n} of ${total} games · ${wins} won`;
  els.filtersToggle.textContent = nFilters ? `Filters (${nFilters})` : "Filters";

  state.updateSidebar?.(state.filters);
  renderChips(els.chips, state.games, state.filters, changeFilters);

  els.exportBox.hidden = n === 0;
  const showStats = state.mode === "stats" && n > 0;
  els.tabHistory.setAttribute("aria-selected", String(state.mode === "history"));
  els.tabStats.setAttribute("aria-selected", String(state.mode === "stats"));
  els.games.hidden = showStats;
  els.stats.hidden = !showStats;
  if (showStats) {
    renderStats(els.stats, filtered, { onFilter: changeFilters });
    renderArtStatus();
    return;
  }

  if (!total && state.allGames.length) {
    // Every game is a false start, so the sidebar (and its toggle) is hidden.
    renderEmpty(els.games, "Only false starts so far",
      "Every game on this device was abandoned on turn 0, and those are hidden.");
    els.games.querySelector(".empty").append(h("button", {
      type: "button", class: "btn", onclick: () => setHideFalseStarts(false),
    }, "Show them"));
  } else if (!total) {
    renderEmpty(els.games, "No games yet",
      "This device has no finished games in the online feed. Finish a game on it, then press Refresh.");
  } else if (!n) {
    renderEmpty(els.games, "No games match these filters", "Remove a filter above, or clear them all.");
    els.games.querySelector(".empty").append(h("button", {
      type: "button", class: "btn", onclick: () => changeFilters((x) => { x.reset = true; }),
    }, "Clear all filters"));
  } else {
    renderGames(els.games, state.view, {
      sort: state.sort,
      onSort: changeSort,
      onOpen: openDetail,
      showDevice: state.selection === ALL,
    });
  }
  renderArtStatus();
}

function changeSort(key) {
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" }
    : { key, dir: SORTS[key].firstDir };
  syncUrl();
  render();
  // Keep keyboard focus on the header that was used.
  els.games.querySelector(`th[aria-sort] .sort-btn`)?.focus();
}

function renderArtStatus() {
  const { total, found, missing } = artCoverage(state.games);
  els.artStatus.hidden = total === 0;
  els.artStatus.querySelector("summary").textContent = missing
    ? `Art: ${found} of ${total} images found — show the ${missing} missing`
    : `Art: all ${total} images found`;
  els.artDownload.parentElement.hidden = missing === 0 && !artDownloading;
  clear(els.artMissing).append(...missingArt(state.games).map((m) =>
    h("li", null, h("code", null, `web/art/${m.kind}/${m.id}.png`), h("span", { class: "muted" }, ` — ${m.name}`))));

  // No artwork at all yet (e.g. a fresh copy): offer the download up front.
  const showBanner = total > 0 && artFileCount() === 0;
  els.artBanner.hidden = !showBanner && !artDownloading;
  if (showBanner && !artDownloading) {
    clear(els.artBanner).append(
      h("span", null, "Spirit and adversary pictures aren't downloaded yet. "),
      h("button", { type: "button", class: "btn btn-small btn-primary", onclick: startArtDownload }, "Download artwork"),
      h("span", { class: "muted small" }, " About 5 MB, from mindwanderer.net."));
  }
}

let artDownloading = false;

/** Downloads the missing artwork, showing progress in the banner and the footer. */
async function startArtDownload() {
  if (artDownloading) return;
  artDownloading = true;
  els.artDownload.disabled = true;
  const show = (text) => {
    els.artDownloadStatus.textContent = text;
    if (!els.artBanner.hidden) clear(els.artBanner).append(h("span", { class: "form-status small busy" }, text));
  };
  show("Starting…");
  const result = await downloadArt((s) => show(artProgressText(s)));
  artDownloading = false;
  els.artDownload.disabled = false;
  const text = artProgressText(result);
  els.artDownloadStatus.textContent = text;
  state.sidebarFor = null; // rebuild the sidebar so its pictures appear too
  render();
  if (result.state === "failed") showNotice(text, "warn");
}
els.artDownload.addEventListener("click", startArtDownload);

function showNotice(text, kind = "warn") {
  els.notice.textContent = text;
  els.notice.className = `notice ${kind === "error" ? "error" : ""}`;
  els.notice.hidden = false;
}
function hideNotice() { els.notice.hidden = true; }

// --- Detail panel ----------------------------------------------------------

function openDetail(index) {
  state.detailIndex = index;
  renderDetail(els.detail, state.view[index], {
    index,
    total: state.view.length,
    showDevice: state.selection === ALL,
    onPrev: () => index > 0 && openDetail(index - 1),
    onNext: () => index < state.view.length - 1 && openDetail(index + 1),
    onClose: () => els.detail.close(),
  });
  if (!els.detail.open) els.detail.showModal();
  els.detail.scrollTop = 0;
}

els.detail.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea, summary")) return;
  if (e.key === "ArrowLeft" && state.detailIndex > 0) openDetail(state.detailIndex - 1);
  if (e.key === "ArrowRight" && state.detailIndex < state.view.length - 1) openDetail(state.detailIndex + 1);
});
// Clicking the dark backdrop closes the panel.
els.detail.addEventListener("click", (e) => { if (e.target === els.detail) els.detail.close(); });
els.detail.addEventListener("close", () => {
  // Return focus to the row that was open.
  els.games.querySelector(`tr[data-index="${state.detailIndex}"]`)?.focus();
  state.detailIndex = -1;
});

// --- Device controls -------------------------------------------------------

els.select.addEventListener("change", () => {
  if (els.select.value === MANAGE) {
    els.select.value = state.selection ?? "";
    openManageDialog(els.devicesDialog, { devices: savedDevices(), onChanged: devicesChanged });
    return;
  }
  selectDevice(els.select.value);
});
els.devicesDialog.addEventListener("click", (e) => { if (e.target === els.devicesDialog) els.devicesDialog.close(); });
els.refresh.addEventListener("click", () => loadGames({ live: true }));

// --- Start -----------------------------------------------------------------

async function init() {
  const [devicesRes] = await Promise.all([
    fetch("/api/devices").then((r) => r.json()).catch(() => ({ devices: [] })),
    loadArt(),
  ]);
  state.devices = (devicesRes.devices ?? []).filter((d) => d && UID_PATTERN.test(d.uid ?? ""))
    .map((d) => ({ uid: d.uid, name: d.name || shortUid(d.uid) }));
  state.selection = chooseInitialDevice();
  renderDeviceSelect();
  syncUrl();
  if (!state.selection) { showWelcome(true); return; }
  // Show saved games instantly, then fetch the latest from the feed.
  await loadGames({ live: false });
  await loadGames({ live: true });
}

init().catch((err) => {
  showNotice(err.message === SERVER_DOWN ? SERVER_DOWN : `Could not start: ${err.message}`, "error");
});
