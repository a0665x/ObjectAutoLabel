import {createContext, useContext, useMemo, type ReactNode} from 'react';
import type {Language} from './types';
import {workflowText} from './workflow/text';
import {uiMessages} from './uiMessages';

const UiLanguage = createContext<Language>('en');
export function UiLanguageProvider({language, children}: {language:Language; children:ReactNode}) {
  return <UiLanguage.Provider value={language}>{children}</UiLanguage.Provider>;
}
export function uiText(language:Language) {
  const fallback = workflowText(language);
  return (key:string, values:Record<string,string|number> = {}) => {
    const index = ({zh:0,ja:1,ko:2} as Partial<Record<Language,number>>)[language];
    const template = index == null ? key : uiMessages[key]?.[index] ?? fallback(key);
    return template.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  };
}
export function useUiText() {
  const language = useContext(UiLanguage);
  return useMemo(() => uiText(language), [language]);
}
