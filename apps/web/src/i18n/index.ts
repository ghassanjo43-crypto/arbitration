import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ar from './ar.json';

export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const RTL_LANGUAGES: SupportedLanguage[] = ['ar'];

const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('gaap_lang')) as SupportedLanguage | null;
const initialLang: SupportedLanguage = stored && SUPPORTED_LANGUAGES.includes(stored) ? stored : 'en';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function applyDocumentLanguage(lang: SupportedLanguage): void {
  const dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  localStorage.setItem('gaap_lang', lang);
}

applyDocumentLanguage(initialLang);

export default i18n;
