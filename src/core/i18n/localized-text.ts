import type { SupportedLocale } from "./locale-store";

export type LocalizedText = Record<SupportedLocale, string>;

const localeKeys: SupportedLocale[] = ["zh-CN", "en"];

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === localeKeys.length && localeKeys.every(
    (locale) => typeof record[locale] === "string" && record[locale].trim().length > 0,
  );
}

export function resolveLocalizedText(value: LocalizedText, locale: SupportedLocale) {
  return value[locale];
}
