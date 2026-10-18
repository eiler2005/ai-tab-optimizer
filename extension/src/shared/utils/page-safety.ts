// Chat URLs identify a route/conversation, not unsent drafts or current page state.
const CHAT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com']);

export function isStatefulChat(url: string): boolean {
  try { return CHAT_HOSTS.has(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}
