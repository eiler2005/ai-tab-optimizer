import { readFile, cp, rename, rm, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = dirname(extension);
let config;
try { config = JSON.parse(await readFile(resolve(project, '.aitab-legacy-loader.json'), 'utf8')); }
catch (error) { if (error.code === 'ENOENT') process.exit(0); throw error; }
const destination = resolve(config.path);
const compatibilityRoot = resolve(destination, '../..');
if (destination !== resolve(compatibilityRoot, 'extension/dist')
  || dirname(compatibilityRoot) !== dirname(project) || compatibilityRoot === project
  || (await readFile(resolve(compatibilityRoot, '.aitab-compatibility-loader'), 'utf8')).trim() !== project) {
  throw new Error('Refusing to write an unrecognized compatibility loader');
}
const staging = resolve(dirname(destination), '.dist-aitab-staging-' + randomUUID());
const previous = resolve(dirname(destination), '.dist-aitab-previous');
await mkdir(dirname(destination), { recursive: true });
await cp(resolve(extension, 'dist'), staging, { recursive: true });
await rm(previous, { recursive: true, force: true });
try { await rename(destination, previous); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await rename(staging, destination); }
catch (error) {
  try { await rename(previous, destination); } catch { /* Keep previous/staging for manual recovery. */ }
  throw error;
}
console.log('Updated the compatibility loader for the existing Chrome installation.');
