"""Regression checks on localhost:3000; intercept writes to keep user data intact."""
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    saved = {"note": ""}
    writes = []

    def day_route(route):
        if route.request.method == "PUT":
            saved.update(route.request.post_data_json)
            writes.append(saved["note"])
            route.fulfill(json={})
        else:
            payload = route.fetch().json()
            payload.update(saved)
            route.fulfill(json=payload)

    page.route(re.compile(r"/api/journal/\d{4}-\d{2}-\d{2}$"), day_route)
    page.route("**/api/workspace/progress", lambda route: route.fulfill(json={}))
    page.goto("http://localhost:3000/journal")
    page.wait_for_load_state("networkidle")

    # Both actions stay together at the left, desktop and narrow viewport.
    for width in (1440, 390):
        page.set_viewport_size({"width": width, "height": 1000})
        page.get_by_role("button", name="Filters", exact=True).click()
        apply = page.get_by_role("button", name="Apply filters", exact=True)
        clear = page.get_by_role("button", name="Clear filters", exact=True)
        a, c = apply.bounding_box(), clear.bounding_box()
        footer = page.locator(".journal-filter-footer")
        left = footer.evaluate("e => e.getBoundingClientRect().left + parseFloat(getComputedStyle(e).paddingLeft)")
        assert abs(a["x"] - left) < 2
        assert abs(c["x"] - a["x"] - a["width"] - 12) < 2
        assert abs(a["y"] - c["y"]) < 2
        Path("/tmp/opencode/pro-45").mkdir(exist_ok=True)
        page.screenshot(path=f"/tmp/opencode/pro-45/filters-{width}.png")
        apply.click()

    page.set_viewport_size({"width": 1440, "height": 1000})
    editor = page.locator('[contenteditable="true"]')
    for count in (0, 1, 2, 3, 4):
        saved["note"] = ""
        page.reload()
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Edit today", exact=True).click()
        editor.wait_for()
        page.wait_for_load_state("networkidle")
        editor.click()
        editor.press("Control+A")
        editor.press_sequentially("First sentence.")
        for _ in range(count):
            editor.press("Enter")
        editor.type("Second sentence.")
        before = editor.bounding_box()["height"]
        page.get_by_role("button", name="Save", exact=True).click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        expected = "First sentence." + "\\\n" * count + "Second sentence."
        assert writes[-1] == expected, (count, writes[-1])
        page.reload()
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="Edit today", exact=True).click()
        expect(editor).to_contain_text("Second sentence.")
        page.wait_for_load_state("networkidle")
        assert editor.locator("br").count() == count
        assert abs(editor.bounding_box()["height"] - before) < 1
        # An unrelated edit must not change the preceding line breaks.
        editor.press("Control+End")
        editor.type("!")
        page.get_by_role("button", name="Save", exact=True).click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        assert writes[-1] == expected + "!"
        # The read-only journal uses a different Markdown renderer.
        page.reload()
        page.wait_for_load_state("networkidle")
        page.locator(".desktop-entry-row").first.click()
        rendered = page.locator(".journal-markdown").filter(has_text="First sentence.").first
        expect(rendered).to_be_visible()
        assert rendered.locator("br").count() == count
        if count == 4:
            page.screenshot(path="/tmp/opencode/pro-45/note-read.png")

    # Existing soft breaks, paragraph breaks, and inline formatting remain readable.
    saved["note"] = "First\nSecond\n\n**Third**\\\nFourth"
    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Edit today", exact=True).click()
    expect(editor).to_contain_text("Fourth")
    page.wait_for_load_state("networkidle")
    paragraphs = editor.locator("p")
    assert paragraphs.count() == 2
    metrics = paragraphs.first.evaluate("e => ({margin:parseFloat(getComputedStyle(e).marginBottom), line:parseFloat(getComputedStyle(e).lineHeight)})")
    assert abs(metrics["margin"] - metrics["line"]) < 0.1
    page.screenshot(path="/tmp/opencode/pro-45/note-edit.png")
    editor.click()
    editor.press("Control+End")
    editor.press("Shift+Enter")
    editor.type("Fifth")
    page.get_by_role("button", name="Save", exact=True).click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    assert "**Third**" in writes[-1] and writes[-1].endswith("Fourth\\\nFifth"), writes[-1]
    page.wait_for_load_state("networkidle")
    page.unroute_all(behavior="wait")
    print(json.dumps({"filter_viewports": [1440, 390], "roundtrip_enter_counts": [0, 1, 2, 3, 4], "result": "PASS"}))
    browser.close()
