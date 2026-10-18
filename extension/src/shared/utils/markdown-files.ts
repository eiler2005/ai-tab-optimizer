let writeQueue: Promise<unknown> = Promise.resolve();

export function writeMarkdownVersion(directory: FileSystemDirectoryHandle, base: string, content: string): Promise<string> {
  const write = async () => {
    const filename = base + '-' + crypto.randomUUID() + '.md';
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return filename;
  };
  const result = writeQueue.then(write, write);
  writeQueue = result.catch(() => {});
  return result;
}
