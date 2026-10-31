import simplified from '../../../i18n/zh-CN.json';
import chinese from '../../../i18n/zh.json';
import english from '../../../i18n/en.json';

export type UiLocale = 'zh-CN' | 'zh' | 'en';
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>, fallback?: string) => string;
const messages: Record<UiLocale, Readonly<Record<string, string>>> = { 'zh-CN': simplified, zh: chinese, en: english };

export function resolveLocale(languages: readonly string[]): UiLocale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith('en')) return 'en';
    if (normalized.startsWith('zh')) return normalized === 'zh-cn' || normalized === 'zh-hans' ? 'zh-CN' : 'zh';
  }
  return 'zh-CN';
}
export function createTranslator(locale: UiLocale): Translate {
  return (key, values = {}, fallback) => {
    const message = messages[locale][key] ?? messages['zh-CN'][key] ?? fallback ?? key;
    return message.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name: string) => String(values[name] ?? token));
  };
}
export const defaultLocale = () => resolveLocale(typeof navigator === 'undefined' ? [] : navigator.languages);
export const t: Translate = (key, values, fallback) => createTranslator(defaultLocale())(key, values, fallback);
