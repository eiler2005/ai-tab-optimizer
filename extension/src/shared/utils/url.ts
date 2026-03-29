const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
]);

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Lowercase scheme + hostname
    u.hostname = u.hostname.toLowerCase();
    // Remove tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) {
        u.searchParams.delete(key);
      }
    }
    // Sort remaining params
    u.searchParams.sort();
    // Remove trailing slash from pathname
    if (u.pathname.endsWith('/') && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Remove hash
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function slugify(text: string, maxLen = 60): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLen)
    .replace(/-$/, '');
}
