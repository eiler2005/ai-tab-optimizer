// Content script: extracts page metadata on demand.
// Injected by service worker via chrome.scripting.executeScript.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE_DATA') {
    const metaDesc =
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ??
      document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ??
      '';

    const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';

    const bodyEl = document.querySelector('article') ??
      document.querySelector('main') ??
      document.querySelector('[role="main"]') ??
      document.body;

    const excerpt = (bodyEl?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    sendResponse({
      metaDescription: metaDesc,
      h1,
      excerpt,
    });
  }
  return true;
});
