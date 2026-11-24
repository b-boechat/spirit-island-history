// Tiny DOM helper. All text goes in through textContent, never innerHTML,
// so names and data from the feed can't inject markup.
//
//   h("span", { class: "badge win", title: "…" }, "Victory")
//   h("ul", null, items.map((i) => h("li", null, i)))
//
// Attributes: "class", "style" (string), "dataset" (object), on* (functions),
// boolean true -> empty attribute, false/null -> omitted. Children may be
// strings, numbers, nodes, arrays or null.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}
