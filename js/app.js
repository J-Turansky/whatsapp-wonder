import { VERSION, CHANGELOG } from "./version.js";

const badge = document.getElementById("version-badge");
if (badge) {
  badge.textContent = `v${VERSION}`;
}

const dialog = document.getElementById("info-dialog");
const infoBtn = document.getElementById("info-btn");
const closeBtn = document.getElementById("close-dialog-btn");
const changelogList = document.getElementById("changelog-list");

const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
const panelWrapper = document.querySelector(".tabpanel-wrapper");

function renderChangelog() {
  if (!changelogList) return;
  changelogList.innerHTML = "";
  CHANGELOG.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "changelog-entry";

    const heading = document.createElement("h3");
    heading.textContent = `v${entry.version}`;
    li.appendChild(heading);

    const date = document.createElement("p");
    date.className = "changelog-date";
    date.textContent = entry.date;
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

function selectTab(tab) {
  tabs.forEach((t) => {
    const isSelected = t === tab;
    t.setAttribute("aria-selected", String(isSelected));
    t.tabIndex = isSelected ? 0 : -1;
  });

  panels.forEach((panel) => {
    const shouldShow = panel.id === tab.getAttribute("aria-controls");
    panel.hidden = !shouldShow;
    if (shouldShow) {
      panel.scrollTop = 0;
    }
  });

  if (panelWrapper) {
    panelWrapper.scrollTop = 0;
  }
  tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));

  tab.addEventListener("keydown", (event) => {
    let newIndex = null;
    if (event.key === "ArrowRight") {
      newIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      newIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      newIndex = 0;
    } else if (event.key === "End") {
      newIndex = tabs.length - 1;
    }
    if (newIndex !== null) {
      event.preventDefault();
      selectTab(tabs[newIndex]);
    }
  });
});

function openDialog() {
  const howTab = document.getElementById("tab-how");
  dialog.showModal();
  selectTab(howTab);
}

function closeDialog() {
  dialog.close();
}

infoBtn.addEventListener("click", openDialog);
closeBtn.addEventListener("click", closeDialog);

dialog.addEventListener("close", () => {
  infoBtn.focus();
});

// Close on backdrop click (click registered on the dialog element itself,
// outside of its content box, counts as a backdrop click).
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    closeDialog();
  }
});

renderChangelog();
