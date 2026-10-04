import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPageDraft, duplicatePage, newPageId, renamePage, setPageRoute } from './pageDraft.js';

describe('page draft', () => {
  it('create rename route duplicate', () => {
    let p = createPageDraft({ title: 'Home' });
    assert.equal(p.title, 'Home');
    p = renamePage(p, 'Overview');
    p = setPageRoute(p, '/custom/overview');
    const copy = duplicatePage(p);
    assert.notEqual(copy.pageId, p.pageId);
    assert.equal(copy.title.includes('copy'), true);
  });

  it('generates unique page ids under rapid creation', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      ids.add(newPageId());
      ids.add(createPageDraft().pageId);
      ids.add(duplicatePage(createPageDraft({ title: 'x' })).pageId);
    }
    assert.equal(ids.size, 150);
  });
});
