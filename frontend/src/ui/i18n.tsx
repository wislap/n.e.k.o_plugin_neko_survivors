import { createContext, useContext, type ReactNode } from 'react';
import { createTranslator, defaultLocale, t, type Translate, type UiLocale } from '../i18n';

const TranslationContext = createContext<Translate | null>(null);
export function I18nProvider({ locale, children }: { locale?: UiLocale; children: ReactNode }) {
  return <TranslationContext.Provider value={createTranslator(locale ?? defaultLocale())}>{children}</TranslationContext.Provider>;
}
export function useT(): Translate { return useContext(TranslationContext) ?? t; }
