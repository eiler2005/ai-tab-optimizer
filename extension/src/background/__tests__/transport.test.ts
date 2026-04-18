import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildServerEndpointCandidates,
  fetchLocalServer,
  fetchServerJson,
  normalizeServerUrl,
  readServerError,
} from '../transport';

describe('background transport helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes the server URL and preserves a trailing slash', () => {
    expect(normalizeServerUrl('http://localhost:8765').toString()).toBe('http://localhost:8765/');
    expect(normalizeServerUrl('http://localhost:8765/api').toString()).toBe('http://localhost:8765/api/');
  });

  it('builds localhost fallback candidates', () => {
    expect(buildServerEndpointCandidates('http://localhost:8765', '/health')).toEqual([
      'http://localhost:8765/health',
      'http://127.0.0.1:8765/health',
    ]);
  });

  it('retries the alternate loopback hostname when the first candidate fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const response = await fetchLocalServer('http://localhost:8765', '/health', {});
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches JSON using the resolved server URL from settings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );

    const payload = await fetchServerJson<{ status: string }>(
      '/health',
      {},
      { getSettings: async () => ({ localServerUrl: 'http://localhost:8765' }) },
    );
    expect(payload.status).toBe('ok');
  });

  it('extracts server detail from JSON error responses', async () => {
    const response = new Response(JSON.stringify({ detail: 'bad request' }), { status: 400 });
    await expect(readServerError(response)).resolves.toBe('bad request');
  });
});

