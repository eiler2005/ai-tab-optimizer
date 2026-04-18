import type { UserSettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types/messages';
import { fetchServerJson } from './transport';

export async function getLocalSettingsMirror(): Promise<UserSettings> {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings ?? {}) } as UserSettings;
}

export async function saveLocalSettingsMirror(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export async function getSettings(): Promise<UserSettings> {
  const local = await getLocalSettingsMirror();
  try {
    const data = await fetchServerJson<{ settings: UserSettings }>('/settings', {}, local.localServerUrl);
    const merged = { ...DEFAULT_SETTINGS, ...data.settings } as UserSettings;
    await saveLocalSettingsMirror(merged);
    return merged;
  } catch {
    return local;
  }
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getLocalSettingsMirror();
  const updated = { ...current, ...partial } as UserSettings;
  await saveLocalSettingsMirror(updated);

  try {
    const data = await fetchServerJson<{ settings: UserSettings }>('/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: updated }),
    }, updated.localServerUrl);
    const merged = { ...DEFAULT_SETTINGS, ...data.settings } as UserSettings;
    await saveLocalSettingsMirror(merged);
    return merged;
  } catch {
    await chrome.storage.local.set({ settings: updated });
    return updated;
  }
}
