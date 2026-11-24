// Device setup on the page: the welcome screen (no device yet), the
// "add a device" form and the "Manage devices" dialog.

import { h, clear } from "./dom.js";
import { addDevice, renameDevice, removeDevice } from "./devices-api.js";

const UID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// How to find a device ID. Shown on the welcome screen and in the dialog.
// (One place to edit if the instructions need to change.)
export const DEVICE_ID_HELP = {
  intro: "Each copy of Spirit Island (on a PC, phone or tablet) has its own device ID. To find it:",
  steps: [
    "Open the Spirit Island digital app.",
    "Go to Statistics → Personal Report. A web page opens.",
    "Scroll to the bottom of that page and copy the code after “Device id:”.",
  ],
  note: "It's a long code like 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d. Paste it below.",
};

/**
 * The "device ID + name → Check & save" form.
 * @param {{ onAdded(result), submitLabel?: string }} opts
 *   onAdded receives the server's answer: { device, devices, check }.
 */
export function buildAddForm({ onAdded, submitLabel = "Check & save" }) {
  const uidInput = h("input", {
    type: "text", class: "uid-input", required: true, autocomplete: "off", spellcheck: "false",
    placeholder: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d", "aria-label": "Device ID",
  });
  const nameInput = h("input", {
    type: "text", maxlength: "40", autocomplete: "off",
    placeholder: "e.g. My PC, Phone (optional)", "aria-label": "Name for this device",
  });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, submitLabel);
  const status = h("p", { class: "form-status small", role: "status", hidden: true });

  const showStatus = (text, kind, ...extra) => {
    clear(status).append(text, ...extra);
    status.className = `form-status small ${kind ?? ""}`;
    status.hidden = false;
  };

  const save = async (skipCheck = false) => {
    const uid = uidInput.value.trim();
    if (!UID_PATTERN.test(uid)) {
      showStatus("That doesn't look like a device ID: it should contain only letters, digits and dashes.", "error");
      uidInput.focus();
      return;
    }
    submit.disabled = uidInput.disabled = nameInput.disabled = true;
    showStatus(skipCheck ? "Saving…" : "Checking this ID with the online feed… this can take a few seconds.", "busy");
    try {
      const result = await addDevice(uid, nameInput.value, { skipCheck });
      const n = result.check.games;
      showStatus(result.check.checked
        ? `Found ${n} game${n === 1 ? "" : "s"}. Saved as “${result.device.name}”.`
        : `Saved as “${result.device.name}”. Its games will load once the online feed can be reached.`, "ok");
      uidInput.value = nameInput.value = "";
      onAdded(result);
    } catch (err) {
      if (err.status === 502) {
        // The feed couldn't be reached: offer to save the ID without checking.
        const anyway = h("button", { type: "button", class: "btn btn-small", onclick: () => save(true) }, "Save anyway");
        showStatus(err.message + " ", "error", anyway);
      } else {
        showStatus(err.message, "error");
      }
    } finally {
      submit.disabled = uidInput.disabled = nameInput.disabled = false;
    }
  };

  const form = h("form", {
    class: "add-device",
    onsubmit: (e) => { e.preventDefault(); save(); },
  },
  h("label", { class: "field" }, h("span", { class: "field-label" }, "Device ID"), uidInput),
  h("label", { class: "field" }, h("span", { class: "field-label" }, "Name"), nameInput),
  h("div", { class: "form-actions" }, submit),
  status);
  form.focusFirst = () => uidInput.focus();
  return form;
}

function helpBlock() {
  return h("div", { class: "help" },
    h("p", null, DEVICE_ID_HELP.intro),
    h("ol", { class: "help-steps" }, DEVICE_ID_HELP.steps.map((s) => h("li", null, s))),
    h("p", null, DEVICE_ID_HELP.note));
}

