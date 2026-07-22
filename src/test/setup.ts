import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { setLocale } from "@/core/i18n/locale-store";

afterEach(() => {
  setLocale("zh-CN");
  localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.theme;
  document.documentElement.lang = "zh-CN";
});
