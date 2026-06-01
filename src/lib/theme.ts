// Theme preference lives in a cookie (not localStorage) so the server can read
// it in the locale layout and render the correct `.dark` class in the initial
// HTML. That means no pre-paint bootstrap script is needed — which avoids both a
// theme flash and React 19's "script tag while rendering" warning for inline
// scripts. Values: "dark" | "light" (absent → light).
export const THEME_COOKIE = "bilan-theme";
export type Theme = "dark" | "light";
