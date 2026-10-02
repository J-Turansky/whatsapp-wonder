import { VERSION, CHANGELOG } from "./version.js";
import { parseChat } from "./parser.js";
import { SAMPLE_CHAT } from "./sample-chat.js";
import { getChat, setChat } from "./state.js";
import { analyzeChat } from "./analysis.js";

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
function formatDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}
function formatMonth(date) { return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderChangelog() {
  if (!changelogList) return;
  changelogList.replaceChildren();
  CHANGELOG.forEach((entry) => {
    const li = element("li", "changelog-entry");
    li.appendChild(element("h3", "", `v${entry.version}`));
    li.appendChild(element("p", "changelog-date", formatChangelogDate(entry.date)));
    const notes = document.createElement("ul");
    entry.notes.forEach((note) => notes.appendChild(element("li", "", note)));
    li.appendChild(notes);
    changelogList.appendChild(li);
  });
}
function clearChat() {
  setChat(null);
  renderImportPanel();
}
function renderImportPanel(message = "", pastedText = "") {
  appMain.replaceChildren();
  const section = element("section", "card import-card");
  section.appendChild(element("h2", "", "Import a WhatsApp chat"));
  section.appendChild(element("p", "privacy-note", "Your chat never leaves this device."));
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
  const pickerLabel = element("label", "file-picker-label", "Choose a .txt chat export");
  pickerLabel.htmlFor = "chat-file";
  section.appendChild(pickerLabel);
  const drop = element("button", "drop-zone");
  drop.type = "button";
  drop.setAttribute("aria-describedby", "drop-help import-error");
  const dropTitle = element("span", "drop-title", "Or drop your _chat.txt file here");
  const dropHelp = element("span", "", "You can also click to choose a file");
  dropHelp.id = "drop-help";
  drop.append(dropTitle, dropHelp);
  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-dragging"); });
  drop.addEventListener("dragleave", (event) => { if (!drop.contains(event.relatedTarget)) drop.classList.remove("is-dragging"); });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });
  section.appendChild(drop);
  section.appendChild(element("p", "import-divider", "Or paste your chat text below"));
  const label = element("label", "", "Or paste your chat text");
  label.htmlFor = "chat-paste";
  section.appendChild(label);
  const textarea = document.createElement("textarea");
  textarea.id = "chat-paste";
  textarea.rows = 8;
  textarea.autocomplete = "off";
  textarea.spellcheck = false;
  textarea.value = pastedText;
  section.appendChild(textarea);
  const actions = element("div", "import-actions");
  const readButton = element("button", "primary-button", "Read pasted chat");
  readButton.type = "button";
  readButton.addEventListener("click", () => analyseText(textarea.value));
  const sample = element("button", "secondary-button", "Try a sample chat");
  sample.type = "button";
  sample.addEventListener("click", () => analyseText(SAMPLE_CHAT));
  actions.append(readButton, sample);
  section.appendChild(actions);
  section.appendChild(element("p", "import-tip", "In WhatsApp: open the chat → ⋮ / contact name → Export chat → Without media. If you get a .zip, unzip it and pick _chat.txt."));
  const error = element("p", "import-error", message);
  error.id = "import-error";
  error.setAttribute("role", "alert");
  section.appendChild(error);
  appMain.appendChild(section);
}
function showImportError(message) {
  const error = document.getElementById("import-error");
  if (error) error.textContent = message;
}
function readFile(file) {
  if (!/\.txt$/i.test(file.name)) { showImportError(NO_MESSAGES); return; }
  file.text().then(analyseText).catch((error) => {
    console.error("Could not read the selected chat file.", error);
    showImportError("We couldn't read that file. Please choose a readable .txt export or paste its text.");
  });
}
function analyseText(text) {
  const result = parseChat(text);
  if (!result.messages.some((message) => !message.isSystem)) { showImportError(NO_MESSAGES); return; }
  setChat(result);
  renderConfirmation(result);
}

