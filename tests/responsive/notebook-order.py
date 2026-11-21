"""Exercise real server preferences with isolated note fixtures on the test server."""
import os
from playwright.sync_api import sync_playwright, expect

url = 'http://localhost:3000'
notes = [dict(id=f'test-note-{i}', folderId='my-notes', title=f'Fixture {i}', content='',
              updatedAt=f'2026-01-0{i}T00:00:00Z') for i in (3, 2, 1)]

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'))
    api = pw.request.new_context(base_url=url)
    settings = '/api/settings/ui'
    before = api.get(settings).json()['preferences']

    def open_notebook():
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.route('**/api/notes', lambda route: route.fulfill(json={'notes': notes, 'folders': [dict(id='target', name='Target folder', kind='user')]}))
        page.goto(url + '/notebook')
        page.wait_for_load_state('networkidle')
        return page

    def order(page):
        return page.locator('.notebook-list button .truncate.font-medium').all_text_contents()

    def sort(page, direction):
        page.get_by_role('button', name=f'Sort by last modified: {direction} first').click()
        page.wait_for_load_state('networkidle')

    try:
        assert api.patch(settings, data={'key': 'notebookNoteOrder', 'value': 'newest'}).ok
        page = open_notebook()
        sort(page, 'oldest')
        assert order(page) == ['Fixture 1', 'Fixture 2', 'Fixture 3']
        sort(page, 'newest')
        assert order(page) == ['Fixture 3', 'Fixture 2', 'Fixture 1']
        page.get_by_text('Fixture 2', exact=True).click()
        source = page.get_by_text('Fixture 1', exact=True).bounding_box()
        target = page.get_by_text('Fixture 3', exact=True).bounding_box()
        page.mouse.move(source['x'] + 10, source['y'] + 10)
        page.mouse.down()
        page.mouse.move(target['x'] + 10, target['y'] + 10, steps=18)
        page.mouse.up()
        page.wait_for_load_state('networkidle')
        manual = ['Fixture 1', 'Fixture 3', 'Fixture 2']
        assert order(page) == manual
        page.reload()
        expect(page.get_by_placeholder('Title', exact=True)).to_have_value('Fixture 2')
        second = open_notebook()
        expect(second.get_by_placeholder('Title', exact=True)).to_have_value('Fixture 2')
        assert order(second) == manual
        sort(second, 'oldest')
        assert order(second) == ['Fixture 1', 'Fixture 2', 'Fixture 3']
        second.goto(url + '/journal')
        second.go_back()
        expect(second.get_by_placeholder('Title', exact=True)).to_have_value('Fixture 2')
        notes.pop(1)  # Simulate the current note being removed elsewhere.
        second.reload()
        expect(second.get_by_placeholder('Title', exact=True)).to_have_value('Fixture 1')
        second.route('**/api/notes/test-note-1', lambda route: route.fulfill(json={}))
        with second.expect_request('**/api/notes/test-note-1') as move:
            src = second.get_by_text('Fixture 1', exact=True).bounding_box()
            dst = second.locator('.notebook-folders button').filter(has_text='Target folder').bounding_box()
            second.mouse.move(src['x'] + 10, src['y'] + 10)
            second.mouse.down()
            second.mouse.move(dst['x'] + 10, dst['y'] + 10, steps=20)
            second.mouse.up()
        assert move.value.post_data_json == {'folderId': 'target'}
        print('PASS: date toggle, drag, refresh, independent session, date reset, navigation, deleted note')
    finally:
        browser.close()
        for key in ('notebookCurrentNote', 'notebookNoteOrder'):
            assert api.patch(settings, data={'key': key, 'value': before.get(key)}).ok
