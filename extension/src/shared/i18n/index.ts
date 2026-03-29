import { create } from 'zustand';
import { translations, type Locale, type TranslationKey } from './translations';

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

function detectLocale(): Locale {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('ru')) return 'ru';
  return 'en';
}

export const useI18n = create<I18nState>((set, get) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    set({ locale });
    chrome.storage.local.set({ locale });
  },
  t: (key) => {
    const entry = translations[key];
    if (!entry) return key;
    return entry[get().locale] ?? entry.en;
  },
}));

// Load saved locale on startup
chrome.storage.local.get('locale').then((result) => {
  if (result.locale && (result.locale === 'en' || result.locale === 'ru')) {
    useI18n.getState().setLocale(result.locale);
  }
});

export type { Locale, TranslationKey };
