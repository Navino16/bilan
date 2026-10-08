// A cookie (not localStorage) so the server renders the theme class with no flash.
// No cookie means "system": no class, and globals.css follows prefers-color-scheme.
export const THEME_COOKIE = "bilan-theme";
export type Theme = "dark" | "light" | "system";

export const THEME_COLOR = { light: "#f7f4ed", dark: "#0f1114" } as const;

export function readTheme(cookie: string | undefined): Theme {
  return cookie === "dark" || cookie === "light" ? cookie : "system";
}
