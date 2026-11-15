#!/usr/bin/env python3
"""Responsive smoke audit for a running Trade Journal instance.

Run against a test instance, preferably with a dedicated test account:
  python tests/responsive/run.py --base-url http://127.0.0.1:3000
  python tests/responsive/run.py --base-url https://tj.example.test --storage-state /path/to/state.json

Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use an installed system Chromium.
The script does not create, edit, or delete application data.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VIEWPORTS = [320, 360, 390, 768, 1024, 1440]
# Canonical current routes found in apps/web/src/app. Routes requiring data are
# still useful for layout checks; auth redirects are recorded separately.
ROUTES = [
    ("Dashboard", "/"),
    ("Daily Journal", "/journal"),
    ("Trades", "/trades"),
    ("Missed Trades", "/missed"),
    ("Strategies", "/strategies"),
    ("Calendar", "/calendar"),
    ("Accounts", "/accounts"),
    ("Reports", "/reports"),
    ("Notebook", "/notebook"),
    ("Routines", "/routines"),
    ("Import", "/import"),
    ("Prop Firms", "/prop-firms"),
    ("Settings", "/settings"),
]

MEASURE_LAYOUT = """() => {
  const root = document.documentElement;
  const body = document.body;
  const vw = root.clientWidth;
  const round = n => Math.round(n * 100) / 100;
  const overflowing = [...document.querySelectorAll('body *')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width <= 0 || r.height <= 0 || s.position === 'fixed' && (r.right < 0 || r.left > vw)) return false;
      // Exclude legitimate horizontally scrollable regions (tables, code/editor
      // panes, and explicitly scrollable containers); check the page separately.
      const x = s.overflowX;
      const isScrollRegion = ['auto', 'scroll'].includes(x) && el.scrollWidth > el.clientWidth + 2;
      return !isScrollRegion && (r.left < -1 || r.right > vw + 1);
    })
    .slice(0, 30)
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: typeof el.className === 'string' ? el.className.slice(0, 160) : null,
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      left: round(el.getBoundingClientRect().left),
      right: round(el.getBoundingClientRect().right),
      width: round(el.getBoundingClientRect().width)
    }));
  const scrollRegions = [...document.querySelectorAll('body *')]
    .filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 2)
    .map(el => ({tag: el.tagName.toLowerCase(), className: typeof el.className === 'string' ? el.className.slice(0, 100) : '', clientWidth: el.clientWidth, scrollWidth: el.scrollWidth}))
    .slice(0, 20);
  return {
    viewportWidth: vw,
    documentClientWidth: root.clientWidth,
    documentScrollWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
    pageHorizontalOverflow: Math.max(root.scrollWidth, body ? body.scrollWidth : 0) > vw + 2,
    documentHeight: Math.max(root.scrollHeight, body ? body.scrollHeight : 0),
    viewportMeta: !!document.querySelector('meta[name="viewport"]'),
    overflowingElements: overflowing,
    scrollRegions
  };
}"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Trade Journal layout across desktop/mobile viewports")
    parser.add_argument("--base-url", default=os.environ.get("TJ_BASE_URL", "http://127.0.0.1:3000"), help="Running Trade Journal URL")
    parser.add_argument("--storage-state", help="Playwright storage-state JSON for an authenticated test session")
    parser.add_argument("--viewports", default=",".join(map(str, DEFAULT_VIEWPORTS)), help="Comma-separated viewport widths")
    parser.add_argument("--routes", help="Comma-separated paths to test; defaults to canonical app routes")
    parser.add_argument("--output", default="artifacts/responsive", help="Output directory (relative to repo root unless absolute)")
    parser.add_argument("--timeout", type=int, default=20000, help="Navigation timeout in milliseconds")
    args = parser.parse_args()

    try:
        widths = [int(v.strip()) for v in args.viewports.split(",") if v.strip()]
    except ValueError:
        parser.error("--viewports must be comma-separated integer widths")
    if not widths or any(w < 240 or w > 5000 for w in widths):
        parser.error("Viewport widths must be between 240 and 5000 pixels")
    routes = [(p, p if p.startswith("/") else "/" + p) for p in args.routes.split(",")] if args.routes else ROUTES
    out = Path(args.output)
    if not out.is_absolute():
        out = ROOT / out
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "screenshots"
    shots.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    console_errors: list[dict] = []
    launch_options = {"headless": True}
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
    if executable:
        launch_options["executable_path"] = executable

    with sync_playwright() as p:
        browser: Browser = p.chromium.launch(**launch_options)
        for width in widths:
            context_args = {"viewport": {"width": width, "height": 900}, "device_scale_factor": 1, "is_mobile": width <= 430, "has_touch": width <= 430}
            if args.storage_state:
                context_args["storage_state"] = args.storage_state
            context = browser.new_context(**context_args)
            for label, route in routes:
                page: Page = context.new_page()
                page.set_default_timeout(args.timeout)
                page_errors: list[str] = []
                page.on("pageerror", lambda error, dest=page_errors: dest.append(str(error)))
                page.on("console", lambda msg, dest=console_errors, w=width, r=route: dest.append({"viewport": w, "route": r, "type": msg.type, "text": msg.text}) if msg.type == "error" else None)
                url = urljoin(args.base_url.rstrip("/") + "/", route.lstrip("/"))
                record = {"label": label, "route": route, "viewport": width, "url": url}
                try:
                    response = page.goto(url, wait_until="domcontentloaded", timeout=args.timeout)
                    try:
                        page.wait_for_load_state("networkidle", timeout=min(args.timeout, 5000))
                    except Exception:
                        pass  # Long-lived polling is not itself a responsive failure.
                    page.wait_for_timeout(350)
                    record["httpStatus"] = response.status if response else None
                    record["finalUrl"] = page.url
                    record["redirectedToLogin"] = "/login" in page.url
                    record["title"] = page.title()
                    record["layout"] = page.evaluate(MEASURE_LAYOUT)
                    record["pageErrors"] = page_errors
                    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in label).strip("-")
                    screenshot = shots / f"{width}px-{slug}.png"
                    page.screenshot(path=str(screenshot), full_page=True, animations="disabled")
                    record["screenshot"] = str(screenshot.relative_to(out))
                    record["status"] = "login-required" if record["redirectedToLogin"] else ("fail" if record["layout"]["pageHorizontalOverflow"] or page_errors else "pass")
                except Exception as exc:
                    record["status"] = "navigation-error"
                    record["error"] = str(exc)
                    record["pageErrors"] = page_errors
                results.append(record)
                page.close()
            context.close()
        browser.close()

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": args.base_url,
        "viewports": widths,
        "routes": [{"label": name, "path": path} for name, path in routes],
        "summary": {
            "total": len(results),
            "pass": sum(r.get("status") == "pass" for r in results),
            "fail": sum(r.get("status") == "fail" for r in results),
            "loginRequired": sum(r.get("status") == "login-required" for r in results),
            "navigationError": sum(r.get("status") == "navigation-error" for r in results),
            "pageHorizontalOverflow": sum(bool(r.get("layout", {}).get("pageHorizontalOverflow")) for r in results),
            "pageErrors": sum(len(r.get("pageErrors", [])) for r in results),
            "consoleErrors": len(console_errors),
        },
        "results": results,
        "consoleErrors": console_errors,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    lines = ["# Trade Journal responsive audit", "", f"- Base URL: `{args.base_url}`", f"- Generated: {report['generatedAt']}", f"- Viewports: {', '.join(str(w) + 'px' for w in widths)}", "", "## Summary", "", "| Result | Count |", "|---|---:|"]
    for key, value in report["summary"].items():
        lines.append(f"| {key} | {value} |")
    lines += ["", "## Route results", "", "| Viewport | Page | Status | HTTP | Page overflow | Off-screen elements | Screenshot |", "|---:|---|---|---:|---|---:|---|"]
    for r in results:
        layout = r.get("layout", {})
        lines.append(f"| {r['viewport']}px | {r['label']} (`{r['route']}`) | {r['status']} | {r.get('httpStatus', '—')} | {layout.get('pageHorizontalOverflow', '—')} | {len(layout.get('overflowingElements', [])) if layout else '—'} | {r.get('screenshot', '—')} |")
    lines += ["", "## Notes", "", "- `login-required` means the route redirected to `/login`; rerun with `--storage-state` for an authenticated session.", "- Internal horizontal scrolling is recorded under `scrollRegions` and is not automatically considered page overflow.", "- `overflowingElements` is a heuristic; inspect the associated screenshots before treating each item as a defect.", "- This is a layout smoke audit, not a full functional or accessibility certification.", ""]
    (out / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"Report: {out / 'report.md'}")
    print(f"JSON:   {out / 'report.json'}")
    print(f"Shots:  {shots}")
    return 1 if report["summary"]["fail"] or report["summary"]["navigationError"] else 0


if __name__ == "__main__":
    sys.exit(main())
