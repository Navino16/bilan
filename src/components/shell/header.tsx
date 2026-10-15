import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "./mobile-nav";
import type { Theme } from "@/lib/theme";
import type { ShellUser } from "./user-identity";
import { UserMenu } from "./user-menu";

export function Header({
  user,
  canAdmin,
  appName,
  year,
  theme,
}: {
  user: ShellUser;
  canAdmin: boolean;
  appName: string;
  year: number;
  theme: Theme;
}) {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur md:px-8">
      <MobileNav user={user} canAdmin={canAdmin} appName={appName} year={year} theme={theme} />
      <span className="font-display truncate text-lg lg:hidden" title={appName}>
        {appName}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden lg:block">
          <LanguageSwitcher syncPreference />
        </div>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