function addSummary(card, chat) {
  const summary = element("dl", "chat-summary");
  const authored = chat.messages.filter((message) => !message.isSystem);
  const media = authored.filter((message) => message.isMedia).length;
  const fields = [
    ["Messages", authored.length.toLocaleString("en-US")],
    ["Participants", String(chat.participants.length)],
    ["Date range", `${formatDate(chat.startDate)} – ${formatDate(chat.endDate)}`],
    ["Media", String(media)]
  ];
  fields.forEach(([term, value]) => {
    const wrapper = document.createElement("div");
    wrapper.append(element("dt", "", term), element("dd", "", value));
    if (term === "Participants" && chat.participants.length) wrapper.appendChild(element("p", "participant-names", chat.participants.join(", ")));
    summary.appendChild(wrapper);
  });
  card.appendChild(summary);
}
function makeMetricCard(label, value) {
  const card = element("div", "metric-card");
  card.append(element("dt", "", label), element("dd", "", value.toLocaleString("en-US")));
  return card;
}
function appendBarChart(section, title, description, values) {
  const chart = element("section", "chart-section");
  chart.appendChild(element("h3", "", title));
  chart.appendChild(element("p", "chart-description", description));
  const max = Math.max(0, ...values.map((entry) => entry.count));
  const list = element("ol", "bar-chart");
  values.forEach((entry) => {
    const row = element("li", "bar-row");
    row.setAttribute("aria-label", `${entry.label}: ${entry.count} ${entry.count === 1 ? "message" : "messages"}`);
    row.appendChild(element("span", "bar-label", entry.label));
    const track = element("span", "bar-track");
    track.setAttribute("aria-hidden", "true");
    const fill = element("span", "bar-fill");
    fill.style.width = max ? `${entry.count / max * 100}%` : "0%";
    track.appendChild(fill);
    row.append(track, element("span", "bar-count", String(entry.count)));
    list.appendChild(row);
  });
  chart.appendChild(list);
  section.appendChild(chart);
}
function renderStats(data) {
  const section = element("section", "analysis-panel stats-panel");
  section.setAttribute("aria-labelledby", "stats-heading");
  const heading = element("h2", "", "Chat statistics");
  heading.id = "stats-heading";
  section.appendChild(heading);
  const metrics = element("dl", "metric-grid");
  metrics.append(makeMetricCard("Messages", data.totalMessages), makeMetricCard("Words", data.totalWords),
    makeMetricCard("Media", data.totalMedia), makeMetricCard("Active days", data.activeDays));
  section.appendChild(metrics);

  const peopleSection = element("section", "chart-section");
  peopleSection.appendChild(element("h3", "", "By participant"));
  const tableWrap = element("div", "table-scroll");
  const table = document.createElement("table");
  table.className = "participant-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Participant", "Messages", "Words", "Media", "Share of chat"].forEach((text) => headRow.appendChild(element("th", "", text)));
  head.appendChild(headRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  data.people.forEach((person) => {
    const row = document.createElement("tr");
    row.appendChild(element("th", "", person.name));
    [person.messages, person.words, person.media, `${person.messages.toLocaleString("en-US")} (${(person.messages / data.totalMessages * 100).toFixed(1)}%)`]
      .forEach((value) => row.appendChild(element("td", "", String(value))));
    body.appendChild(row);
  });
  table.appendChild(body);
  tableWrap.appendChild(table);
  peopleSection.appendChild(tableWrap);
  section.appendChild(peopleSection);
  appendBarChart(section, "Messages by hour", "Local hour of each authored message; each bar is relative to the busiest hour.", data.hourly);
  appendBarChart(section, "Messages by weekday", "Local weekday of each authored message; each bar is relative to the busiest weekday.", data.weekdays);

  const rankings = element("div", "ranking-grid");
  const wordSection = element("section", "chart-section ranking-section");
  wordSection.appendChild(element("h3", "", "Top words"));
  if (data.topWords.length) {
    const list = document.createElement("ol");
    data.topWords.forEach(({ item, count }) => list.appendChild(element("li", "", `${item} — ${count}`)));
    wordSection.appendChild(list);
  } else wordSection.appendChild(element("p", "", "No ranking words found (media and common short words are excluded)."));
  rankings.appendChild(wordSection);
  const emojiSection = element("section", "chart-section ranking-section");
  emojiSection.appendChild(element("h3", "", "Top emoji"));
  if (!data.emojiAvailable) emojiSection.appendChild(element("p", "", "Emoji rankings are unavailable in this browser because grapheme segmentation is not supported."));
  else if (data.topEmoji.length) {
    const list = document.createElement("ol");
    data.topEmoji.forEach(({ item, count }) => list.appendChild(element("li", "", `${item} — ${count}`)));
    emojiSection.appendChild(list);
  } else emojiSection.appendChild(element("p", "", "No emoji found in non-media messages."));
  rankings.appendChild(emojiSection);
  section.appendChild(rankings);
  return section;
}
function renderAwards(awards) {
  const section = element("section", "analysis-panel awards-panel");
  section.setAttribute("aria-labelledby", "awards-heading");
  const heading = element("h2", "", "Fun facts and joke awards");
  heading.id = "awards-heading";
  section.appendChild(heading);
  section.appendChild(element("p", "eligibility-note", "Awards only appear when the chat contains a qualifying event. Message text excludes media placeholders; reply times use observed messages in sessions under six hours apart."));
  const grid = element("div", "award-grid");
  if (!awards.length) grid.appendChild(element("p", "friendly-empty", "Not enough chat yet for an award. Keep chatting and there may be one next time."));
  awards.forEach((award, index) => {
    const card = element("article", "award-card");
    const titleId = `award-title-${index}`;
    const h = element("h3", "", award.title);
    h.id = titleId;
    card.setAttribute("aria-labelledby", titleId);
    card.appendChild(h);
    card.appendChild(element("p", "award-winner", award.name));
    card.appendChild(element("p", "award-metric", `${award.metric} — ${award.measure}.`));
    card.appendChild(element("p", "award-cheeky", award.cheeky));
    const feedback = element("p", "copy-feedback");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("role", "status");
    const copy = element("button", "secondary-button", "Copy award");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      feedback.textContent = "";
      const text = `${award.title}\n${award.name}\n${award.metric} — ${award.measure}.\n${award.cheeky}`;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
        await navigator.clipboard.writeText(text);
        feedback.textContent = "Award copied.";
        feedback.classList.remove("copy-error");
      } catch (error) {
        feedback.textContent = `Could not copy award: ${error.message || "clipboard access was denied."}`;
        feedback.classList.add("copy-error");
      }
    });
    card.append(copy, feedback);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  return section;
}
function renderStory(story) {
  const section = element("section", "analysis-panel story-panel");
  section.setAttribute("aria-labelledby", "story-heading");
  const heading = element("h2", "", "Your chat story");
  heading.id = "story-heading";
  section.appendChild(heading);
  const intro = element("p", "story-intro", `This chat began on ${formatDate(story.first.date)}${story.first.author ? ` with ${story.first.author}` : ""}.`);
  section.appendChild(intro);
  const narrative = element("ul", "story-facts");
  narrative.appendChild(element("li", "", `The busiest day was ${formatDate(story.busiestDay.date)}, with ${story.busiestDay.count} ${story.busiestDay.count === 1 ? "message" : "messages"}.`));
  narrative.appendChild(element("li", "", `${formatMonth(story.busiestMonth.date)} was the busiest month, with ${story.busiestMonth.count} ${story.busiestMonth.count === 1 ? "message" : "messages"}.`));
  if (!story.quietest || story.quietest.silentDays === 0) narrative.appendChild(element("li", "", "No full silent days between active dates."));
  else narrative.appendChild(element("li", "", `The quietest stretch had ${story.quietest.silentDays} full silent ${story.quietest.silentDays === 1 ? "day" : "days"} between ${formatDate(story.quietest.start)} and ${formatDate(story.quietest.end)}.`));
  narrative.appendChild(element("li", "", `The longest active streak was ${story.streak.length} ${story.streak.length === 1 ? "day" : "days"}, from ${formatDate(story.streak.start)} to ${formatDate(story.streak.end)}.`));
  narrative.appendChild(element("li", "", `${story.starter.name} began the most conversations, with ${story.starter.count} ${story.starter.count === 1 ? "session" : "sessions"} started.`));
  section.appendChild(narrative);
  const timeline = element("section", "chart-section timeline-section");
  timeline.appendChild(element("h3", "", "Month-by-month timeline"));
  timeline.appendChild(element("p", "chart-description", "Authored message counts from the first through last active month, including months with no messages."));
  const list = element("ol", "timeline-list");
  story.timeline.forEach((month) => {
    const item = document.createElement("li");
    item.append(element("span", "timeline-month", formatMonth(month.date)), element("span", "timeline-count", `${month.count} ${month.count === 1 ? "message" : "messages"}`));
    list.appendChild(item);
  });
  timeline.appendChild(list);
  section.appendChild(timeline);
  return section;
}
function selectView(name, focus = false) {
  const buttons = Array.from(document.querySelectorAll("[data-view]"));
  buttons.forEach((button) => {
    const selected = button.dataset.view === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(`${button.dataset.view}-view`).hidden = !selected;
  });
  if (focus) document.querySelector(`[data-view="${name}"]`)?.focus();
}
function renderConfirmation(chat) {
  const analysis = analyzeChat(chat);
  appMain.replaceChildren();
  const loaded = element("div", "loaded-chat");
  const card = element("section", "card confirmation-card");
  card.setAttribute("aria-labelledby", "confirmation-title");
  const title = element("h2", "", "Chat loaded");
  title.id = "confirmation-title";
  title.tabIndex = -1;
  card.appendChild(title);
  card.appendChild(element("p", "", chat.format === "iOS" ? "iPhone (iOS) export" : `${chat.format || "Unknown"} export`));
  addSummary(card, chat);
  const reset = element("button", "primary-button", "Load a different chat");
  reset.type = "button";
  reset.addEventListener("click", clearChat);
  card.appendChild(reset);
  loaded.appendChild(card);

  const workspace = element("section", "analysis-workspace");
  workspace.setAttribute("aria-label", "Chat analysis");
  const nav = element("div", "view-nav");
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Chat views");
  [ ["stats", "Stats"], ["awards", "Awards"], ["story", "Story"] ].forEach(([view, label], index) => {
    const button = element("button", "view-tab", label);
    button.type = "button";
    button.dataset.view = view;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${view}-view`);
    button.setAttribute("aria-selected", String(index === 0));
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("click", () => selectView(view));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const order = ["stats", "awards", "story"];
      const current = order.indexOf(view);
      const next = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : (current + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length;
      selectView(order[next], true);
    });
    nav.appendChild(button);
  });
  workspace.appendChild(nav);
  const statsView = element("div", "view-panel");
  statsView.id = "stats-view";
  statsView.setAttribute("role", "tabpanel");
  statsView.setAttribute("aria-labelledby", "stats-tab");
  statsView.appendChild(renderStats(analysis.stats));
  const awardsView = element("div", "view-panel");
  awardsView.id = "awards-view";
  awardsView.setAttribute("role", "tabpanel");
  awardsView.setAttribute("aria-labelledby", "awards-tab");
  awardsView.hidden = true;
  awardsView.appendChild(renderAwards(analysis.awards));
  const storyView = element("div", "view-panel");
  storyView.id = "story-view";
  storyView.setAttribute("role", "tabpanel");
  storyView.setAttribute("aria-labelledby", "story-tab");
  storyView.hidden = true;
  storyView.appendChild(renderStory(analysis.story));
  workspace.append(statsView, awardsView, storyView);
  loaded.appendChild(workspace);
  appMain.appendChild(loaded);
  document.querySelector('[data-view="stats"]').id = "stats-tab";
  document.querySelector('[data-view="awards"]').id = "awards-tab";
  document.querySelector('[data-view="story"]').id = "story-tab";
  title.focus();
}

function selectInfoTab(tab) {
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
  tab.addEventListener("click", () => selectInfoTab(tab));
  tab.addEventListener("keydown", (event) => {
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next !== null) { event.preventDefault(); selectInfoTab(tabs[next]); }
  });
});
function openDialog() { dialog.showModal(); selectInfoTab(document.getElementById("tab-how")); }
infoBtn.addEventListener("click", openDialog);
closeBtn.addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => infoBtn.focus());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

renderChangelog();
if (getChat()) renderConfirmation(getChat());
else renderImportPanel();