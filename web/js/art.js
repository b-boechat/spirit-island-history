// Spirit / adversary / aspect images from web/art/<kind>/<GameId>.<ext>.
// The server lists which files exist (/api/art), so the page never requests
// an image that isn't there. Missing images get a colored initials tile.

import { h } from "./dom.js";

let art = { spirits: {}, adversaries: {}, aspects: {}, aliases: {} };

export async function loadArt() {
  try {
    const res = await fetch("/api/art");
    if (res.ok) art = await res.json();
  } catch {
    // No art list: every portrait falls back to initials.
  }
}

/** How many images are in the art folders (0 = artwork never downloaded). */
export function artFileCount() {
  return ["spirits", "adversaries", "aspects"].reduce((n, k) => n + Object.keys(art[k] ?? {}).length, 0);
}

/**
 * Asks the server to download the missing artwork from mindwanderer.net,
 * calling onProgress(status) about once a second until it's finished.
 * Resolves with the final status ({ state: "done" | "failed", downloaded, failed, error, ... })
 * and reloads the art list.
 */
export async function downloadArt(onProgress) {
  const post = await fetch("/api/art/download", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }).catch(() => null);
  if (!post) return { state: "failed", error: "Can't reach the local server. Is the start.bat window still open?" };
  let status = await post.json().catch(() => ({}));
  if (!post.ok) return { state: "failed", error: status.error || `The server answered ${post.status}.` };
  while (status.state === "running") {
    onProgress?.(status);
    await new Promise((r) => setTimeout(r, 1000));
    status = await fetch("/api/art/download").then((r) => r.json()).catch(() => ({ state: "failed", error: "Lost contact with the local server." }));
  }
  await loadArt();
  return status;
}

/** "Downloading… 12 of 66" etc. for a status from downloadArt(). */
export function artProgressText(s) {
  if (s.state === "running") {
    if (s.toDownload == null) return "Looking up the artwork…";
    return `Downloading artwork… ${s.downloaded + s.failed} of ${s.toDownload}`;
  }
  if (s.state === "failed") return s.error || "The download failed.";
  const parts = [`Downloaded ${s.downloaded} image${s.downloaded === 1 ? "" : "s"}`];
  if (s.skipped) parts.push(`${s.skipped} already there`);
  if (s.failed) parts.push(`${s.failed} failed`);
  return parts.join(", ") + ".";
}

/** URL of the image for a game ID, or null. kind: "spirits" | "adversaries" | "aspects". */
export function artUrl(kind, id) {
  const files = art[kind] ?? {};
  if (files[id]) return files[id];
  // aliases.json lets a file keep another name: { "GameId": "Wiki_File_Name.png" }
  const alias = art.aliases?.[id];
  if (alias) {
    const stem = alias.replace(/\.[^.]+$/, "");
    if (files[stem]) return files[stem];
  }
  return null;
}

const SMALL = new Set(["of", "and", "the", "a", "an", "to", "in", "on", "by", "for", "from", "with", "as"]);

function initials(name) {
  const words = String(name).split(/[\s-]+/).filter((w) => w && !SMALL.has(w.toLowerCase()));
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function hueOf(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

function fallback(kind, id, name, size, initialsFrom) {
  return h("span", {
    class: `portrait fallback ${kind}`,
    style: `--hue:${hueOf(id)};${size ? `--size:${size}px` : ""}`,
    title: name,
    "aria-hidden": "true",
  }, initials(initialsFrom ?? name));
}

/**
 * A round (spirit) or square (adversary) portrait, falling back to initials.
 * initialsFrom: text for the fallback initials if not the name
 * (e.g. "Brandenburg-Prussia" -> "BP" rather than "The Kingdom of …" -> "KB").
 */
export function portrait(kind, id, name, size, initialsFrom) {
  const url = artUrl(kind, id);
  if (!url) return fallback(kind, id, name, size, initialsFrom);
  const img = h("img", {
    class: `portrait ${kind}`,
    src: url,
    alt: "",
    title: name,
    loading: "lazy",
    decoding: "async",
    style: size ? `--size:${size}px` : null,
  });
  img.addEventListener("error", () => img.replaceWith(fallback(kind, id, name, size, initialsFrom)), { once: true });
  return img;
}

/** A spirit's portrait; when it was played with an aspect that has its own art, that art. */
export function spiritPortrait(spirit, size) {
  if (spirit.aspect && artUrl("aspects", spirit.aspect.id)) {
    return portrait("aspects", spirit.aspect.id, `${spirit.name} — ${spirit.aspect.name}`, size);
  }
  return portrait("spirits", spirit.id, spirit.name, size);
}

/** Images used by these games that aren't in the art folders yet. */
export function missingArt(games) {
  const needed = new Map();
  const want = (kind, id, name) => {
    if (id && !artUrl(kind, id)) needed.set(`${kind}/${id}`, { kind, id, name });
  };
  for (const g of games) {
    g.spirits.forEach((s) => want("spirits", s.id, s.name));
    if (g.adversary) want("adversaries", g.adversary.id, g.adversary.name);
    if (g.supportingAdversary) want("adversaries", g.supportingAdversary.id, g.supportingAdversary.name);
  }
  return [...needed.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** How many distinct spirit/adversary images these games use, and how many exist. */
export function artCoverage(games) {
  const used = new Set();
  for (const g of games) {
    g.spirits.forEach((s) => used.add(`spirits/${s.id}`));
    if (g.adversary) used.add(`adversaries/${g.adversary.id}`);
    if (g.supportingAdversary) used.add(`adversaries/${g.supportingAdversary.id}`);
  }
  const missing = missingArt(games).length;
  return { total: used.size, found: used.size - missing, missing };
}
