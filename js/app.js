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
const NO_MESSAGES = "We couldn't find any WhatsApp messages in that text. Make sure it's an exported chat (.txt).";

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
  privacy.textContent = "Your chat never leaves your device.";
  section.appendChild(privacy);

  const picker = document.createElement("input");
  picker.className = "visually-hidden";
  picker.id = "chat-file";
  picker.type = "file";
  picker.accept = ".txt,text/plain";
  picker.setAttribute("aria-label", "Choose a WhatsApp chat text file");
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file) readFile(file);
  });
  section.appendChild(picker);

  const drop = document.createElement("button");
  drop.className = "drop-zone";
  drop.type = "button";
  drop.setAttribute("aria-describedby", "drop-help import-error");
  drop.innerHTML = "<span class=\"drop-title\">Choose your _chat.txt file</span><span id=\"drop-help\">or drop it here</span>";
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
  divider.textContent = "Or paste the exported text";
  section.appendChild(divider);
  const label = document.createElement("label");
  label.htmlFor = "chat-paste";
  label.textContent = "Paste chat text";
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
  const analyse = document.createElement("button");
  analyse.type = "button";
  analyse.className = "primary-button";
  analyse.textContent = "Analyse pasted text";
  analyse.addEventListener("click", () => analyseText(textarea.value));
  const sample = document.createElement("button");
  sample.type = "button";
  sample.className = "secondary-button";
  sample.textContent = "Try a sample chat";
  sample.addEventListener("click", () => analyseText(SAMPLE_CHAT));
  actions.append(analyse, sample);
  section.appendChild(actions);

  const error = document.createElement("p");
  error.id = "import-error";
  error.className = "import-error";
  error.setAttribute("aria-live", "polite");
  error.setAttribute("role", "status");
  error.textContent = message;
  section.appendChild(error);
  appMain.appendChild(section);
}

function readFile(file) {
  if (/\.zip$/i.test(file.name)) {
    renderImportPanel("Please unzip the export first and choose the _chat.txt file inside.");
    return;
  }
  file.text().then(analyseText).catch((error) => {
    console.error("Could not read the selected chat file.", error);
    renderImportPanel("We couldn't read that file. Please choose a readable .txt export or paste its text.");
  });
}

function analyseText(text) {
  const result = parseChat(text);
  if (!result.messages.some((message) => !message.isSystem)) {
    renderImportPanel(NO_MESSAGES, text);
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
  title.textContent = "Your chat is ready";
  card.appendChild(title);
  const summary = document.createElement("dl");
  summary.className = "chat-summary";
  const messageCount = chat.messages.filter((message) => !message.isSystem).length;
  const fields = [
    ["Messages", messageCount.toLocaleString("en-US")],
    ["Participants", String(chat.participants.length)]
  ];
  for (const [term, value] of fields) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    wrapper.append(dt, dd);
    summary.appendChild(wrapper);
  }
  const participants = document.createElement("div");
  participants.className = "participant-row";
  const participantTerm = document.createElement("dt");
  participantTerm.textContent = "In this chat";
  const participantValue = document.createElement("dd");
  const names = chat.participants.slice(0, 10);
  participantValue.textContent = names.join(", ");
  if (chat.participants.length > 10) participantValue.append(` +${chat.participants.length - 10} more`);
  participants.append(participantTerm, participantValue);
  summary.appendChild(participants);

  const range = document.createElement("div");
  const rangeTerm = document.createElement("dt");
  rangeTerm.textContent = "Date range";
  const rangeValue = document.createElement("dd");
  rangeValue.textContent = `${formatDate(chat.startDate)} – ${formatDate(chat.endDate)}`;
  range.append(rangeTerm, rangeValue);
  summary.appendChild(range);
  const format = document.createElement("div");
  const formatTerm = document.createElement("dt");
  formatTerm.textContent = "Format";
  const formatValue = document.createElement("dd");
  formatValue.textContent = chat.format || "Unknown";
  format.append(formatTerm, formatValue);
  summary.appendChild(format);
  card.appendChild(summary);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "primary-button";
  reset.textContent = "Import a different chat";
  reset.addEventListener("click", clearChat);
  card.appendChild(reset);
  appMain.appendChild(card);
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
