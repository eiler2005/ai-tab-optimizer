import type { UserSettings } from '@shared/types';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function normalizeServerUrl(serverUrl: string): URL {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    throw new Error('AI server URL is empty. Check Settings.');
  }

  try {
    const url = new URL(trimmed);
    if (!url.protocol.startsWith('http')) {
      throw new Error('AI server URL must use http or https.');
    }
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url;
  } catch {
    throw new Error(`Invalid AI server URL: ${trimmed}`);
  }
}

export function buildServerEndpointCandidates(serverUrl: string, endpoint: string): string[] {
  const base = normalizeServerUrl(serverUrl);
  const target = new URL(endpoint, base);
  const hosts = [base.hostname];

  if (base.hostname === 'localhost') {
    hosts.push('127.0.0.1');
  } else if (base.hostname === '127.0.0.1' || base.hostname === '[::1]') {
    hosts.push('localhost');
  }

  return [...new Set(hosts)].map((hostname) => {
    const candidate = new URL(target.toString());
    candidate.hostname = hostname;
    return candidate.toString();
  });
}

export async function fetchLocalServer(
  serverUrl: string,
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  const candidates = buildServerEndpointCandidates(serverUrl, endpoint);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      return await fetch(candidate, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error && lastError.message
    ? ` Last error: ${lastError.message}`
    : '';
  throw new Error(`Could not connect to AI server at ${serverUrl}. Make sure "pnpm server" is running.${suffix}`);
}

export async function fetchLocalServerWithTimeout(
  serverUrl: string,
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutController = new AbortController();
  const originalSignal = init.signal;
  let timedOut = false;

  const propagateAbort = () => {
    timeoutController.abort(originalSignal?.reason);
  };

  if (originalSignal) {
    if (originalSignal.aborted) {
      propagateAbort();
    } else {
      originalSignal.addEventListener('abort', propagateAbort, { once: true });
    }
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutController.abort(
      new DOMException(
        `AI batch request timed out after ${Math.round(timeoutMs / 1000)}s`,
        'TimeoutError',
      ),
    );
  }, timeoutMs);

  try {
    return await fetchLocalServer(serverUrl, endpoint, {
      ...init,
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`AI batch request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    if (originalSignal) {
      originalSignal.removeEventListener('abort', propagateAbort);
    }
  }
}

export async function readServerError(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as { detail?: unknown };
    if (typeof data.detail === 'string' && data.detail.trim()) {
      return data.detail.trim();
    }
    if (data.detail !== undefined) {
      return JSON.stringify(data.detail);
    }
  } catch {
    // Ignore JSON parsing errors and fall back to plain text.
  }

  try {
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function fetchServerJson<T>(
  endpoint: string,
  init: RequestInit = {},
  options: string | {
    serverUrl?: string;
    getSettings?: () => Promise<Pick<UserSettings, 'localServerUrl'>>;
  } = {},
): Promise<T> {
  const resolvedServerUrl = typeof options === 'string'
    ? options
    : options.serverUrl ?? (await options.getSettings?.())?.localServerUrl;
  if (!resolvedServerUrl) {
    throw new Error('AI server URL is empty. Check Settings.');
  }

  const headers = new Headers(init.headers ?? undefined);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchLocalServer(resolvedServerUrl, endpoint, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await readServerError(response);
    throw new Error(
      detail
        ? `Local server responded with ${response.status}: ${detail}`
        : `Local server responded with ${response.status}`,
    );
  }

  return (await response.json()) as T;
}
