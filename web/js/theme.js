// Theme switch: Auto (follow the system), Light or Dark. The choice is kept
// in this browser; index.html applies it before the first paint.

const KEY = "si-history.theme";
const media = matchMedia("(prefers-color-scheme: dark)");

function apply(choice) {
  const dark = choice === "dark" || (choice === "auto" && media.matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function initTheme(select) {
  let choice = localStorage.getItem(KEY) || "auto";
  if (!["auto", "light", "dark"].includes(choice)) choice = "auto";
  select.value = choice;
  apply(choice);
  select.addEventListener("change", () => {
    choice = select.value;
    localStorage.setItem(KEY, choice);
    apply(choice);
  });
  // In Auto, follow the system when it switches between light and dark.
  media.addEventListener("change", () => { if (choice === "auto") apply(choice); });
}
