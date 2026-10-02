from pathlib import Path
import subprocess
import socket
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results"
OUT.mkdir(exist_ok=True)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    PORT = sock.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}/"
server = subprocess.Popen(["python", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failures = []

def check(condition, message):
    if not condition:
        failures.append(message)

def visible_text(locator):
    return " ".join(locator.inner_text().split())

def metrics(page):
    return {" ".join(el.locator("dt").inner_text().split()): " ".join(el.locator("dd").inner_text().split()) for el in page.locator(".metric-grid > div").all()}

def import_chat(page, text):
    page.get_by_role("button", name="Load a different chat").click()
    page.locator("#chat-paste").fill(text)
    page.get_by_role("button", name="Read pasted chat").click()

def select_view(page, name):
    page.get_by_role("tab", name=name, exact=True).click()

def awards(page):
    return {visible_text(card.locator("h3")): card for card in page.locator(".award-card").all()}

def check_award(cards, title, winner, metric_part):
    check(title in cards, f"Missing earned award: {title}")
    if title in cards:
        check(visible_text(cards[title].locator(".award-winner")) == winner, f"{title} winner expected {winner!r}, got {visible_text(cards[title].locator('.award-winner'))!r}")
        check(metric_part in visible_text(cards[title].locator(".award-metric")), f"{title} expected metric containing {metric_part!r}, got {visible_text(cards[title].locator('.award-metric'))!r}")

try:
    time.sleep(0.7)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 960})
        page_errors, console_errors, external_requests = [], [], []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("request", lambda req: external_requests.append(req.url) if not req.url.startswith(BASE) else None)
        response = page.goto(BASE, wait_until="networkidle")
        check(response is not None and response.ok, "App did not load successfully")

        # Release-wide shell and info-dialog house rules.
        badge = visible_text(page.locator("#version-badge"))
        check(badge == "v1.2.0", f"Release house check requires v1.2.0 badge; rendered {badge!r}")
        check(page.locator("#info-btn").count() == 1 and page.locator("#info-btn").evaluate("el => el.tagName === 'BUTTON' && !!el.getAttribute('aria-label')"), "Missing single accessible real info button")
        check(page.get_by_role("button", name="?").count() == 0, "A separate question-mark help button exists")
        page.keyboard.press("Tab")
        check(page.evaluate("document.activeElement.id") == "info-btn", "Keyboard cannot reach the info button first")
        check(page.locator("#info-btn").evaluate("el => getComputedStyle(el).outlineStyle !== 'none'"), "Info button lacks visible keyboard focus")
        page.keyboard.press("Enter")
        tabs = page.get_by_role("tab")
        check([visible_text(tabs.nth(i)) for i in range(tabs.count())] == ["How to use", "What's new", "Architecture"], "Info-dialog tabs are missing or out of order")
        check("entirely inside your browser" in page.locator("#panel-how").inner_text(), "How to use does not begin with an About summary")
        page.get_by_role("tab", name="What's new").click()
        entries = page.locator("#changelog-list > li")
        versions = [visible_text(entries.nth(i).locator("h3")) for i in range(entries.count())]
        dates = [visible_text(entries.nth(i).locator(".changelog-date")) for i in range(entries.count())]
        check(versions[:3] == ["v1.2.0", "v1.1.0", "v1.0.0"], f"Changelog must have one consolidated v1.2.0 release entry followed by prior releases: {versions[:3]}")
        check(dates[:3] == ["02/10/2026"] * 3, f"Changelog dates are wrong: {dates[:3]}")
        release_notes = visible_text(entries.nth(0).locator("ul"))
        check(all(feature in release_notes for feature in ["Stats", "Awards", "Story"]), f"Consolidated v1.2.0 entry must describe Stats, Awards and Story: {release_notes!r}")
        page.get_by_role("tab", name="Architecture").click()
        check(page.locator("#panel-arch").is_visible() and page.locator("#panel-arch .architecture-diagram").count() == 1, "Architecture panel/diagram is missing")
        box = page.locator("#info-dialog").evaluate("el => { const r=el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), el.scrollHeight, el.clientHeight] }")
        check(box == [920, 760, 760, 760], f"Help dialog size/outer scrolling violates fixed-size rule: {box}")
        page.get_by_role("tab", name="How to use").click()
        page.locator("#panel-how").evaluate("el => { const f=document.createElement('div'); f.style.height='1200px'; el.appendChild(f) }")
        wrapper = page.locator(".tabpanel-wrapper")
        wrapper.evaluate("el => el.scrollTop=300")
        page.get_by_role("tab", name="What's new").click()
        check(wrapper.evaluate("el => el.scrollTop") == 0, "Info dialog content did not return to top when changing tabs")
        page.get_by_role("button", name="Close").click()

        # Feature #3: sample dashboard, complete readable charts, and shared navigation.
        page.get_by_role("button", name="Try a sample chat").click()
        check(visible_text(page.locator("#confirmation-title")) == "Chat loaded", "Sample import confirmation is not available")
        check(page.get_by_role("tab", name="Stats").get_attribute("aria-selected") == "true", "Stats is not the default loaded view")
        m = metrics(page)
        check(m.get("Messages") == "29" and m.get("Media") == "1" and m.get("Active days") == "3", f"Sample stats totals incorrect: {m}")
        check(page.locator(".participant-table tbody tr").count() == 4, "Sample does not show four named participants")
        check(page.locator(".ranking-section").nth(0).locator("ol li").count() > 0, "Sample top-word results are empty")
        hour_rows = page.locator(".chart-section").filter(has=page.get_by_role("heading", name="Messages by hour")).locator(".bar-row")
        weekday_rows = page.locator(".chart-section").filter(has=page.get_by_role("heading", name="Messages by weekday")).locator(".bar-row")
        check(hour_rows.count() == 24, f"Hourly chart has {hour_rows.count()} categories instead of 24")
        check(weekday_rows.count() == 7, f"Weekday chart has {weekday_rows.count()} categories instead of 7")
        for rows, expected, chart_name in [(hour_rows, 24, "hour"), (weekday_rows, 7, "weekday")]:
            for i in range(rows.count()):
                row = rows.nth(i)
                label, count = visible_text(row.locator(".bar-label")), visible_text(row.locator(".bar-count"))
                accessible = row.get_attribute("aria-label") or ""
                fill = row.locator(".bar-fill").evaluate("el => el.style.width")
                check(label in accessible and count in accessible and count.isdigit(), f"{chart_name} {label!r} lacks a readable category/count accessible name")
                check(fill.endswith("%"), f"{chart_name} {label!r} has no relative bar width")
                maximum = max(int(rows.nth(j).locator(".bar-count").inner_text()) for j in range(rows.count()))
                actual = float(fill[:-1])
                expected = int(count) / maximum * 100 if maximum else 0
                check(abs(actual - expected) < 0.01, f"{chart_name} {label!r} bar width {actual}% does not scale to count {count} (expected {expected}%)")
        page.screenshot(path=str(OUT / "release-r1-feature3-sample-stats.png"), full_page=True)
        select_view(page, "Story")
        sample_story = page.locator("#story-view").inner_text()
        check("This chat began on 02/10/2026" in sample_story, "Sample story opening date is incorrect")
        check("busiest day was 02/10/2026, with 22 messages" in sample_story, "Sample story busiest day/count is incorrect")
        check("3 days, from 02/10/2026 to 04/10/2026" in sample_story, "Sample story active streak is incorrect")
        check("No full silent days" in sample_story and "began the most conversations" in sample_story, "Sample story lacks silence or conversation-starter summary")
        check([(visible_text(li.locator(".timeline-month")), visible_text(li.locator(".timeline-count"))) for li in page.locator(".timeline-list li").all()] == [("October 2026", "29 messages")], "Sample story October 2026 timeline is incorrect")
        select_view(page, "Stats")

        stats_fixture = "02/10/26, 00:05 - Anna: hello haha 😂\n02/10/26, 06:00 - Anna: hello world\n03/10/26, 00:05 - Ben: <Media omitted>\n03/10/26, 09:00 - Ben: world 😂\n03/10/26, 09:01 - Messages and calls are end-to-end encrypted."
        import_chat(page, stats_fixture)
        m = metrics(page)
        check(m.get("Messages") == "4" and m.get("Words") == "5" and m.get("Media") == "1" and m.get("Active days") == "2", f"Fixture totals incorrect: {m}")
        people = {visible_text(row.locator("th")): visible_text(row.locator("td").nth(0)) for row in page.locator(".participant-table tbody tr").all()}
        check(people == {"Anna": "2", "Ben": "2"}, f"Participant message counts incorrect: {people}")
        hcounts = {visible_text(row.locator(".bar-label")): visible_text(row.locator(".bar-count")) for row in hour_rows.all()}
        wcounts = {visible_text(row.locator(".bar-label")): visible_text(row.locator(".bar-count")) for row in weekday_rows.all()}
        check(hcounts.get("00") == "2" and hcounts.get("06") == "1" and hcounts.get("09") == "1" and sum(int(v) for v in hcounts.values()) == 4, f"Fixture hourly values incorrect: {hcounts}")
        check(wcounts.get("Friday") == "2" and wcounts.get("Saturday") == "2" and sum(int(v) for v in wcounts.values()) == 4, f"Fixture weekday values incorrect: {wcounts}")
        words = page.locator(".ranking-section").nth(0).inner_text().lower()
        emoji = page.locator(".ranking-section").nth(1).inner_text()
        check("hello — 2" in words and "world — 2" in words, f"Top word counts incorrect: {words}")
        check("😂 — 2" in emoji, f"Top emoji count incorrect: {emoji}")
        page.screenshot(path=str(OUT / "release-r1-feature3-fixture-stats.png"), full_page=True)

        media_only = "02/10/26, 08:00 - Solo: <Media omitted>\n02/10/26, 09:00 - Solo: <Media omitted>"
        import_chat(page, media_only)
        m = metrics(page)
        check(m.get("Messages") == "2" and m.get("Words") == "0" and m.get("Media") == "2" and m.get("Active days") == "1", f"All-media stats totals incorrect: {m}")
        check(visible_text(page.locator(".participant-table tbody tr th")) == "Solo", "All-media author is missing")
        check("No ranking words" in page.locator(".ranking-section").nth(0).inner_text(), "All-media word ranking lacks explanatory empty state")
        check("No emoji found" in page.locator(".ranking-section").nth(1).inner_text(), "All-media emoji ranking lacks explanatory empty state")
        import_chat(page, "02/10/26, 09:00 - Messages and calls are end-to-end encrypted.")
        check(page.get_by_role("alert").inner_text() != "" and page.locator(".confirmation-card").count() == 0, "System-only chat was not rejected")
        page.get_by_role("button", name="Try a sample chat").click()
        check(page.locator(".confirmation-card").is_visible() and metrics(page).get("Messages") == "29", "Changing back to sample did not remove previous results")

        # Feature #4: sample eligibility, deterministic ties, reply thresholds, media filtering, and copy feedback.
        select_view(page, "Awards")
        check(page.locator(".award-card").count() > 0, "Sample awards view has no applicable awards")
        check("Night Owl" not in awards(page), "Sample with no overnight messages earned Night Owl")
        select_view(page, "Stats")
        check(page.locator("#stats-view").is_visible(), "Stats cannot be revisited from Awards")
        tie_fixture = "02/10/26, 00:00 - Anna: haha 😂😂\n02/10/26, 00:01 - Anna: More 😂\n02/10/26, 07:00 - Ben: Good morning everyone\n02/10/26, 07:01 - Ben: lol"
        import_chat(page, tie_fixture)
        select_view(page, "Awards")
        cards = awards(page)
        check_award(cards, "Night Owl", "Anna", "2 messages")
        check_award(cards, "Early Bird", "Ben", "2 messages")
        check_award(cards, "Double-Texter", "Anna", "1 pair")
        check_award(cards, "Emoji Addict", "Anna", "3 emoji")
        check_award(cards, "Laugh Track", "Anna", "1 occurrence")
        check_award(cards, "The Novelist", "Ben", "3 words")
        check("Fastest Replier" not in cards, "Fastest Replier shown despite no qualifying cross-author replies")
        page.screenshot(path=str(OUT / "release-r1-feature4-tie-awards.png"), full_page=True)

        media_fixture = "02/10/26, 00:00 - Solo: <Media omitted>\n02/10/26, 00:01 - Solo: <Media omitted>\n02/10/26, 07:00 - Solo: <Media omitted>"
        import_chat(page, media_fixture)
        select_view(page, "Awards")
        cards = awards(page)
        for forbidden in ["The Novelist", "Emoji Addict", "Laugh Track", "Fastest Replier"]:
            check(forbidden not in cards, f"All-media chat incorrectly earns {forbidden}")
        check("Night Owl" in cards and "Double-Texter" in cards, "Valid time/pair awards missing for all-media messages")

        reply_fixture = "02/10/26, 09:00 - Anna: start\n02/10/26, 09:01 - Ben: reply one\n02/10/26, 09:02 - Anna: next\n02/10/26, 09:03 - Ben: reply two"
        import_chat(page, reply_fixture)
        select_view(page, "Awards")
        cards = awards(page)
        check_award(cards, "Fastest Replier", "Ben", "median 1 minute (2 replies)")
        one_reply = "02/10/26, 09:00 - Anna: start\n02/10/26, 09:01 - Ben: only reply\n02/10/26, 09:02 - Anna: end"
        import_chat(page, one_reply)
        select_view(page, "Awards")
        check("Fastest Replier" not in awards(page), "A person with only one qualifying reply won Fastest Replier")
        six_hour = "02/10/26, 00:00 - Anna: start\n02/10/26, 06:00 - Ben: exactly six hours\n02/10/26, 06:01 - Anna: only one reply"
        import_chat(page, six_hour)
        select_view(page, "Awards")
        check("Fastest Replier" not in awards(page), "Exactly-six-hour boundary was treated as a reply")

        # Clipboard success and failure use browser-local test doubles.
        import_chat(page, tie_fixture)
        select_view(page, "Awards")
        clipboard_text = []
        page.evaluate("window.__clipboardWrites = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.__clipboardWrites.push(text) } })")
        cards = awards(page)
        first_card = next(iter(cards.values()))
        expected_copy = "\n".join([visible_text(first_card.locator("h3")), visible_text(first_card.locator(".award-winner")), visible_text(first_card.locator(".award-metric")), visible_text(first_card.locator(".award-cheeky"))])
        first_card.get_by_role("button", name="Copy award").click()
        page.wait_for_function("window.__clipboardWrites.length === 1")
        copied = page.evaluate("window.__clipboardWrites[0]")
        check(copied == expected_copy, f"Copied award differs from visible card. expected={expected_copy!r}, got={copied!r}")
        check("Award copied." in first_card.locator(".copy-feedback").inner_text(), "Copy success is not announced")
        page.evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied') } } })")
        first_card.get_by_role("button", name="Copy award").click()
        check("Could not copy award" in first_card.locator(".copy-feedback").inner_text(), "Clipboard denial claims success or gives no error")

        # Feature #5: sample and sparse stories, session ties, singleton, replacement.
        import_chat(page, "02/10/26, 09:00 - Anna: Hi\n03/10/26, 09:00 - Ben: Yo\n05/10/26, 10:00 - Anna: Hey\n01/12/26, 10:00 - Ben: Hi")
        select_view(page, "Story")
        story = page.locator("#story-view").inner_text()
        check("02/10/2026" in story and "busiest day was 02/10/2026" in story, f"Sparse story opening/tied earliest busiest day incorrect: {story}")
        check("October 2026 was the busiest month, with 3 messages" in story, "Sparse story busiest month incorrect")
        check("56 full silent days between 05/10/2026 and 01/12/2026" in story, "Sparse story silent interval incorrect")
        check("2 days, from 02/10/2026 to 03/10/2026" in story, "Sparse story longest streak incorrect")
        check("Anna began the most conversations, with 2 sessions" in story, "Sparse story session-start tie was not resolved to Anna")
        timeline = [(visible_text(li.locator(".timeline-month")), visible_text(li.locator(".timeline-count"))) for li in page.locator(".timeline-list li").all()]
        check(timeline == [("October 2026", "3 messages"), ("November 2026", "0 messages"), ("December 2026", "1 message")], f"Sparse timeline/order/zero month incorrect: {timeline}")
        page.screenshot(path=str(OUT / "release-r1-feature5-sparse-story.png"), full_page=True)

        single = "04/10/26, 12:00 - One: Only message"
        import_chat(page, single)
        select_view(page, "Story")
        story = page.locator("#story-view").inner_text()
        check("04/10/2026" in story and "1 day, from 04/10/2026 to 04/10/2026" in story, f"Singleton story date/streak wrong: {story}")
        check("One began the most conversations, with 1 session" in story and "No full silent days" in story, "Singleton story session/no-silence text incorrect")
        check(page.locator(".timeline-list li").count() == 1 and "1 message" in page.locator(".timeline-list li").inner_text(), "Singleton month timeline incorrect")
        exact_story = "02/10/26, 00:00 - Anna: first\n02/10/26, 06:00 - Ben: exactly six hours"
        import_chat(page, exact_story)
        select_view(page, "Story")
        check("Anna began the most conversations, with 1 session" in page.locator("#story-view").inner_text(), "Exact six-hour gap did not start a new session")
        with_system = "01/10/26, 09:00 - Messages and calls are end-to-end encrypted.\n02/10/26, 10:00 - Anna: <Media omitted>\n02/10/26, 16:00 - Ben: authored exactly six hours later"
        import_chat(page, with_system)
        check(metrics(page).get("Messages") == "2" and metrics(page).get("Media") == "1", "Authored media message was not counted in chat statistics")
        select_view(page, "Story")
        story = page.locator("#story-view").inner_text()
        check("This chat began on 02/10/2026 with Anna" in story and "busiest day was 02/10/2026, with 2 messages" in story, "System notice affected story start/peak or authored media was excluded")
        check("Anna began the most conversations, with 1 session" in story, "Exactly-six-hour authored messages did not begin separate sessions")
        # Replacement clears all old stories and preserves a loaded chat while navigating.
        import_chat(page, "04/10/26, 12:00 - NewName: replacement")
        select_view(page, "Stats")
        select_view(page, "Awards")
        select_view(page, "Story")
        check("NewName" in page.locator("#story-view").inner_text() and "Anna" not in page.locator("#story-view").inner_text(), "Navigation did not preserve current replacement chat or old story leaked")
        page.get_by_role("button", name="Load a different chat").click()
        check(page.locator(".import-card").is_visible() and page.locator(".analysis-panel").count() == 0, "Load different chat did not clear old results")

        # Keyboard view navigation and narrow-screen basic accessibility/layout.
        page.get_by_role("button", name="Try a sample chat").click()
        stats_tab = page.get_by_role("tab", name="Stats", exact=True)
        stats_tab.focus()
        page.keyboard.press("ArrowRight")
        check(page.evaluate("document.activeElement.textContent") == "Awards" and page.get_by_role("tab", name="Awards").get_attribute("aria-selected") == "true", "Keyboard ArrowRight did not select/focus Awards")
        page.keyboard.press("ArrowRight")
        check(page.evaluate("document.activeElement.textContent") == "Story" and page.get_by_role("tab", name="Story").get_attribute("aria-selected") == "true", "Keyboard ArrowRight did not select/focus Story")
        page.set_viewport_size({"width": 360, "height": 800})
        page.evaluate("window.scrollTo(0,0)")
        overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth")
        check(not overflow, "Loaded dashboard overflows horizontally at 360px")
        for view in ["Stats", "Awards", "Story"]:
            page.get_by_role("tab", name=view, exact=True).click()
            check(page.get_by_role("tab", name=view, exact=True).is_visible(), f"{view} navigation tab is inaccessible at mobile width")
        page.get_by_role("tab", name="Stats", exact=True).click()
        page.get_by_role("button", name="Load a different chat").focus()
        page.keyboard.press("Tab")
        focused = page.evaluate("() => ({ label: document.activeElement.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle })")
        check(focused["label"] == "Stats" and focused["outline"] != "none", f"Mobile view tab lacks visible keyboard focus: {focused}")
        page.screenshot(path=str(OUT / "release-r1-feature3-mobile-dashboard.png"), full_page=True)
        reduced = browser.new_page(viewport={"width": 360, "height": 800}, reduced_motion="reduce")
        reduced.goto(BASE, wait_until="networkidle")
        duration = reduced.locator("#info-btn").evaluate("el => getComputedStyle(el).transitionDuration")
        check(duration in ("0s", "0ms"), f"Reduced-motion preference leaves an info-button transition active: {duration}")
        reduced.close()

        check(not page_errors, f"Browser page errors: {page_errors}")
        check(not console_errors, f"Browser console errors: {console_errors}")
        check(not external_requests, f"External network requests observed: {external_requests}")
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)

if failures:
    print(f"FAIL: {len(failures)} assertion(s)")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)
print("PASS: all release v1.2.0 round-1 browser checks")
