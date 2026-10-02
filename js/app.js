import { VERSION, CHANGELOG } from "./version.js";
import { parseChat } from "./parser.js";
import { SAMPLE_CHAT } from "./sample-chat.js";
import { getChat, setChat } from "./state.js";

const badge = document.getElementById("version-badge");
if (badge) badge.textContent = `v${VERSION}`;

const dialog = document.getElementById("info-dialog");
const infoBtn = document.getElementById("info-btn");
const closeBtn = document.getElementById("close-dialog-btn");
const changelogList = document.getElementById("changelog-list");
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
const panelWrapper = document.querySelector(".tabpanel-wrapper");
const appMain = document.getElementById("app-main");
const NO_MESSAGES = "We couldn't find any WhatsApp messages in that. Make sure it's the _chat.txt from 'Export chat'.";

function formatChangelogDate(isoDate) {
  const parts = isoDate.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : isoDate;
}

function renderChangelog() {
  if (!changelogList) return;
  changelogList.replaceChildren();
  CHANGELOG.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "changelog-entry";
    const heading = document.createElement("h3");
    heading.textContent = `v${entry.version}`;
    li.appendChild(heading);
    const date = document.createElement("p");
    date.className = "changelog-date";
    date.textContent = formatChangelogDate(entry.date);
    li.appendChild(date);
    const notesList = document.createElement("ul");
    entry.notes.forEach((note) => {
      const noteItem = document.createElement("li");
      noteItem.textContent = note;
      notesList.appendChild(noteItem);
    });
    li.appendChild(notesList);
    changelogList.appendChild(li);
  });
}

function clearChat() {
  setChat(null);
  renderImportPanel();
}

function renderImportPanel(message = "", pastedText = "") {
  appMain.replaceChildren();
  const section = document.createElement("section");
  section.className = "card import-card";
  const heading = document.createElement("h2");
  heading.textContent = "Import a WhatsApp chat";
  section.appendChild(heading);
  const privacy = document.createElement("p");
  privacy.className = "privacy-note";
  privacy.textContent = "Your chat never leaves this device.";
  section.appendChild(privacy);

  const picker = document.createElement("input");
  picker.className = "visually-hidden";
  picker.id = "chat-file";
  picker.type = "file";
  picker.accept = ".txt,text/plain";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file) readFile(file);
  });
  section.appendChild(picker);
  const pickerLabel = document.createElement("label");
  pickerLabel.className = "file-picker-label";
  pickerLabel.htmlFor = "chat-file";
  pickerLabel.textContent = "Choose a .txt chat export";
  section.appendChild(pickerLabel);

  const drop = document.createElement("button");
  drop.className = "drop-zone";
  drop.type = "button";
  drop.setAttribute("aria-describedby", "drop-help import-error");
  drop.innerHTML = "<span class=\"drop-title\">Or drop your _chat.txt file here</span><span id=\"drop-help\">You can also click to choose a file</span>";
  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-dragging");
  });
  drop.addEventListener("dragleave", (event) => {
    if (!drop.contains(event.relatedTarget)) drop.classList.remove("is-dragging");
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });
  section.appendChild(drop);

  const divider = document.createElement("p");
  divider.className = "import-divider";
  divider.textContent = "Or paste your chat text below";
  section.appendChild(divider);
  const label = document.createElement("label");
  label.htmlFor = "chat-paste";
  label.textContent = "Or paste your chat text";
  section.appendChild(label);
  const textarea = document.createElement("textarea");
  textarea.id = "chat-paste";
  textarea.rows = 8;
  textarea.autocomplete = "off";
  textarea.spellcheck = false;
  textarea.value = pastedText;
  section.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "import-actions";
  const readButton = document.createElement("button");
  readButton.type = "button";
  readButton.className = "primary-button";
  readButton.textContent = "Read pasted chat";
  readButton.addEventListener("click", () => analyseText(textarea.value));
  const sample = document.createElement("button");
  sample.type = "button";
  sample.className = "secondary-button";
  sample.textContent = "Try a sample chat";
  sample.addEventListener("click", () => analyseText(SAMPLE_CHAT));
  actions.append(readButton, sample);
  section.appendChild(actions);

  const tip = document.createElement("p");
  tip.className = "import-tip";
  tip.textContent = "In WhatsApp: open the chat → ⋮ / contact name → Export chat → Without media. If you get a .zip, unzip it and pick _chat.txt.";
  section.appendChild(tip);

  const error = document.createElement("p");
  error.id = "import-error";
  error.className = "import-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  section.appendChild(error);
  appMain.appendChild(section);
}

function showImportError(message) {
  const error = document.getElementById("import-error");
  if (error) error.textContent = message;
}

function readFile(file) {
  if (!/\.txt$/i.test(file.name)) {
    showImportError(NO_MESSAGES);
    return;
  }
  file.text().then(analyseText).catch((error) => {
    console.error("Could not read the selected chat file.", error);
    showImportError("We couldn't read that file. Please choose a readable .txt export or paste its text.");
  });
}

function analyseText(text) {
  const result = parseChat(text);
  if (!result.messages.some((message) => !message.isSystem)) {
    showImportError(NO_MESSAGES);
    return;
  }
  setChat(result);
  renderConfirmation(result);
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function renderConfirmation(chat) {
  appMain.replaceChildren();
  const card = document.createElement("section");
  card.className = "card confirmation-card";
  card.setAttribute("aria-labelledby", "confirmation-title");
  const title = document.createElement("h2");
  title.id = "confirmation-title";
  title.tabIndex = -1;
  title.textContent = "Chat loaded";
  card.appendChild(title);
  const formatLabel = document.createElement("p");
  formatLabel.textContent = chat.format === "iOS" ? "iPhone (iOS) export" : (chat.format || "Unknown") + " export";
  card.appendChild(formatLabel);

  const summary = document.createElement("dl");
  summary.className = "chat-summary";
  const messageCount = chat.messages.filter((message) => !message.isSystem).length;
  const mediaCount = chat.messages.filter((message) => message.isMedia).length;
  const fields = [
    ["Messages", messageCount.toLocaleString("en-US")],
    ["Participants", String(chat.participants.length)],
    ["Date range", formatDate(chat.startDate) + " – " + formatDate(chat.endDate)],
    ["Media", String(mediaCount)]
  ];
  for (const [term, value] of fields) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    wrapper.append(dt, dd);
    if (term === "Participants" && chat.participants.length) {
      const names = document.createElement("p");
      names.className = "participant-names";
      names.textContent = chat.participants.join(", ");
      wrapper.appendChild(names);
    }
    summary.appendChild(wrapper);
  }
  card.appendChild(summary);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "primary-button";
  reset.textContent = "Load a different chat";
  reset.addEventListener("click", clearChat);
  card.appendChild(reset);
  appMain.appendChild(card);
  title.focus();
}

function selectTab(tab) {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel) => {
    const show = panel.id === tab.getAttribute("aria-controls");
    panel.hidden = !show;
    if (show) panel.scrollTop = 0;
  });
  if (panelWrapper) panelWrapper.scrollTop = 0;
  tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next !== null) {
      event.preventDefault();
      selectTab(tabs[next]);
    }
  });
});

function openDialog() {
  dialog.showModal();
  selectTab(document.getElementById("tab-how"));
}

infoBtn.addEventListener("click", openDialog);
closeBtn.addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => infoBtn.focus());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

renderChangelog();
if (getChat()) renderConfirmation(getChat());
else renderImportPanel();
