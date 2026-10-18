# AITab rename (v0.3.0)

The product is AITab; package names are `aitab-workspace` and `aitab`. GitHub remains `eiler2005/ai-tab-optimizer`, so existing repository links keep working.

The local checkout is `/Users/DenisErmilov/aiprojects/aitab`. A compatibility symlink at `firstai_agentproj` keeps existing editor and unpacked-extension paths available. Keep that symlink until the extension's data has been exported and its new loading path tested. No browser profile files or installed extension IDs are edited by the rename.

SQLite is still `tab_analysis.db`. Chrome storage keys, the `tab-optimizer` IndexedDB database and the `TabOptimizer` Obsidian directory remain unchanged. Changing a product label does not move user data. Old extension IDs without an existing public key cannot simply be recreated by generating a new manifest key: export/import is required for any ID change. The new collection/backup screen provides a portable migration path.

Before moving this checkout, SQLite was backed up with SQLite's online backup API and the installed Python packages were recorded under `~/.local/share/aitab/backups/`. The previous environment remains at ignored `.venv-before-aitab`; `.venv` is recreated at the new location. The extension dependencies are reinstalled from the frozen pnpm lockfile so generated commands use the new absolute path.

For another checkout, create a fresh `.venv`, install `requirements.txt`, run `pnpm --dir extension install --frozen-lockfile`, then run the build and both test suites. Change IDE shortcuts and launch scripts to the new checkout. Do not blindly rename storage databases or overwrite an existing Obsidian directory.
