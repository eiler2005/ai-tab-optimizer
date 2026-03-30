import { describe, it, expect } from 'vitest';
import { normalizeUrl, extractDomain, slugify } from '../url';

// ---------------------------------------------------------------------------
// normalizeUrl
// ---------------------------------------------------------------------------

describe('normalizeUrl', () => {
  it('returns the URL unchanged when there is nothing to normalize', () => {
    expect(normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/page')).toBe('https://example.com/page');
  });

  it('removes utm_source tracking parameter', () => {
    const input = 'https://example.com/page?utm_source=google';
    expect(normalizeUrl(input)).toBe('https://example.com/page');
  });

  it('removes utm_medium tracking parameter', () => {
    const input = 'https://example.com/?utm_medium=email';
    expect(normalizeUrl(input)).toBe('https://example.com/');
  });

  it('removes utm_campaign tracking parameter', () => {
    const input = 'https://example.com/?utm_campaign=spring';
    expect(normalizeUrl(input)).toBe('https://example.com/');
  });

  it('removes fbclid tracking parameter', () => {
    const input = 'https://example.com/post?fbclid=abc123';
    expect(normalizeUrl(input)).toBe('https://example.com/post');
  });

  it('removes gclid tracking parameter', () => {
    const input = 'https://example.com/?gclid=xyz';
    expect(normalizeUrl(input)).toBe('https://example.com/');
  });

  it('removes all tracking params at once and keeps non-tracking params', () => {
    const input = 'https://example.com/search?q=cats&utm_source=google&fbclid=abc';
    expect(normalizeUrl(input)).toBe('https://example.com/search?q=cats');
  });

  it('sorts remaining query parameters alphabetically', () => {
    const input = 'https://example.com/?z=1&a=2';
    expect(normalizeUrl(input)).toBe('https://example.com/?a=2&z=1');
  });

  it('removes trailing slash from non-root pathname', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
  });

  it('preserves root trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('strips hash fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('returns the original string when URL is invalid', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeUrl('')).toBe('');
  });

  it('treats two URLs with different tracking params as equal after normalizing', () => {
    const a = normalizeUrl('https://example.com/page?utm_source=fb&utm_medium=cpc');
    const b = normalizeUrl('https://example.com/page?utm_source=google');
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe('extractDomain', () => {
  it('extracts hostname from a simple URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
  });

  it('includes subdomain in the hostname', () => {
    expect(extractDomain('https://www.example.com')).toBe('www.example.com');
  });

  it('returns the input string when URL is invalid', () => {
    expect(extractDomain('not-a-url')).toBe('not-a-url');
  });

  it('extracts hostname ignoring port', () => {
    expect(extractDomain('http://localhost:8765/health')).toBe('localhost');
  });

  it('handles URL with query string', () => {
    expect(extractDomain('https://example.com/search?q=test')).toBe('example.com');
  });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  it('collapses multiple hyphens into one', () => {
    expect(slugify('hello--world')).toBe('hello-world');
  });

  it('truncates to maxLen', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long, 10)).toHaveLength(10);
  });

  it('does not end with a hyphen after truncation', () => {
    const result = slugify('word another word here', 10);
    expect(result.endsWith('-')).toBe(false);
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('preserves hyphens that are already in the text', () => {
    expect(slugify('react-hooks guide')).toBe('react-hooks-guide');
  });
});
