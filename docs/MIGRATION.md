# AITab rename (v0.3.0)

The product is AITab; package names are `aitab-workspace` and `aitab`. GitHub remains `eiler2005/ai-tab-optimizer`, so existing repository links keep working.

The local checkout is `/Users/DenisErmilov/aiprojects/aitab`; open `aitab.code-workspace` there for development. The old `firstai_agentproj` path is now a minimal compatibility directory containing only the installed extension's real `extension/dist` loader. It is not a second source checkout.

This real loader directory matters: Chromium resolves symlinks before calculating an unpacked extension ID. A symlink to the new checkout produced a different ID from the existing installation. Keeping the original loader as a real directory preserves the original ID and its existing Chrome storage. This was verified in separate temporary Chromium profiles; the user's browser profile and stored values were not changed.

An ignored `.aitab-legacy-loader.json` config enables `extension/scripts/sync-legacy-loader.mjs` after a successful build. It refreshes only a sibling directory bearing this checkout's ownership marker, stages the new build and retains the previous build for rollback. Other checkouts have no config and skip this step. Reload the existing installed extension to activate the new version using the preserved loader path. Move to the new direct loader path only after exporting/importing a JSON backup and regranting the Obsidian folder permission.

SQLite is still `tab_analysis.db`. Chrome storage keys, the `tab-optimizer` IndexedDB database and the `TabOptimizer` Obsidian directory remain unchanged. Changing a product label does not move user data. Old extension IDs without an existing public key cannot simply be recreated by generating a new manifest key: export/import is required for any ID change. The new collection/backup screen provides a portable migration path.

Before moving this checkout, SQLite was backed up with SQLite's online backup API and the installed Python packages were recorded under `~/.local/share/aitab/backups/`. The previous environment remains at ignored `.venv-before-aitab`; `.venv` is recreated at the new location. The extension dependencies are reinstalled from the frozen pnpm lockfile so generated commands use the new absolute path.

For another checkout, create a fresh `.venv`, install `requirements.txt`, run `pnpm --dir extension install --frozen-lockfile`, then run the build and test suites. Change IDE shortcuts and launch scripts to the new checkout. Do not blindly rename storage databases or overwrite an existing Obsidian directory.
