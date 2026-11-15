# Responsive viewport audit

This audit tests a **running** Trade Journal instance. It does not modify application data. Use a dedicated test instance/account, not a production account, when possible.

## Install the test dependency

```bash
python -m pip install -r tests/responsive/requirements.txt
```

Install Playwright's Chromium browser if one is not already available:

```bash
python -m playwright install chromium
```

Alternatively, use a system Chromium executable:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  python tests/responsive/run.py --base-url http://127.0.0.1:3000
```

## Run the audit

Start Trade Journal using the normal project instructions, then run:

```bash
python tests/responsive/run.py --base-url http://127.0.0.1:3000
```

Default viewport widths are **320, 360, 390, 768, 1024, and 1440 px**. The default route list covers Dashboard, Daily Journal, Trades, Missed Trades, Strategies, Calendar, Accounts, Reports, Notebook, Routines, Import, Prop Firms, and Settings.

If the app requires login, provide a Playwright storage-state JSON created for a test account:

```bash
python tests/responsive/run.py \
  --base-url http://127.0.0.1:3000 \
  --storage-state tests/responsive/.auth/test-user.json
```

To test a smaller subset:

```bash
python tests/responsive/run.py \
  --base-url http://127.0.0.1:3000 \
  --routes /journal,/trades,/missed,/strategies
```

## Output

The script writes `report.md`, `report.json`, and one full-page PNG per route/viewport under `artifacts/responsive/` (ignored by Git). It checks document-level horizontal overflow, records likely off-screen elements, notes login redirects and JavaScript page errors, and records scrollable inner regions separately. The element-boundary check is heuristic: inspect screenshots and element details before treating every flagged element as a bug.

Exit code is non-zero for page-overflow failures or navigation errors. A login redirect is reported as `login-required`, because a login screen is not evidence that the protected page itself passed its responsive check.
