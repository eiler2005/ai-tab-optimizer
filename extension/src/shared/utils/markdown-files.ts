let writeQueue: Promise<unknown> = Promise.resolve();

export function writeMarkdownVersion(directory: FileSystemDirectoryHandle, base: string, content: string): Promise<string> {
  const write = async () => {
    let filename = base + '.md';
    try {
      await directory.getFileHandle(filename);
      filename = base + '-' + crypto.randomUUID() + '.md';
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
    }
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
