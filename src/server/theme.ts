import { cookies } from "next/headers";
import { readTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

export async function currentTheme(): Promise<Theme> {
  return readTheme((await cookies()).get(THEME_COOKIE)?.value);
}
