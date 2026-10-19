import { describe, expect, it } from 'vitest';
import { resumeCleanup, type CleanupPosition } from '../cleanup-position';

const order = [1, 2, 3, 4].map((id) => ({ id, url: `https://example.test/${id}` }));
const position: CleanupPosition = { order, index: 1, offset: 20 };
describe('continuing a cleanup at the previous reading position', () => {
  it('returns to the same unchanged page when it remains open', () => expect(resumeCleanup(position, order)).toEqual(order[1]));
  it('advances past closed pages to the next page in the old order', () => expect(resumeCleanup(position, [order[0], order[3]])).toEqual(order[3]));
  it('does not treat a navigated or reused tab ID as the same page', () => expect(resumeCleanup(position, [{ id: 2, url: 'https://elsewhere.test/' }, order[2]])).toEqual(order[2]));
  it('uses the nearest previous page at the end and handles an empty result', () => {
    expect(resumeCleanup({ ...position, index: 3 }, [order[0], order[2]])).toEqual(order[2]);
    expect(resumeCleanup(position, [])).toBeUndefined();
  });
});
