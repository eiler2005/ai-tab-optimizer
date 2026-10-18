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
    vi.unstubAllGlobals();
  });

  it('normalizes the server URL and preserves a trailing slash', () => {
    expect(normalizeServerUrl('http://localhost:8765').toString()).toBe('http://localhost:8765/');
    expect(normalizeServerUrl('http://localhost:8765/api').toString()).toBe('http://localhost:8765/api/');
  });

  it.each(['https://remote.example/', 'http://user:password@localhost:8765/', 'httpfake://localhost/'])('rejects unsafe server URL %s', (url) => {
    expect(() => normalizeServerUrl(url)).toThrow('Invalid AI server URL');
  });

  it('rejects endpoints that escape the configured origin', () => {
    expect(() => buildServerEndpointCandidates('http://localhost:8765', 'https://remote.example/')).toThrow('loopback origin');
  });

  it('adds the local token without replacing request headers', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ localServerToken: 'test-local-token' }) } } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await fetchLocalServer('http://localhost:8765', '/settings', { headers: { 'X-Test': 'kept' } });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('X-API-Key')).toBe('test-local-token');
    expect(headers.get('X-Test')).toBe('kept');
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

