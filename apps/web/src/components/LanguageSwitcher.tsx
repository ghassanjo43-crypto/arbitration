import { useTranslation } from 'react-i18next';
import { applyDocumentLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';

const LABELS: Record<SupportedLanguage, string> = { en: 'EN', ar: 'العربية' };

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language as SupportedLanguage;

  const switchTo = (lang: SupportedLanguage) => {
    void i18n.changeLanguage(lang);
    applyDocumentLanguage(lang);
  };

  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className="lang-switch__btn"
          aria-pressed={current === lang}
          onClick={() => switchTo(lang)}
        >
          {LABELS[lang]}
        </button>
      ))}
    </div>
  );
}
