import { describe, expect, it } from 'vitest';
import { exactUrlKey, normalizeUrl, slugify } from '../url';
import { runRules, tabProtectionReason } from '../rules';
import { makeTab } from './fixtures';

describe('safe URL identity', () => {
  it.each([
    ['https://app.test/#/one', 'https://app.test/#/two'],
    ['https://app.test/?source=one', 'https://app.test/?source=two'],
    ['https://app.test/?ref=one', 'https://app.test/?ref=two'],
    ['https://app.test/Page', 'https://app.test/page'],
    ['https://app.test/page/', 'https://app.test/page'],
  ])('keeps semantically distinct addresses separate: %s', (a, b) => {
    expect(normalizeUrl(a)).not.toBe(normalizeUrl(b));
    expect(exactUrlKey(a)).not.toBe(exactUrlKey(b));
  });
  it('excludes internal and invalid URLs from exact candidates', () => {
    expect(exactUrlKey('chrome://newtab/')).toBeNull();
    expect(runRules([makeTab({ url: '', domain: '' }), makeTab({ url: '', domain: '' })]).duplicateCount).toBe(0);
  });
  it('prefers a pinned copy and protects marked or audible tabs', () => {
    const tabs = [makeTab({ id: 1, url: 'https://app.test/' }), makeTab({ id: 2, url: 'https://app.test/', pinned: true })];
    expect(runRules(tabs).tabs[0].ruleFlags?.duplicateOfTabId).toBe(2);
    expect(tabProtectionReason(makeTab({ userFlag: 'protected' }))).toBeTruthy();
    expect(tabProtectionReason(makeTab({ audible: true }))).toBeTruthy();
    expect(tabProtectionReason(makeTab({ domain: 'docs.example.com' }), ['example.com'])).toBeTruthy();
  });
  it('keeps Cyrillic titles usable as filenames', () => {
    expect(slugify('Первая заметка')).toBe('первая-заметка');
    expect(slugify('Вторая заметка')).not.toBe(slugify('Первая заметка'));
  });
});
