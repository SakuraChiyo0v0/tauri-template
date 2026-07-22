import { useCallback } from "react";
import { setLocale, useLocale } from "./locale-store";
import { translate, type MessageKey, type MessageParams } from "./messages";

export function useI18n() {
  const locale = useLocale();
  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
  return { locale, setLocale, t };
}
