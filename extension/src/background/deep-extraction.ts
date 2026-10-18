export async function extractDeepText(tabId: number): Promise<string> {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const main = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
    const dates = [...document.querySelectorAll('time[datetime], meta[property="article:published_time"], meta[property="article:modified_time"]')]
      .map((node) => node.getAttribute('datetime') ?? node.getAttribute('content') ?? '').join('\n');
    return [document.querySelector('h1')?.textContent ?? '', dates, (main as HTMLElement)?.innerText ?? ''].join('\n').replace(/\s+/g, ' ').trim().slice(0, 8000);
  } });
  const text: unknown = result[0]?.result;
  if (typeof text !== 'string' || !text) throw new Error('Main page text is unavailable');
  return text;
}
