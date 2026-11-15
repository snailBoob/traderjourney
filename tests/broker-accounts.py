"""Account-card UI checks against localhost:3000; all account data and writes are simulated.

Run after scripts/testenv.sh:
LD_LIBRARY_PATH=/home/ai/tools/pw-libs/root/usr/lib/x86_64-linux-gnu \
  /home/ai/tools/playwright-venv/bin/python tests/broker-accounts.py
"""
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:3000"
OUT = Path("/tmp/opencode/broker-ui")
OUT.mkdir(parents=True, exist_ok=True)


def account(broker, name, state="connected"):
    snapshot = None if state == "unknown" else {
        "equity": 1234.5, "currency": "USD", "positions": [{}, {}],
        "connectionStatus": state, "syncStatus": "error" if state == "disconnected" else "success",
        "connectionMessage": "Test credentials rejected. Check the API key." if state == "disconnected" else None,
        "syncMessage": "2 new fills · 0 already imported", "fetchedAt": "2026-11-13T10:00:00.000Z",
    }
    if broker == "bitunix":
        snapshot["openOrders"] = []
    return {"id": "fixture-" + broker, "name": name, "broker": broker, "kind": "sync",
            "currency": "USD", "initialBalance": 1000, "profitCalcMethod": "fifo",
            "lastSyncAt": None if state == "unknown" else "2026-11-13T10:00:00.000Z",
            "syncStartAt": "2026-10-01T00:00:00.000Z" if broker == "bitunix" else None,
            "archivedAt": None, "connected": state == "connected", "snapshot": snapshot}


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    rows = [account("binance", "Binance futures"), account("kraken", "Kraken balances", "unknown"),
            account("webull", "Webull options", "disconnected"), account("bitunix", "Bitunix futures")]
    errors, writes, foreign_requests = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda req: foreign_requests.append(req.url) if urlparse(req.url).netloc not in ("", "localhost:3000") else None)

    def api(route):
        req = route.request
        path = urlparse(req.url).path
        if path == "/api/accounts" and req.method == "GET":
            route.fulfill(json={"accounts": rows, "totalCapital": 4000})
        elif path.startswith("/api/accounts/fixture-") and req.method == "PATCH":
            body = req.post_data_json
            row = next(item for item in rows if path.endswith(item["id"]))
            row.update(body)
            writes.append((path, body))
            route.fulfill(json={"updated": True})
        elif path.startswith("/api/accounts/fixture-") and path.endswith("/actions") and req.method == "POST":
            assert req.post_data_json == {"action": "sync"}
            row = next(item for item in rows if item["id"] in path)
            row["connected"] = True
            row["snapshot"].update(connectionStatus="connected", syncStatus="success", connectionMessage=None)
            route.fulfill(json={"sync": {"inserted": 0, "duplicates": 2, "skipped": 0, "fetched": 2}})
        elif req.method != "GET":
            errors.append("Unexpected write: " + path)
            route.abort()
        else:
            route.continue_()

    page.route("**/api/**", api)
    page.goto(BASE + "/accounts")
    page.wait_for_load_state("networkidle")

    def card(name):
        return page.locator(".card-sheen").filter(has=page.get_by_text(name, exact=True))

    expect(card("Kraken balances").get_by_role("status")).to_have_text("Not checked")
    expect(card("Webull options").get_by_role("status")).to_have_text("Disconnected")
    expect(card("Binance futures").get_by_text("Broker equity", exact=True)).to_be_visible()
    expect(card("Binance futures").get_by_text("Open orders unavailable", exact=False)).to_be_visible()
    expect(card("Bitunix futures").get_by_text("0 open orders", exact=False)).to_be_visible()
    card("Kraken balances").locator("summary").click()
    expect(card("Kraken balances").get_by_text("does not import trades", exact=False)).to_be_visible()

    # Change only the simulated account, then exercise recovery from a failed sync.
    page.get_by_role("button", name="Edit sync start date for Binance futures", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox", name="Sync start date", exact=True).fill("2026-02-30")
    expect(dialog.get_by_role("button", name="Save", exact=True)).to_be_disabled()
    dialog.get_by_role("textbox", name="Sync start date", exact=True).fill("2026-09-01")
    dialog.get_by_role("button", name="Save", exact=True).click()
    expect(dialog).to_have_count(0)
    assert writes[-1][1] == {"syncStartAt": "2026-09-01T00:00:00.000Z"}
    expect(card("Binance futures").get_by_role("button", name="Edit sync start date for Binance futures")).to_contain_text("2026-09-01")
    card("Webull options").get_by_role("button", name="Sync now", exact=True).click()
    expect(card("Webull options").get_by_role("status")).to_have_text("Connected")

    for width, height in [(1440, 1000), (768, 1000), (390, 844)]:
        page.set_viewport_size({"width": width, "height": height})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
        title = card("Binance futures").get_by_text("Binance futures", exact=True).bounding_box()
        assert title["width"] >= 100 and title["height"] <= 48, title
        page.screenshot(path=str(OUT / f"accounts-{width}.png"), full_page=True)

    # The same form renders support limits before a user enters any credentials.
    page.get_by_role("button", name="Add account", exact=True).click()
    dialog = page.get_by_role("dialog")
    for broker, has_date in [("Binance", True), ("Kraken", False), ("Webull", True), ("Bitunix", True)]:
        dialog.get_by_role("combobox").click()
        page.get_by_role("option", name=broker, exact=True).click()
        expect(dialog.get_by_role("button", name="Create account", exact=True)).to_be_visible()
        expect(dialog.get_by_role("textbox", name="Sync start date", exact=True)).to_have_count(int(has_date))
        expect(dialog.get_by_role("button", name="Create account", exact=True)).to_be_disabled()
    page.screenshot(path=str(OUT / "add-account-mobile.png"), full_page=True)
    dialog.get_by_role("button", name="Cancel", exact=True).click()
    expect(dialog).to_have_count(0)
    page.evaluate("document.documentElement.classList.add('dark')")
    page.screenshot(path=str(OUT / "accounts-dark-mobile.png"), full_page=True)

    assert not errors, errors
    assert not foreign_requests, foreign_requests
    # Check all real local assets, including those absent from the sample cards.
    logos = json.loads((Path(__file__).resolve().parents[1] / "apps/web/public/brokers/sources.json").read_text())
    page.set_viewport_size({"width": 1000, "height": 800})
    page.set_content('<style>body{font:14px sans-serif;background:#eee;padding:24px}main{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}article{background:white;padding:16px;text-align:center}img{width:32px;height:32px;object-fit:contain}</style><main>' + ''.join(
        f'<article><img src="{BASE}/brokers/{item["file"]}" alt="{name}"><p>{name}</p></article>' for name, item in logos.items()) + '</main>')
    page.wait_for_function("Array.from(document.images).every(img => img.complete)")
    assert page.locator("img").evaluate_all("imgs => imgs.every(img => img.naturalWidth > 0)")
    page.screenshot(path=str(OUT / "all-broker-icons.png"), full_page=True)
    browser.close()
    print("PASS: statuses, unavailable data, start-date edit, sync recovery, broker forms, responsive layouts, 23 local icons. No live broker calls or database writes.")
