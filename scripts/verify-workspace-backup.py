"""Read-only integrity verification before manually restoring a full AITab backup."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('folder', type=Path)
args = parser.parse_args()
folder = args.folder.expanduser().resolve()
try:
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 'aitab-full-backup' or manifest.get('version') != 1:
        raise ValueError('Unsupported backup manifest')
    for name in ('workspace.json', 'database.sqlite'):
        digest = hashlib.sha256()
        with (folder / name).open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != manifest.get('sha256', {}).get(name):
            raise ValueError('Checksum mismatch: ' + name)
    with sqlite3.connect((folder / 'database.sqlite').as_uri() + '?mode=ro', uri=True) as database:
        if database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
except (OSError, ValueError, sqlite3.Error) as error:
    parser.exit(1, f'Backup verification failed: {error}\n')
print(f'OK: checksums and SQLite integrity verified for {manifest["id"]}')
print('No data was restored or modified.')
