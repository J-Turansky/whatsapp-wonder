"""Round-3 acceptance runner for WhatsApp Wonder v1.4.0.

Run from the project root with:
    python tests/test_release_v140_round3.py

It opens the static entry point directly in Chromium (no local server), writes
screenshots/PDF evidence to test-results/, and exits non-zero on any failure.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results"
OUT.mkdir(exist_ok=True)
ENTRY = (ROOT / "index.html").as_uri()
checks = 0
failures = []
console_errors = []


def check(condition, label):
    global checks
    checks += 1
    if not condition:
        failures.append(label)
        print(f"FAIL: {label}")
    else:
        print(f"PASS: {label}")


def import_chat(page, text, confirm=True):
    if page.get_by_role("button", name="Load a different chat").count():
        page.get_by_role("button", name="Load a different chat").click()
    page.get_by_label("Paste your chat text").fill(text)
    page.get_by_role("button", name="Review pasted chat").click()
    if confirm:
        radios = page.locator('input[name="date-order"]')
        if radios.count() and not page.locator('input[name="date-order"]:checked').count():
            page.get_by_label("Day/month/year").check()
        page.get_by_role("button", name="Show insights").click()


def capture(page, name, full_page=True):
    page.screenshot(path=str(OUT / name), full_page=full_page)


def set_scope(page, start="", end="", participant=""):
    page.locator("#filter-from").fill(start)
    page.locator("#filter-to").fill(end)
    page.locator("#filter-participant").select_option(label=participant or "All participants")
    page.get_by_role("button", name="Apply filters").click()


def scoped_empty(page):
    texts = []
    for tab in ["Stats", "Awards", "Story", "Messages"]:
        page.get_by_role("tab", name=tab, exact=True).click()
        texts.append(page.locator(".view-panel:not([hidden])").inner_text())
    return all("No authored messages match the current filters" in text for text in texts) and len(set(texts)) == 1


def heat_count(page, day_index, hour):
    return page.locator(".heatmap-table tbody tr").nth(day_index).locator("td").nth(hour).inner_text()


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
    context = browser.new_context(viewport={"width": 390, "height": 844}, timezone_id="America/New_York")
    context.add_init_script("""Object.defineProperty(window, 'print', { configurable:true, writable:true, value:() => { window.__printCalls=(window.__printCalls||0)+1; } });""")
    page = context.new_page()
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto(ENTRY, wait_until="load")
    page.wait_for_timeout(150)
    check(page.locator("#version-badge").inner_text() == "v1.4.0", "entry loads v1.4.0 and has no report action before confirmation")
    check(page.get_by_role("button", name="Preview report / Print or save PDF").count() == 0, "no report action exists before confirmed import")
    version_source = (ROOT / "js" / "version.js").read_text(encoding="utf-8")
    check('export const VERSION = "1.4.0"' in version_source, "version module is set to 1.4.0")
    page.get_by_role("button", name="About and help").click()
    page.get_by_role("tab", name="What's new").click()
    entry = page.locator(".changelog-entry").first
    check("v1.4.0" in entry.inner_text() and "02/10/2026" in entry.inner_text() and all(term in entry.inner_text().lower() for term in ["heatmap", "handoff", "print", "supporting messages"]), "single plain-English changelog entry covers all four release features")
    page.get_by_role("tab", name="How to use").click()
    check("print" in page.locator("#panel-how").inner_text().lower() and "raw messages" in page.locator("#panel-how").inner_text().lower(), "How to use explains private report printing")
    page.get_by_role("button", name="Close").click()
    page.get_by_label("Paste your chat text").fill("02/10/26, 09:00 - Unknown order: ambiguous")
    page.get_by_role("button", name="Review pasted chat").click()
    check(page.get_by_role("button", name="Preview report / Print or save PDF").count() == 0 and page.get_by_role("button", name="Show insights").is_hidden(), "unconfirmed ambiguous dates have no report action")
    page.get_by_role("button", name="Choose another chat").click()

    # #10: exact weekday/hour counts, accessible labeled table, filters and mobile scrolling.
    heat = "\n".join([
        "05/10/26, 09:01 - Amy: Monday first",
        "05/10/26, 09:20 - Amy: Monday second",
        "06/10/26, 09:10 - Bob: Tuesday",
        "07/10/26, 18:15 - Cara: <Media omitted>",
        "05/10/26, 08:00 - Messages to this group are now secured",
        "31/02/26, 10:00 - Broken timestamp"
    ])
    import_chat(page, heat)
    rows = page.locator(".heatmap-table tbody tr")
    cells = page.locator(".heatmap-cell")
    check(rows.count() == 7 and all(rows.nth(index).locator("td").count() == 24 for index in range(7)), "heatmap has seven weekday rows and 24 hourly columns")
    check([heat_count(page, 0, 9), heat_count(page, 1, 9), heat_count(page, 2, 18)] == ["2", "1", "1"], "two Monday 09 messages, Tuesday 09, and media Wednesday 18 are counted")
    check(sum(map(int, cells.all_inner_texts())) == int(page.locator(".metric-card").filter(has=page.locator("dt", has_text="Messages")).locator("dd").inner_text()) == 4, "cell counts sum to scoped Stats count; system/skipped entries are excluded")
    check(page.locator(".busiest-hour").inner_text().startswith("Busiest weekday-hour: Monday at 09:00 (2 messages)"), "busiest slot is deterministic and includes its count")
    check(rows.nth(0).locator("th[scope=row]").inner_text() == "Monday" and page.locator(".heatmap-table thead th[scope=col]").nth(10).inner_text() == "09:00" and rows.nth(0).locator("td").nth(9).get_attribute("aria-label") == "Monday, 09:00, 2 messages", "screen-reader cell name includes weekday, hour, and integer count")
    check("local time" in page.locator(".activity-heatmap").inner_text().lower() and "brighter cells" in page.locator(".activity-heatmap").inner_text().lower(), "heatmap explains local hours and color intensity")
    check(page.locator(".weekly-trend-list li").count() == 1 and "05/10/2026 – 11/10/2026" in page.locator(".weekly-trend").inner_text(), "single matching week displays its inclusive Monday–Sunday date span")
    check(page.locator(".heatmap-scroll").evaluate("e => e.scrollWidth > e.clientWidth"), "24-column table scrolls horizontally at 390px viewport")
    capture(page, "v140-r3-heatmap-mobile.png")

    set_scope(page, "2026-10-06", "2026-10-07", "Bob")
    check("1 message" in page.locator("#scope-summary").inner_text() and sum(map(int, page.locator(".heatmap-cell").all_inner_texts())) == 1 and page.locator(".weekly-trend-list li").count() == 1, "date/participant filters update heatmap, trend, and Stats in lockstep")
    page.get_by_role("button", name="Clear filters").click()
    check("4 messages" in page.locator("#scope-summary").inner_text() and sum(map(int, page.locator(".heatmap-cell").all_inner_texts())) == 4, "clearing shared filters restores the full authored scope")
    set_scope(page, "2026-10-06", "2026-10-06", "Amy")
    check(scoped_empty(page) and page.locator("#stats-view .heatmap-table").count() == 0 and page.locator(".busiest-hour").count() == 0, "zero-match scope shows the same empty state in all tabs without charts or peak")
    capture(page, "v140-r3-empty-scope.png")
    page.get_by_role("button", name="Clear filters").click()
    set_scope(page, "2026-10-06", "2026-10-06", "Bob")
    check(sum(value == "1" for value in page.locator(".heatmap-cell").all_inner_texts()) == 1 and page.locator(".weekly-trend-list li").count() == 1, "one-message scope has one nonzero cell and one weekly point")
    page.get_by_role("button", name="Load a different chat").click()
    tie_fixture = "05/10/26, 10:00 - Monday: first slot\n06/10/26, 09:00 - Tuesday: tied slot\n13/10/26, 23:00 - Tuesday: anchor"
    import_chat(page, tie_fixture)
    check(page.locator(".busiest-hour").inner_text().startswith("Busiest weekday-hour: Monday at 10:00 (1 message)"), "busiest-slot ties favor Monday before Tuesday and earliest hour")
    page.get_by_role("button", name="Load a different chat").click()

    import_chat(page, "05/10/26, 08:00 - Old: before\n28/12/26, 08:00 - New: latest")
    trend_counts = page.locator(".weekly-trend-list .week-count").all_inner_texts()
    check(page.locator(".weekly-trend-list li").count() == 12 and page.locator(".weekly-trend h3").inner_text() == "Last 12 weeks of matching messages", "long history is labeled and limited to the most recent 12 weeks")
    check(sum(value.startswith("0 ") for value in trend_counts) == 11 and trend_counts[-1].startswith("1 "), "12-week trend includes zero weeks and ends in the latest message week")
    capture(page, "v140-r3-trend-last-12-weeks.png")

    # Both DST transitions in New York: local calendar rows/weeks must not shift with UTC offset.
    spring = "07/03/26, 23:30 - Sat: before DST\n08/03/26, 01:30 - Sun: before jump\n08/03/26, 03:30 - Sun: after jump\n09/03/26, 00:30 - Mon: next week\n13/03/26, 12:00 - Fri: date anchor"
    page.get_by_role("button", name="Load a different chat").click()
    import_chat(page, spring)
    check([heat_count(page, 5, 23), heat_count(page, 6, 1), heat_count(page, 6, 3), heat_count(page, 0, 0)] == ["1", "1", "1", "1"], "spring-forward messages remain on their local weekday and hour")
    check(page.locator(".weekly-trend-list li").all_inner_texts()[0].startswith("02/03/2026 – 08/03/2026") and page.locator(".weekly-trend-list li").count() == 2, "spring-forward calendar weeks remain Monday–Sunday without offset drift")
    capture(page, "v140-r3-dst-spring-forward.png")
    fall = "31/10/26, 23:30 - Sat: before DST\n01/11/26, 01:30 - Sun: fall-back\n02/11/26, 00:30 - Mon: next week\n13/11/26, 12:00 - Fri: date anchor"
    page.get_by_role("button", name="Load a different chat").click()
    import_chat(page, fall)
    check([heat_count(page, 5, 23), heat_count(page, 6, 1), heat_count(page, 0, 0)] == ["1", "1", "1"] and page.locator(".weekly-trend-list li").count() == 3, "fall-back messages retain local weekday/hour and week boundaries")
    capture(page, "v140-r3-dst-fall-back.png")

    # #11: exact one-sample fixture, exclusions, filtered handoffs, and eligible median.
    page.get_by_role("button", name="Load a different chat").click()
    four = "05/10/26, 09:00 - A: first\n05/10/26, 09:02 - B: second\n05/10/26, 09:03 - B: same author\n05/10/26, 09:07 - A: fourth"
    import_chat(page, four)
    table = page.locator(".participant-table")
    a_row = table.locator("tbody tr").filter(has=page.locator("th", has_text="A"))
    b_row = table.locator("tbody tr").filter(has=page.locator("th", has_text="B"))
    check("50.0%" in a_row.inner_text() and "50.0%" in b_row.inner_text(), "four-message fixture reports equal scoped participant shares")
    check(a_row.locator("td").nth(4).inner_text() == "1" and b_row.locator("td").nth(4).inner_text() == "1" and "Insufficient data" in a_row.inner_text() and "Insufficient data" in b_row.inner_text(), "only later authors receive one handoff each; one sample is insufficient for medians")
    check(page.locator("#awards-view").get_by_role("heading", name="Shortest observed handoff").count() == 0 and "adjacent matching messages" in page.locator(".conversation-patterns").inner_text() and "not verified replies" in page.locator(".conversation-patterns").inner_text(), "one-sample handoff award is withheld and explanatory caveat is visible")
    check(page.locator(".share-bars .share-bar-row").count() == 2, "horizontal share bars are shown once per included participant")
    capture(page, "v140-r3-handoff-one-sample.png")
    set_scope(page, "2026-10-05", "2026-10-05", "A")
    one_person = page.locator(".participant-table").inner_text()
    check("100.0%" in one_person and "No cross-participant handoffs in this scope" in one_person and page.locator("#awards-view").get_by_role("heading", name="Shortest observed handoff").count() == 0, "single-participant scope has 100% share and no cross-author median/award")

    page.get_by_role("button", name="Clear filters").click()
    page.get_by_role("button", name="Load a different chat").click()
    gaps = "05/10/26, 09:00 - A: a\n05/10/26, 09:02 - B: b\n05/10/26, 09:03 - C: c\n05/10/26, 09:07 - B: d"
    import_chat(page, gaps)
    b_row = page.locator(".participant-table tbody tr").filter(has=page.locator("th", has_text="B"))
    check("3 minutes (2 samples)" in b_row.inner_text() and "Shortest observed handoff" in page.locator("#awards-view").inner_text(), "two qualifying handoffs yield correct 3-minute median and eligible award")
    page.get_by_role("tab", name="Awards").click()
    page.get_by_role("button", name="See messages for Shortest observed handoff award").click()
    check(page.locator(".message-row").count() == 4 and "2 qualifying pairs" in page.locator(".evidence-banner").inner_text(), "pair award evidence includes both messages per pair and labels pair count separately")
    capture(page, "v140-r3-handoff-pair-evidence.png")
    page.get_by_role("button", name="Back to Awards").click()
    page.get_by_role("button", name="Load a different chat").click()
    date_gaps = "05/10/26, 09:00 - A: before\n05/10/26, 09:02 - B: before handoff\n06/10/26, 09:00 - C: next day\n06/10/26, 09:02 - B: matching date handoff"
    import_chat(page, date_gaps)
    b_row = page.locator(".participant-table tbody tr").filter(has=page.locator("th", has_text="B"))
    check("2 samples" in b_row.inner_text() and "2 minutes" in b_row.inner_text(), "unfiltered scope counts both qualifying handoffs across matching messages")
    set_scope(page, "2026-10-06", "2026-10-06")
    b_row = page.locator(".participant-table tbody tr").filter(has=page.locator("th", has_text="B"))
    c_row = page.locator(".participant-table tbody tr").filter(has=page.locator("th", has_text="C"))
    check("50.0%" in b_row.inner_text() and "1 samples" in b_row.inner_text() and "Insufficient data" in b_row.inner_text() and c_row.locator("td").nth(4).inner_text() == "0", "date filter recomputes adjacency, scoped shares, handoff counts, and median eligibility")
    capture(page, "v140-r3-handoff-filtered-date.png")
    page.get_by_role("button", name="Clear filters").click()
    check("2 samples" in page.locator(".participant-table").filter(has=page.locator("th", has_text="B")).inner_text(), "clearing date filter restores original handoff samples")
    page.get_by_role("button", name="Load a different chat").click()
    seconds = "05/10/26, 09:00:00 - A: start\n05/10/26, 09:00:01 - B: second\n05/10/26, 09:00:02 - C: third\n05/10/26, 09:00:03 - B: fourth"
    import_chat(page, seconds)
    b_row = page.locator(".participant-table tbody tr").filter(has=page.locator("th", has_text="B"))
    check("1 second (2 samples)" in b_row.inner_text() and "median 1 second (2 samples)" in page.locator("#awards-view").inner_text(), "short nonzero medians are rendered as seconds, not zero minutes")
    page.get_by_role("button", name="Load a different chat").click()
    excluded = "05/10/26, 09:00 - A: one\n05/10/26, 15:00 - B: exactly six hours\n05/10/26, 15:01 - B: same author\n05/10/26, 21:01 - A: exactly six hours\n13/10/26, 12:00 - Anchor: date order"
    import_chat(page, excluded)
    check(all(row.locator("td").nth(4).inner_text() == "0" for row in page.locator(".participant-table tbody tr").all()) and "Shortest observed handoff" not in page.locator("#awards-view").inner_text(), "same-author and six-hour adjacent pairs do not qualify")
    set_scope(page, "2026-10-06", "2026-10-06", "A")
    check(scoped_empty(page), "no-match handoff scope uses shared empty state, with no denominator or award")
    capture(page, "v140-r3-handoff-empty.png")

    # #12: report privacy, fresh scope, focus, print CSS, and real PDF output.
    page.get_by_role("button", name="Load a different chat").click()
    report_fixture = "05/10/26, 09:00 - A: PRIVATE_RAW_ALPHA needle\n05/10/26, 09:02 - B: PRIVATE_RAW_BRAVO\n05/10/26, 09:03 - B: PRIVATE_RAW_CHARLIE\n05/10/26, 09:07 - A: PRIVATE_RAW_DELTA\n05/10/26, 09:08 - Messages to this group are now secured\n31/02/26, 10:00 - skipped filename.jpg\n13/10/26, 10:00 - Anchor: disambiguates date"
    import_chat(page, report_fixture)
    set_scope(page, "2026-10-05", "2026-10-05")
    page.get_by_role("tab", name="Messages").click()
    page.get_by_label("Search message text").fill("PRIVATE_RAW_ALPHA")
    page.get_by_role("button", name="Search", exact=True).click()
    page.get_by_role("button", name="Preview report / Print or save PDF").click()
    report = page.locator("#report-preview")
    content = report.inner_text()
    check("05/10/2026" in content and "All participants" in content and "4 matching authored messages" in content and "Day/month/year" in content, "report shows current inclusive scope, count, and confirmed date order")
    check("Whole-import quality (not scope counts): 1 system entries; 1 skipped nonempty lines" in content, "report explicitly labels whole-import system/skipped quality counts")
    check(all(token not in content for token in ["PRIVATE_RAW", "needle", "skipped filename.jpg", "Supporting messages for"]) and report.locator(".message-row").count() == 0, "report preview excludes raw text, filenames, search terms, and source rows")
    check("No raw messages" in content and "Top-word and emoji rankings are omitted" in content and "not verified replies" in content.lower(), "privacy warning, rankings omission, and handoff caveat are present")
    check(all(title in content for title in ["Statistics", "Eligible awards", "Story and monthly timeline", "Weekly activity highlights", "Conversation patterns"]), "report contains the expected scoped insights")
    capture(page, "v140-r3-report-preview.png")
    page.emulate_media(media="print")
    check(page.locator("#report-preview").evaluate("e => getComputedStyle(e).display") != "none" and page.locator(".app-header").evaluate("e => getComputedStyle(e).display") == "none" and page.locator(".report-actions").evaluate("e => getComputedStyle(e).display") == "none", "print CSS exposes report and hides app controls")
    capture(page, "v140-r3-report-print-layout.png")
    pdf_path = OUT / "v140-r3-private-insights-report.pdf"
    page.pdf(path=str(pdf_path), print_background=False, prefer_css_page_size=True)
    with pymupdf.open(pdf_path) as pdf:
        pdf_text = "\n".join(pdf_page.get_text() for pdf_page in pdf)
        page_count = len(pdf)
        for page_index, pdf_page in enumerate(pdf):
            pdf_page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).save(str(OUT / f"v140-r3-report-pdf-page-{page_index + 1}.png"))
    check(pdf_path.stat().st_size > 0 and page_count >= 1 and all(token not in pdf_text for token in ["PRIVATE_RAW", "needle", "filename.jpg"]) and "WhatsApp Wonder insights report" in pdf_text, "generated print PDF is legible and contains no raw/search/source data")
    page.emulate_media(media="screen")
    page.get_by_role("button", name="Print or save as PDF").click()
    check(page.evaluate("window.__printCalls") == 1, "labeled print action invokes native window.print()")
    page.get_by_role("button", name="Close report and go back").click()
    check(page.evaluate("document.activeElement.id") == "report-open-btn" and page.locator("#messages-view").is_visible(), "closing the report returns focus to a usable prior-view control")
    set_scope(page, "2026-10-05", "2026-10-05", "B")
    page.get_by_role("button", name="Preview report / Print or save PDF").click()
    fresh = page.locator("#report-preview").inner_text()
    check("B (inclusive local dates)" in fresh and "2 matching authored messages" in fresh and "PRIVATE_RAW_ALPHA" not in fresh, "reopened report uses new filters and ignores prior search")
    page.get_by_role("button", name="Close report and go back").click()
    for tab_name in ["Stats", "Awards", "Story", "Messages"]:
        page.get_by_role("tab", name=tab_name, exact=True).click()
        page.get_by_role("button", name="Preview report / Print or save PDF").click()
        scoped_report = page.locator("#report-preview").inner_text()
        check("B (inclusive local dates)" in scoped_report and "2 matching authored messages" in scoped_report, f"fresh report opens with the same current scope from {tab_name}")
        page.get_by_role("button", name="Close report and go back").click()
    set_scope(page, "2026-10-14", "2026-10-14")
    page.get_by_role("button", name="Preview report / Print or save PDF").click()
    check("no insights to report" in page.locator("#report-preview").inner_text().lower() and page.get_by_role("button", name="Print or save as PDF").count() == 0, "zero-match report explains empty scope and has no print action")
    capture(page, "v140-r3-report-empty.png")

    # #13: exact/aggregate source evidence, award contributors, pagination, restoration/invalidation.
    page.get_by_role("button", name="Close report and go back").click()
    page.get_by_role("button", name="Load a different chat").click()
    duplicates = "13/10/26, 09:00 - First author: identical longest source text\n13/10/26, 09:00 - Second author: identical longest source text\n13/10/26, 09:01 - Third author: short\n13/10/26, 09:02 - Third author: short follow-up"
    import_chat(page, duplicates)
    page.get_by_role("tab", name="Story").click()
    page.get_by_role("button", name="See messages for first message").click()
    check(page.locator(".message-row").count() == 1 and "First author" in page.locator(".message-row").inner_text() and "One exact source" in page.locator(".evidence-banner").inner_text(), "tied timestamp/text first-message source resolves exact export identity")
    page.get_by_role("button", name="Back to Story").click()
    page.get_by_role("tab", name="Awards").click()
    novelist = page.locator(".award-card").filter(has=page.get_by_role("heading", name="The Novelist"))
    novelist.get_by_role("button", name="See messages for The Novelist award").click()
    check(page.locator(".message-row").count() == 1 and "First author" in page.locator(".message-row").inner_text() and "One exact source" in page.locator(".evidence-banner").inner_text(), "Novelist source links to its exact stable identity under timestamp/text ties")
    page.get_by_role("button", name="Back to Awards").click()
    page.get_by_role("tab", name="Story").click()
    page.get_by_role("button", name="See messages for busiest day").click()
    check(page.locator(".message-row").count() == 4 and "aggregate supporting set" in page.locator(".evidence-banner").inner_text(), "busiest-day claim links to all matching day messages as aggregate evidence")
    capture(page, "v140-r3-story-busiest-day-evidence.png")
    page.get_by_role("button", name="Back to Story").click()
    page.get_by_role("button", name="See messages for busiest month").click()
    check(page.locator(".message-result-count").inner_text().startswith("4 supporting"), "busiest-month evidence includes all matching month messages")

    page.get_by_role("button", name="Load a different chat").click()
    awards_fixture = "05/10/26, 00:00 - Night: start\n05/10/26, 00:02 - Night: 😄 haha This is a longest individual sentence in the scope\n05/10/26, 00:03 - Bee: reply\n05/10/26, 00:04 - Night: lol\n05/10/26, 05:10 - Early: dawn\n13/10/26, 12:00 - Other: date anchor"
    import_chat(page, awards_fixture)
    page.get_by_role("tab", name="Awards").click()
    check(page.locator(".award-card").count() == page.locator(".award-card .evidence-button").count(), "each displayed award has a contextual evidence action")
    owl = page.locator(".award-card").filter(has=page.get_by_role("heading", name="Night Owl"))
    owl.get_by_role("button", name="See messages for Night Owl award").click()
    check(page.locator(".message-row").count() == 3 and "aggregate supporting set" in page.locator(".evidence-banner").inner_text(), "Night Owl evidence is exactly the winner's three messages in named hours")
    capture(page, "v140-r3-night-owl-evidence.png")
    page.get_by_role("button", name="Preview report / Print or save PDF").click()
    report_text = page.locator("#report-preview").inner_text()
    check("Supporting messages for" not in report_text and "PRIVATE_RAW" not in report_text and page.locator("#report-preview .message-row").count() == 0, "report opened from evidence mode excludes evidence context and message rows")
    page.get_by_role("button", name="Close report and go back").click()
    page.get_by_role("button", name="Back to Awards").click()
    dt = page.locator(".award-card").filter(has=page.get_by_role("heading", name="Double-Texter"))
    dt.get_by_role("button", name="See messages for Double-Texter award").click()
    check("qualifying pairs" in page.locator(".evidence-banner").inner_text(), "pair-based award states qualifying-pair count separately from rows")
    page.get_by_role("button", name="Back to Awards").click()

    page.get_by_role("button", name="Load a different chat").click()
    long_rows = [f"05/10/26, 00:{minute:02d} - Night: needle item {minute}" for minute in range(55)]
    long_rows.append("13/10/26, 10:00 - Other: anchor")
    import_chat(page, "\n".join(long_rows))
    page.get_by_role("tab", name="Messages").click()
    page.get_by_label("Search message text").fill("needle")
    page.get_by_role("button", name="Search", exact=True).click()
    page.get_by_role("button", name="Next").click()
    check("Page 2 of 2" in page.locator(".pagination").inner_text() and page.locator(".message-row").count() == 5, "source chat has selected search results and page state before drilldown")
    page.get_by_role("tab", name="Awards").click()
    page.get_by_role("button", name="See messages for Night Owl award").click()
    check(page.locator(".message-row").count() == 50 and "paused" in page.locator(".evidence-banner").inner_text().lower() and "Page 1 of 2" in page.locator(".pagination").inner_text(), "evidence mode pauses search and retains 50-row pagination")
    capture(page, "v140-r3-evidence-page-1.png")
    page.get_by_role("button", name="Back to Awards").click()
    check(page.evaluate("document.activeElement.id") == "award-evidence-0", "Back returns keyboard focus to originating award action")
    page.get_by_role("tab", name="Messages").click()
    check(page.get_by_label("Search message text").input_value() == "needle" and "Page 2 of 2" in page.locator(".pagination").inner_text() and page.locator(".message-row").count() == 5, "Back navigation restores previous Messages query and page")
    capture(page, "v140-r3-evidence-return-page-2.png")
    page.get_by_role("tab", name="Awards").click()
    page.get_by_role("button", name="See messages for Night Owl award").click()
    page.locator("#filter-participant").select_option(label="Other")
    page.get_by_role("button", name="Apply filters").click()
    check(page.locator(".evidence-banner").count() == 0 and "1 message" in page.locator("#scope-summary").inner_text(), "scope change discards stale evidence and recomputes current scope")
    page.get_by_role("button", name="Clear filters").click()
    page.get_by_role("tab", name="Awards").click()
    page.get_by_role("button", name="See messages for Night Owl award").click()
    page.get_by_role("button", name="Load a different chat").click()
    check(page.locator(".evidence-banner").count() == 0 and page.get_by_label("Paste your chat text").count() == 1, "new import while evidence is open clears all old evidence context")

    check(not console_errors, f"no console/page errors: {console_errors}")
    context.close()
    browser.close()

print(f"Completed {checks} browser acceptance checks; screenshots and PDF: {OUT}")
if failures:
    raise SystemExit(f"{len(failures)} acceptance checks failed: {failures}")
