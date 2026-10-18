import { describe, expect, it } from 'vitest';
import { buildLibrary, collectionDetails, searchLibrary } from '../library';
import type { SavedCollection } from '@shared/types/workspace';
import { makeTab } from './fixtures';

const collection: SavedCollection = { id: 'a', name: 'Research notes', createdAt: 1, updatedAt: 1, revision: 1, purpose: 'later', reason: 'Learn concurrency', windows: [{ id: 'w', focused: false, tabs: [{ itemId: 'i', savedAt: 1, url: 'https://a.test/Case', title: 'Transactions', domain: 'a.test', pinned: false, note: 'изоляция записей' }] }] };
describe('library search', () => {
  it('joins exact live and saved copies, searches notes, purpose and collection filters', () => {
    const pages = buildLibrary([{ windowId: 1, focused: true, tabs: [makeTab({ url: 'https://a.test/Case' })] }], [collection, { ...collection, id: 'trash', deletedAt: 1 }]);
    expect(pages).toHaveLength(1);
    expect(pages[0].saved).toHaveLength(1);
    expect(searchLibrary(pages, 'изоляция status:later collection:"Research notes"')).toHaveLength(1);
    expect(searchLibrary(pages, 'domain:a.test status:open')).toHaveLength(1);
    expect(searchLibrary(pages, 'status:now')).toHaveLength(0);
  });
  it('retains path case and separates same-address chat state', () => {
    const pages = buildLibrary([{ windowId: 1, focused: true, tabs: [makeTab({ id: 1, url: 'https://a.test/case' }), makeTab({ id: 2, url: 'https://chatgpt.com/' }), makeTab({ id: 3, url: 'https://chatgpt.com/' })] }], [collection]);
    expect(pages).toHaveLength(4);
  });
  it('rejects invalid persisted metadata and accepts old collections without migration', () => {
    expect(collectionDetails({})).toEqual({});
    expect(() => collectionDetails({ reviewAt: NaN })).toThrow('date');
    expect(() => collectionDetails({ reason: 'x'.repeat(1001) })).toThrow('1,000');
    expect(collectionDetails({ focus: '  React 19  ', reviewAt: null })).toEqual({ focus: 'React 19', reviewAt: null });
  });
});
