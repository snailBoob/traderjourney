"""Mobile entry and touch regressions against localhost:3000. All API writes are intercepted."""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('/tmp/opencode/mobile-implementation')
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://localhost:3000'


def touch_drag(page, source, target, hold=False):
    source.scroll_into_view_if_needed()
    a, z = source.bounding_box(), target.bounding_box()
    assert a and z
    x, y = a['x'] + a['width'] / 2, a['y'] + a['height'] / 2
    tx, ty = z['x'] + z['width'] / 2, z['y'] + z['height'] / 2
    session = page.context.new_cdp_session(page)
    session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    if hold:
        # Exercise the actual long-press activation delay, not a rendering wait.
        page.wait_for_timeout(350)
    for step in range(1, 16):
        session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + (tx-x)*step/15, 'y': y + (ty-y)*step/15}]})
    session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    session.detach()


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = context.new_page()
    errors, writes, checks = [], [], []
    preferences = page.request.get(BASE + '/api/settings/ui').json()
    original_preferences = json.loads(json.dumps(preferences))
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        request = route.request
        if request.url.endswith('/api/settings/ui'):
            if request.method == 'PATCH':
                body = request.post_data_json
                preferences['preferences'][body['key']] = body['value']
                writes.append({'url': request.url, 'body': body})
            route.fulfill(json=preferences)
        elif request.method not in ('GET', 'HEAD'):
            writes.append({'url': request.url, 'body': request.post_data_json})
            route.fulfill(json={'ok': True})
        else:
            route.continue_()
    context.route('**/api/**', api)

    def visit(path):
        page.goto(BASE + '/' + path)
        page.wait_for_load_state('networkidle')

    # Every entry family, including nested Journal trades, must remain within its own width.
    for path in ('journal', 'trades', 'missed'):
        for w, h in ((320, 740), (390, 844), (412, 915), (640, 360), (915, 412)):
            page.set_viewport_size({'width': w, 'height': h})
            visit(path)
            expect(page.locator('.adaptive-entry-toggle').first).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            before_url = page.url
            if path == 'journal':
                days = page.request.get(BASE + '/api/journal?page=1').json()['days']
                date = next(day['date'] for day in days if day['stats'] and day['stats']['trades'] > 0)
                toggle = page.locator(f'#journal-day-mobile-{date} .adaptive-entry-toggle')
            else:
                toggle = page.locator('.adaptive-entry-toggle').first
            toggle.click()
            page.wait_for_load_state('networkidle')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('.entry-detail').evaluate_all('(els)=>els.every(e=>e.scrollWidth<=e.clientWidth+1)')
            assert page.locator('.adaptive-entry-fields').evaluate_all('''els=>els.every(e=>Array.from(e.querySelectorAll(':scope > [data-field]')).every(c=>c.getBoundingClientRect().right<=e.getBoundingClientRect().right+1))''')
            # Includes non-table blocks and execution cards, not just document-level overflow.
            overflow = page.locator('.entry-detail').evaluate_all('''roots=>roots.flatMap(root=>Array.from(root.querySelectorAll('*')).filter(e=>{
              const r=e.getBoundingClientRect(); return r.width>0 && getComputedStyle(e).visibility!=='hidden' && !e.closest('.adaptive-entry-measure') && (r.right>root.getBoundingClientRect().right+1 || r.left<root.getBoundingClientRect().left-1);
            }).map(e=>e.tagName+'.'+e.className))''')
            assert not overflow, (path, w, overflow)
            page.screenshot(path=str(OUT / f'{path}-{w}-expanded.png'), full_page=True)
            toggle.click()
            expect(page).to_have_url(before_url)
            checks.append(f'{path} {w}x{h}: entry and detail fit; expand/collapse')

        page.set_viewport_size({'width': 390, 'height': 844})
        visit(path)
        page.get_by_role('button', name='Columns', exact=True).click()
        panel = page.locator('.mobile-column-panel')
        expect(panel).to_be_visible()
        assert abs(panel.bounding_box()['y'] - page.locator('.journal-filter-bar').bounding_box()['y'] - page.locator('.journal-filter-bar').bounding_box()['height']) < 2
        handles = panel.locator('button[aria-roledescription="sortable"]')
        expected_first = handles.nth(1).get_attribute('aria-label')
        n = len(writes)
        touch_drag(page, handles.nth(0), handles.nth(1))
        expect(handles.first).to_have_attribute('aria-label', expected_first)
        assert len(writes) > n
        page.screenshot(path=str(OUT / f'{path}-columns.png'))
        # Check selection updates the actual per-entry data set.
        checkbox = panel.get_by_role('checkbox').first
        checkbox.click()
        checked = checkbox.get_attribute('aria-checked')
        assert checked == 'false'
        checks.append(f'{path}: touch reorder persisted; Columns anchored; selection toggles')

    visit('journal')
    page.locator(f'#journal-day-mobile-{date} .adaptive-entry-toggle').click()
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='Reorder columns', exact=True).click()
    handles = page.locator('.entry-detail button[aria-roledescription="sortable"]')
    second_label = handles.nth(1).get_attribute('aria-label')
    n = len(writes)
    touch_drag(page, handles.first, handles.nth(1))
    expect(handles.first).to_have_attribute('aria-label', second_label)
    assert writes[-1]['body']['key'] == 'journalTradesColumnOrder'
    page.get_by_role('button', name='Reorder columns', exact=True).click()
    page.locator('.entry-detail .adaptive-entry-toggle').first.click()
    page.wait_for_load_state('networkidle')
    assert page.locator('.entry-detail').evaluate_all('(els)=>els.every(e=>e.scrollWidth<=e.clientWidth+1)')
    page.screenshot(path=str(OUT / 'journal-nested-trade.png'), full_page=True)
    checks.append('Journal nested trades: touch column reorder and expanded trade fit')

    visit('journal?focusDate=' + date)
    page.wait_for_function('''date => {
      const row=document.getElementById('journal-day-mobile-'+date);
      const bar=document.querySelector('.journal-page-title-sticky');
      return row && Math.abs(row.getBoundingClientRect().top-bar.getBoundingClientRect().bottom)<3;
    }''', arg=date)
    checks.append('Journal focusDate: mobile entry aligned below sticky header')

    # Different data in the SAME list must use one shared layout and one heading.
    def journal_values(route):
        data = route.fetch().json()
        example = next(day['stats'] for day in data['days'] if day['stats'])
        data['days'][0]['stats'] = {**example, 'netPnl': 999999999.99, 'trades': 333}
        data['days'][1]['stats'] = {**example, 'netPnl': 1, 'trades': 1}
        route.fulfill(json=data)
    preferences['preferences']['journalColumnOrder'] = ['date', 'pnl', 'trades', 'winrate', 'wl', 'bias', 'sessionDuration', 'routine']
    page.route(re.compile(r'/api/journal\?.*page='), journal_values)
    visit('journal')
    fields = page.locator('.adaptive-entry-row .adaptive-entry-fields')
    page.wait_for_function("document.querySelectorAll('.adaptive-entry-fields > [data-field]').length > 0")
    counts = fields.evaluate_all("els=>els.slice(0,2).map(e=>e.querySelectorAll(':scope > [data-field]').length)")
    assert counts[0] == counts[1] and counts[0] > 0, counts
    assert page.locator('.adaptive-entry-row .adaptive-entry-label:visible').count() == 0
    assert page.locator('.adaptive-entry-heading:visible').count() == 1
    positions = fields.evaluate_all("els=>els.slice(0,2).map(e=>Array.from(e.querySelectorAll(':scope > [data-field]'), c=>c.getBoundingClientRect().x))")
    assert positions[0] == positions[1], positions
    page.set_viewport_size({'width': 915, 'height': 412})
    page.wait_for_function('(before)=>document.querySelector(".adaptive-entry-row .adaptive-entry-fields").querySelectorAll(":scope > [data-field]").length>before', arg=counts[0])
    checks.append(f'uniform content-dependent fitting: shared counts {counts} and positions; landscape adds fields')
    page.unroute(re.compile(r'/api/journal\?.*page='), journal_values)

    # No height collapse or upward page jump during expansion, including the URL-driven Trades flow.
    page.set_viewport_size({'width': 390, 'height': 844})
    for path in ('journal', 'trades', 'missed'):
        visit(path)
        rows = page.locator('.entry-table > tbody > .adaptive-entry-row')
        count_before = rows.count()
        row = rows.nth(min(10, count_before-1))
        row.evaluate('(e)=>e.scrollIntoView({block:"center"})')
        y = row.bounding_box()['y']
        row.evaluate('''e=>{window.entryPositions=[];window.sampleEntry=true;
          const sample=()=>{if(!window.sampleEntry)return;entryPositions.push(e.getBoundingClientRect().top);requestAnimationFrame(sample)};sample();}''')
        row.locator('.adaptive-entry-toggle').tap()
        page.wait_for_load_state('networkidle')
        # Observe late router focus and asynchronous detail rendering, not only the first commit.
        page.wait_for_timeout(1500)
        positions = page.evaluate('()=>{sampleEntry=false;return entryPositions}')
        assert all(abs(position-y)<=2 for position in positions), (path, y, min(positions), max(positions))
        assert abs(row.bounding_box()['y'] - y) <= 2, (path, y, row.bounding_box()['y'])
        assert page.locator('.entry-after-expanded:visible').count() == 0
        row.locator('.adaptive-entry-toggle').tap()
        expect(rows.locator('.adaptive-entry-toggle').last).to_be_visible()
        before = rows.first.locator('.adaptive-entry-fields > [data-field]').count()
        page.set_viewport_size({'width': 844, 'height': 390})
        page.wait_for_function('(before)=>document.querySelector(".adaptive-entry-row .adaptive-entry-fields").querySelectorAll(":scope > [data-field]").length>before', arg=before)
        page.set_viewport_size({'width': 390, 'height': 844})
        checks.append(f'{path}: touch expansion stays anchored through loading; following rows hidden; landscape adds columns')

    # Notes: Move to starts the toolbar; folder rows reorder after a long press.
    page.set_viewport_size({'width': 390, 'height': 844})
    visit('notebook')
    move = page.get_by_role('button', name='Move to…', exact=True)
    expect(move).to_be_visible()
    assert move.bounding_box()['x'] < 24
    toolbar = page.locator('.notebook-entry-actions')
    buttons = toolbar.locator('button:visible')
    assert buttons.count() == 6
    for width, per_row in ((320, 2), (412, 3)):
        page.set_viewport_size({'width': width, 'height': 915})
        rects = buttons.evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().toJSON())')
        assert len([r for r in rects if abs(r['y']-rects[0]['y'])<2]) == per_row
        assert all(r['height']>=44 and r['right']<=width for r in rects)
    page.set_viewport_size({'width': 390, 'height': 844})
    move.click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.keyboard.press('Escape')
    page.get_by_role('button', name='Back to notes', exact=True).click()
    page.get_by_role('button', name='Note folder', exact=True).click()
    folders = page.locator('[data-radix-popper-content-wrapper] [aria-roledescription="sortable"]')
    assert folders.count() >= 2
    assert folders.locator('svg').count() == 0
    second = folders.nth(1).inner_text()
    n = len(writes)
    touch_drag(page, folders.nth(0), folders.nth(1), hold=True)
    expect(folders.first).to_contain_text(second)
    assert len(writes) > n
    assert writes[-1]['body']['key'] == 'notebookFolderOrder'
    page.screenshot(path=str(OUT / 'notes-folders.png'))
    page.keyboard.press('Escape')
    checks.append('Notes: Move to first; folder long-press reorder persisted')

    # Existing card handles: real touch events, actual resulting persistence request.
    for path, key in (('accounts', 'accountOrder'), ('strategies', 'playbookOrder')):
        page.set_viewport_size({'width': 390, 'height': 1800})
        visit(path)
        handles = page.locator('button[aria-roledescription="sortable"]')
        n = len(writes)
        touch_drag(page, handles.nth(0), handles.nth(1))
        page.wait_for_function('()=>!document.querySelector("[aria-pressed=true][aria-roledescription=sortable]")')
        assert any(w['body'].get('key') == key for w in writes[n:]), (path, writes[n:])
        checks.append(f'{path}: touch card reorder persisted')

    def routines_fixture(route):
        if route.request.method != 'GET':
            route.fallback()
            return
        data = route.fetch().json()
        for rule in data['rules']:
            rule['weekdays'] = list(range(7))
        route.fulfill(json=data)
    page.route('**/api/workspace/progress', routines_fixture)
    visit('routines')
    handles = page.get_by_role('button', name=re.compile('^Drag '))
    assert handles.count() >= 2
    n = len(writes)
    touch_drag(page, handles.nth(0), handles.nth(1))
    assert any('reorder' in w['body'] for w in writes[n:]), writes[n:]
    checks.append('Routines: touch handle reorder submits ordered IDs')
    page.unroute('**/api/workspace/progress', routines_fixture)

    page.set_viewport_size({'width': 390, 'height': 844})
    visit('')
    # Dashboard widgets and saved layouts use independent DnD contexts.
    handles = page.locator('button[aria-roledescription="sortable"][aria-label^="Rearrange "]')
    n = len(writes)
    first_label = handles.first.get_attribute('aria-label')
    touch_drag(page, handles.first, handles.nth(1))
    expect(handles.first).not_to_have_attribute('aria-label', first_label)
    checks.append('Dashboard: touch widget reorder changes order')
    page.get_by_role('button', name='Dashboard layouts', exact=True).click()
    page.get_by_role('button', name='Reorder layout items', exact=True).click()
    handles = page.locator('button[aria-roledescription="sortable"][aria-label^="Reorder "]:visible')
    first_label = handles.first.get_attribute('aria-label')
    touch_drag(page, handles.first, handles.nth(1))
    expect(handles.first).not_to_have_attribute('aria-label', first_label)
    page.keyboard.press('Escape')
    checks.append('Dashboard: touch saved-layout reorder changes order')

    page.get_by_role('button', name='Open navigation', exact=True).click()
    page.get_by_role('button', name='Reorder menu items', exact=True).click()
    handles = page.locator('button[aria-roledescription="sortable"][aria-label^="Reorder "]:visible')
    first_label = handles.first.get_attribute('aria-label')
    touch_drag(page, handles.first, handles.nth(1))
    expect(handles.first).not_to_have_attribute('aria-label', first_label)
    checks.append('Navigation: touch menu reorder changes order')

    # Short landscape account form: scroll to inputs, then reach Cancel/Create.
    page.set_viewport_size({'width': 640, 'height': 360})
    visit('accounts')
    page.get_by_role('button', name='Add account', exact=True).click()
    page.get_by_role('tab', name='Manual', exact=True).click()
    dialog = page.get_by_role('dialog')
    dialog.locator('input').first.fill('Mobile validation')
    dialog.locator('input').nth(2).fill('123.45')
    create = dialog.get_by_role('button', name='Create account', exact=True)
    create.scroll_into_view_if_needed()
    for button in (create, dialog.get_by_role('button', name='Cancel', exact=True)):
        r = button.bounding_box()
        assert r['y'] >= 0 and r['y']+r['height'] <= 360
    page.screenshot(path=str(OUT / 'account-landscape.png'))
    dialog.get_by_role('button', name='Cancel', exact=True).click()
    checks.append('Account landscape: input and Cancel/Create reachable')

    # Desktop screenshots for comparison; the old table and column placement stay in use.
    preferences = original_preferences
    page.set_viewport_size({'width': 1440, 'height': 1000})
    for path in ('journal', 'trades', 'missed', 'notebook'):
        visit(path)
        assert page.locator('.adaptive-entry-row:visible').count() == 0
        page.screenshot(path=str(OUT / f'after-{path}-desktop.png'))
        if path != 'notebook':
            page.get_by_role('button', name='Columns', exact=True).click()
            assert page.locator('.mobile-column-panel').count() == 0
            handles = page.locator('button[aria-roledescription="sortable"]')
            expected_first = handles.nth(1).get_attribute('aria-label')
            handles.first.scroll_into_view_if_needed()
            a, z = handles.first.bounding_box(), handles.nth(1).bounding_box()
            page.mouse.move(a['x'] + a['width']/2, a['y'] + a['height']/2)
            page.mouse.down()
            page.mouse.move(z['x'] + z['width']/2, z['y'] + z['height']/2, steps=20)
            page.mouse.up()
            expect(handles.first).to_have_attribute('aria-label', expected_first)
        checks.append(f'{path}: desktop preserved; mouse column reorder')

    assert not errors, errors
    (OUT / 'results.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors, 'interceptedWrites': len(writes)}, indent=2))
    print('\n'.join(checks))
    browser.close()
