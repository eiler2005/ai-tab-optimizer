import { expect, it, vi } from 'vitest';
import { writeMarkdownVersion } from '../markdown-files';

it('preserves existing user notes and serializes concurrent exports', async () => {
  const files = new Map<string, string>([['note.md', 'user notes']]);
  const directory = { getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
    if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
    return { createWritable: async () => ({ write: async (content: string) => { files.set(name, content); }, close: async () => {} }) };
  }) } as unknown as FileSystemDirectoryHandle;
  const names = await Promise.all([writeMarkdownVersion(directory, 'note', 'export one'), writeMarkdownVersion(directory, 'note', 'export two')]);
  expect(files.get('note.md')).toBe('user notes');
  expect(new Set(names).size).toBe(2);
  expect(files.size).toBe(3);
});
