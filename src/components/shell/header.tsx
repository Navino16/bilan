import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

type HeaderUser = { name?: string | null; email: string };

export function Header({
  user,
  canAdmin,
  appName,
}: {
  user: HeaderUser;
  canAdmin: boolean;
  appName: string;
}) {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 backdrop-blur md:px-8">
      <MobileNav canAdmin={canAdmin} appName={appName} />
      <span className="font-display truncate text-lg md:hidden">{appName}</span>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:block">
          <LanguageSwitcher />
        </div>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
