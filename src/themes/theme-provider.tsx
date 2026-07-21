import { useEffect, type PropsWithChildren } from "react";
import { applyTheme, getThemeSnapshot } from "./theme-store";

export function ThemeProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (getThemeSnapshot().mode === "system") applyTheme();
    };

    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return children;
}