/** The first-use screen, shown while no device is set up. */
export function renderWelcome(container, { onAdded }) {
  const form = buildAddForm({ onAdded });
  clear(container).append(h("div", { class: "welcome-card" },
    h("h2", null, "Welcome!"),
    h("p", { class: "lead" },
      "This site shows the history of your Spirit Island games: every finished game, with filters and statistics. "
      + "To start, add the device you play on."),
    h("h3", null, "Your device ID"),
    helpBlock(),
    form,
    h("p", { class: "muted small" },
      "Your devices and game history are saved only on this computer, in the data folder. "
      + "You can add more devices later from the Device menu.")));
  form.focusFirst();
}

/**
 * The "Manage devices" dialog: rename, remove, add.
 * @param {HTMLDialogElement} dialog
 * @param {{ devices: object[], onChanged(devices, info) }} opts
 *   info: { added?: device, removed?: uid }
 */
export function openManageDialog(dialog, { devices, onChanged }) {
  let list = devices;

  const rows = h("ul", { class: "device-list" });
  const renderRows = () => {
    clear(rows);
    if (!list.length) rows.append(h("li", { class: "muted small" }, "No devices yet. Add one below."));
    for (const d of list) rows.append(deviceRow(d));
  };

  const deviceRow = (d) => {
    const li = h("li", { class: "device-row" });
    const showView = () => {
      clear(li).append(
        h("div", { class: "device-info" },
          h("strong", null, d.name),
          h("code", { class: "device-uid", title: d.uid }, d.uid)),
        h("div", { class: "device-actions" },
          h("button", { type: "button", class: "btn btn-small", onclick: showRename }, "Rename"),
          h("button", { type: "button", class: "btn btn-small", onclick: showRemove }, "Remove")));
    };
    const showRename = () => {
      const input = h("input", { type: "text", maxlength: "40", value: d.name, "aria-label": `New name for ${d.name}` });
      const error = h("span", { class: "form-status small error", hidden: true });
      const form = h("form", {
        class: "device-rename",
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const result = await renameDevice(d.uid, input.value);
            list = result.devices;
            onChanged(list, {});
            renderRows();
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          }
        },
      },
      input,
      h("button", { type: "submit", class: "btn btn-small btn-primary" }, "Save"),
      h("button", { type: "button", class: "btn btn-small", onclick: showView }, "Cancel"),
      error);
      clear(li).append(form);
      input.select();
    };
    const showRemove = () => {
      const alsoHistory = h("input", { type: "checkbox" });
      const error = h("span", { class: "form-status small error", hidden: true });
      clear(li).append(h("div", { class: "device-remove" },
        h("p", null, `Remove “${d.name}” from your devices?`),
        h("label", { class: "opt opt-toggle small" }, alsoHistory,
          h("span", { class: "label" }, "Also delete its saved game history from this computer (can't be undone)")),
        h("div", { class: "form-actions" },
          h("button", {
            type: "button", class: "btn btn-small btn-danger",
            onclick: async () => {
              try {
                const result = await removeDevice(d.uid, { deleteHistory: alsoHistory.checked });
                list = result.devices;
                onChanged(list, { removed: d.uid });
                renderRows();
              } catch (err) {
                error.textContent = err.message;
                error.hidden = false;
              }
            },
          }, "Remove"),
          h("button", { type: "button", class: "btn btn-small", onclick: showView }, "Cancel"),
          error)));
    };
    showView();
    return li;
  };

  const addForm = buildAddForm({
    submitLabel: "Check & add",
    onAdded: (result) => {
      list = result.devices;
      onChanged(list, { added: result.device });
      renderRows();
    },
  });

  clear(dialog).append(h("div", { class: "manage" },
    h("div", { class: "manage-head" },
      h("h2", { id: "devices-title" }, "Your devices"),
      h("button", { type: "button", class: "btn", onclick: () => dialog.close(), "aria-label": "Close" }, "Close ✕")),
    rows,
    h("h3", null, "Add a device"),
    h("details", { class: "help-details" }, h("summary", null, "Where do I find the device ID?"), helpBlock()),
    addForm));
  renderRows();
  dialog.showModal();
  if (!list.length) addForm.focusFirst();
}
