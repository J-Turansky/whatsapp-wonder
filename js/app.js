import { VERSION, CHANGELOG } from "./version.js";
import { parseChat } from "./parser.js";
import { extractWhatsAppText } from "./zip.js";
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
let pendingText = null;
let confirmedChat = null;
let filterSettings = { from: "", to: "", participant: "" };
let appliedFilter = { ...filterSettings };
let activeView = "stats";
let messageQuery = "";
let messagePage = 1;

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
  pendingText = null;
  confirmedChat = null;
  filterSettings = { from: "", to: "", participant: "" };
  appliedFilter = { ...filterSettings };
  messageQuery = "";
  messagePage = 1;
  activeView = "stats";
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
  picker.accept = ".txt,.zip,text/plain,application/zip,application/x-zip-compressed";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file) readFile(file);
  });
  section.appendChild(picker);
  const pickerLabel = element("label", "file-picker-label", "Choose a .txt or .zip chat export");
  pickerLabel.htmlFor = "chat-file";
  section.appendChild(pickerLabel);
  const drop = element("button", "drop-zone");
  drop.type = "button";
  drop.setAttribute("aria-describedby", "drop-help import-error");
  const dropTitle = element("span", "drop-title", "Or drop your .txt or .zip file here");
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
  const label = element("label", "", "Paste your chat text");
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
  const readButton = element("button", "primary-button", "Review pasted chat");
  readButton.type = "button";
  readButton.addEventListener("click", () => beginReview(textarea.value));
  const sample = element("button", "secondary-button", "Try a sample chat");
  sample.type = "button";
  sample.addEventListener("click", () => beginReview(SAMPLE_CHAT));
  actions.append(readButton, sample);
  section.appendChild(actions);
  section.appendChild(element("p", "import-tip", "In WhatsApp, choose Export chat. A ZIP may include media; only one chat .txt is read. Archive cap: 25 MB; extracted chat text cap: 20 MB. No files are uploaded or saved."));
  const error = element("p", "import-error", message);
  error.id = "import-error";
  error.setAttribute("role", "alert");
  section.appendChild(error);
  appMain.appendChild(section);
}
function showImportError(message) {
  const error = document.getElementById("import-error");
  if (error) error.textContent = message;
  else renderImportPanel(message);
}
async function readFile(file) {
  clearChat();
  if (/\.txt$/i.test(file.name)) {
    if (file.size > 20 * 1024 * 1024) { showImportError("This chat text exceeds the 20 MB limit. Choose a smaller .txt export."); return; }
    try { beginReview(await file.text()); }
    catch (error) {
      console.error("Could not read the selected chat file.", error);
      showImportError("We couldn't read that file. Choose a readable .txt export or paste its text.");
    }
  } else if (/\.zip$/i.test(file.name)) {
    try { beginReview(await extractWhatsAppText(file)); }
    catch (error) { showImportError(error instanceof Error ? error.message : "We couldn't read this ZIP. Import an unzipped .txt file instead."); }
  } else showImportError("Choose a .txt or .zip WhatsApp export, or paste chat text.");
}
function beginReview(text, selectedOrder = null) {
  pendingText = String(text ?? "");
  setChat(null);
  const result = parseChat(pendingText, selectedOrder);
  renderReview(result);
}
function datePreview(previews) {
  return previews.map(({ original, dayFirst, monthFirst }) => `${original} → day/month/year: ${formatDate(dayFirst)}; month/day/year: ${formatDate(monthFirst)}`).join(" | ");
}
function renderReview(chat) {
  let reviewed = chat;
  appMain.replaceChildren();
  const card = element("section", "card review-card");
  const title = element("h2", "", "Review import quality");
  title.tabIndex = -1;
  card.appendChild(title);
  card.appendChild(element("p", "", chat.format === "iOS" ? "Detected format: iPhone (iOS)" : `Detected format: ${chat.format || "Unknown"}`));
  const counts = element("dl", "quality-summary");
  [["Authored messages", chat.quality.authoredMessages], ["System entries", chat.quality.systemEntries], ["Skipped nonempty lines", chat.quality.skippedLines]].forEach(([label, value]) => {
    const item = document.createElement("div"); item.append(element("dt", "", label), element("dd", "", String(value))); counts.appendChild(item);
  });
  card.appendChild(counts);
  const status = element("p", "date-order-status");
  const updateReview = (order) => {
    reviewed = parseChat(pendingText, order);
    [reviewed.quality.authoredMessages, reviewed.quality.systemEntries, reviewed.quality.skippedLines].forEach((value, index) => { counts.children[index].querySelector("dd").textContent = String(value); });
    status.textContent = `Date order: ${reviewed.dateOrder === "month-first" ? "Month/day/year" : "Day/month/year"} (selected; confirm below).`;
    card.querySelectorAll('input[name="date-order"]').forEach((input) => { input.checked = input.value === order; });
    show.hidden = reviewed.authoredCount === 0;
    noAuthored.hidden = reviewed.authoredCount > 0;
  };
  if (chat.dateStatus === "ambiguous") {
    card.appendChild(element("p", "", "These dates can be read in either order. Choose an interpretation; no insights are available until you confirm."));
    card.appendChild(element("p", "date-example", datePreview(chat.previews)));
    const choices = element("fieldset", "date-choices");
    choices.appendChild(element("legend", "", "Choose date order"));
    [["day-first", "Day/month/year"], ["month-first", "Month/day/year"]].forEach(([value, label]) => {
      const wrap = element("label", "choice-label");
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "date-order"; radio.value = value;
      radio.addEventListener("change", () => { if (radio.checked) updateReview(value); });
      wrap.append(radio, document.createTextNode(label)); choices.appendChild(wrap);
    });
    card.appendChild(choices);
  } else if (chat.dateStatus === "conflict") {
    card.appendChild(element("p", "review-error", "The export contains dates that require contradictory day/month/year and month/day/year interpretations. It cannot be interpreted reliably; choose another export."));
  } else {
    status.textContent = `Date order: ${chat.dateOrder === "month-first" ? "Month/day/year" : "Day/month/year"} (inferred from valid dates).`;
  }
  if (chat.dateStatus !== "conflict") card.appendChild(status);
  const noAuthored = element("p", "review-error", "No valid authored messages were found. Check the export format and dates before trying again.");
  noAuthored.hidden = chat.authoredCount > 0;
  card.appendChild(noAuthored);
  const show = element("button", "primary-button", "Show insights");
  show.type = "button";
  show.hidden = chat.dateStatus === "ambiguous" || chat.dateStatus === "conflict" || chat.authoredCount === 0;
  show.addEventListener("click", () => {
    if (reviewed.dateStatus === "ambiguous" || reviewed.dateStatus === "conflict" || !reviewed.authoredCount) return;
    pendingText = null;
    confirmedChat = reviewed;
    setChat(reviewed);
    filterSettings = { from: "", to: "", participant: "" };
    appliedFilter = { ...filterSettings };
    messageQuery = ""; messagePage = 1; activeView = "stats";
    renderConfirmation(reviewed);
  });
  card.appendChild(show);
  const reset = element("button", "secondary-button", "Choose another chat");
  reset.type = "button"; reset.addEventListener("click", clearChat); card.appendChild(reset);
  appMain.appendChild(card);
  title.focus();
}
function addSummary(card, chat) {
  const summary = element("dl", "chat-summary");
  const authored = chat.messages.filter((message) => !message.isSystem);
  const media = authored.filter((message) => message.isMedia).length;
  const fields = [
    ["Authored messages", authored.length.toLocaleString("en-US")],
    ["Participants", String(chat.participants.length)],
    ["Date range", `${formatDate(chat.startDate)} – ${formatDate(chat.endDate)}`],
    ["Media messages", String(media)],
    ["System entries", String(chat.systemCount)],
    ["Skipped nonempty lines", String(chat.skippedLines)],
    ["Date interpretation", chat.dateOrder === "month-first" ? "Month/day/year" : "Day/month/year"]
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
  activeView = name;
  const buttons = Array.from(document.querySelectorAll("[data-view]"));
  buttons.forEach((button) => {
    const selected = button.dataset.view === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(`${button.dataset.view}-view`).hidden = !selected;
  });
  if (focus) document.querySelector(`[data-view="${name}"]`)?.focus();
}
function localDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function validDateValue(value) {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(0); date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}
function renderConfirmation(chat) {
  confirmedChat = chat;
  appMain.replaceChildren();
  const loaded = element("div", "loaded-chat");
  const card = element("section", "card confirmation-card");
  card.setAttribute("aria-labelledby", "confirmation-title");
  const title = element("h2", "", "Chat loaded"); title.id = "confirmation-title"; title.tabIndex = -1;
  card.appendChild(title);
  card.appendChild(element("p", "", `${chat.format === "iOS" ? "iPhone (iOS)" : chat.format || "Unknown"} export · ${chat.dateOrder === "month-first" ? "Month/day/year" : "Day/month/year"} interpretation confirmed`));
  addSummary(card, chat);
  const reset = element("button", "primary-button", "Load a different chat"); reset.type = "button"; reset.addEventListener("click", clearChat); card.appendChild(reset);
  loaded.appendChild(card);
  const workspace = element("section", "analysis-workspace"); workspace.setAttribute("aria-label", "Chat analysis");
  const filterBar = element("form", "filter-bar"); filterBar.setAttribute("aria-label", "Filter all insights");
  const dateHint = element("p", "filter-hint", "Dates use the confirmed interpretation above; date boundaries include the entire local calendar day."); filterBar.appendChild(dateHint);
  const fromLabel = element("label", "", "From"); const from = document.createElement("input"); from.type = "date"; from.id = "filter-from"; from.value = filterSettings.from; from.setAttribute("aria-describedby", "filter-error"); fromLabel.appendChild(from);
  const toLabel = element("label", "", "To"); const to = document.createElement("input"); to.type = "date"; to.id = "filter-to"; to.value = filterSettings.to; to.setAttribute("aria-describedby", "filter-error"); toLabel.appendChild(to);
  const participantLabel = element("label", "", "Participant"); const participant = document.createElement("select"); participant.id = "filter-participant";
  const allOption = element("option", "", "All participants"); allOption.value = ""; participant.appendChild(allOption);
  chat.participants.forEach((name) => { const option = element("option", "", name); option.value = name; participant.appendChild(option); });
  participant.value = filterSettings.participant; participantLabel.appendChild(participant);
  const actions = element("div", "filter-actions"); const apply = element("button", "primary-button", "Apply filters"); apply.type = "submit";
  const clear = element("button", "secondary-button", "Clear filters"); clear.type = "button";
  actions.append(apply, clear);
  const error = element("p", "filter-error"); error.id = "filter-error"; error.setAttribute("role", "alert"); error.setAttribute("aria-live", "polite");
  filterBar.append(fromLabel, toLabel, participantLabel, actions, error);
  const scope = element("p", "scope-summary"); scope.id = "scope-summary"; scope.setAttribute("aria-live", "polite");
  filterBar.appendChild(scope);
  filterBar.addEventListener("submit", (event) => {
    event.preventDefault(); error.textContent = "";
    if (!validDateValue(from.value) || !validDateValue(to.value)) { error.textContent = "Enter valid calendar dates for both filter boundaries."; return; }
    if (from.value && to.value && from.value > to.value) { error.textContent = "From must be on or before To. Filters were not applied."; return; }
    filterSettings = { from: from.value, to: to.value, participant: participant.value };
    appliedFilter = { ...filterSettings }; messagePage = 1; renderConfirmation(chat);
  });
  clear.addEventListener("click", () => {
    filterSettings = { from: "", to: "", participant: "" }; appliedFilter = { ...filterSettings }; messagePage = 1; renderConfirmation(chat);
  });
  workspace.appendChild(filterBar);
  const scoped = chat.messages.filter((message) => {
    if (message.isSystem || !message.author) return false;
    const key = localDateKey(message.date);
    return (!appliedFilter.from || key >= appliedFilter.from) && (!appliedFilter.to || key <= appliedFilter.to) && (!appliedFilter.participant || message.author === appliedFilter.participant);
  });
  const dateScope = appliedFilter.from || appliedFilter.to
    ? `${appliedFilter.from ? formatDate(new Date(`${appliedFilter.from}T00:00:00`)) : "Any date"} to ${appliedFilter.to ? formatDate(new Date(`${appliedFilter.to}T00:00:00`)) : "Any date"}` : "All dates";
  scope.textContent = `${dateScope} · ${appliedFilter.participant || "All participants"} · ${scoped.length.toLocaleString("en-US")} ${scoped.length === 1 ? "message" : "messages"}`;
  const nav = element("div", "view-nav"); nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Chat views");
  const viewNames = [["stats", "Stats"], ["awards", "Awards"], ["story", "Story"], ["messages", "Messages"]];
  viewNames.forEach(([view, label], index) => {
    const button = element("button", "view-tab", label); button.type = "button"; button.dataset.view = view;
    button.id = `${view}-tab`; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", `${view}-view`);
    button.setAttribute("aria-selected", String(activeView === view)); button.tabIndex = activeView === view ? 0 : -1;
    button.addEventListener("click", () => selectView(view));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const current = viewNames.findIndex(([name]) => name === view);
      const next = event.key === "Home" ? 0 : event.key === "End" ? viewNames.length - 1 : (current + (event.key === "ArrowRight" ? 1 : viewNames.length - 1)) % viewNames.length;
      selectView(viewNames[next][0], true);
    }); nav.appendChild(button);
  });
  workspace.appendChild(nav);
  const makePanel = (name, contents, hidden) => { const panel = element("div", "view-panel"); panel.id = `${name}-view`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `${name}-tab`); panel.hidden = hidden; panel.appendChild(contents); return panel; };
  if (!scoped.length) {
    const empty = () => { const panel = element("section", "analysis-panel scoped-empty"); panel.appendChild(element("p", "", "No authored messages match the current filters. Adjust the date or participant filters, or clear filters to see the full chat.")); return panel; };
    workspace.append(makePanel("stats", empty(), activeView !== "stats"), makePanel("awards", empty(), activeView !== "awards"), makePanel("story", empty(), activeView !== "story"), makePanel("messages", empty(), activeView !== "messages"));
  } else {
    const analysis = analyzeChat({ messages: scoped });
    workspace.append(makePanel("stats", renderStats(analysis.stats), activeView !== "stats"));
    workspace.append(makePanel("awards", renderAwards(analysis.awards), activeView !== "awards"));
    workspace.append(makePanel("story", renderStory(analysis.story), activeView !== "story"));
    workspace.append(makePanel("messages", renderMessages(scoped), activeView !== "messages"));
  }
  loaded.appendChild(workspace); appMain.appendChild(loaded); title.focus();
}
function renderMessages(messages) {
  const section = element("section", "analysis-panel messages-panel");
  section.appendChild(element("h2", "", "Messages"));
  const form = element("form", "message-search");
  const label = element("label", "", "Search message text"); const input = document.createElement("input"); input.type = "search"; input.id = "message-search-input"; input.value = messageQuery; label.htmlFor = input.id;
  input.addEventListener("input", () => { messagePage = 1; });
  const actions = element("div", "filter-actions"); const search = element("button", "primary-button", "Search"); search.type = "submit"; const clear = element("button", "secondary-button", "Clear search"); clear.type = "button"; actions.append(search, clear); form.append(label, input, actions); section.appendChild(form);
  form.addEventListener("submit", (event) => { event.preventDefault(); messageQuery = input.value.trim(); messagePage = 1; renderConfirmation(confirmedChat); activeView = "messages"; selectView("messages"); document.getElementById("message-search-input")?.focus(); });
  clear.addEventListener("click", () => { messageQuery = ""; messagePage = 1; renderConfirmation(confirmedChat); activeView = "messages"; selectView("messages"); document.getElementById("message-search-input")?.focus(); });
  const normalizedQuery = messageQuery.toLowerCase();
  const matches = [...messages].sort((a, b) => a.date - b.date).filter((message) => (!normalizedQuery || (!message.isMedia && message.text.toLowerCase().includes(normalizedQuery))));
  section.appendChild(element("p", "message-result-count", `${matches.length.toLocaleString("en-US")} matching ${matches.length === 1 ? "message" : "messages"}`));
  if (!matches.length) { section.appendChild(element("p", "friendly-empty", "No messages match this search. Clear the search to show all messages in this scope.")); return section; }
  const pageCount = Math.ceil(matches.length / 50); messagePage = Math.min(messagePage, pageCount);
  const list = element("ol", "message-list");
  matches.slice((messagePage - 1) * 50, messagePage * 50).forEach((message) => {
    const row = element("li", "message-row");
    const meta = element("p", "message-meta", `${formatDate(message.date)} ${String(message.date.getHours()).padStart(2, "0")}:${String(message.date.getMinutes()).padStart(2, "0")} · ${message.author}`);
    const text = element("p", "message-text", message.isMedia ? "Media omitted" : message.text); row.append(meta, text); list.appendChild(row);
  });
  section.appendChild(list);
  const pagination = element("div", "pagination"); const previous = element("button", "secondary-button", "Previous"); previous.type = "button"; previous.disabled = messagePage <= 1;
  const pageText = element("span", "", `Page ${messagePage} of ${pageCount}`); const next = element("button", "secondary-button", "Next"); next.type = "button"; next.disabled = messagePage >= pageCount;
  previous.addEventListener("click", () => { messagePage -= 1; renderConfirmation(confirmedChat); activeView = "messages"; selectView("messages"); });
  next.addEventListener("click", () => { messagePage += 1; renderConfirmation(confirmedChat); activeView = "messages"; selectView("messages"); });
  pagination.append(previous, pageText, next); section.appendChild(pagination); return section;
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
