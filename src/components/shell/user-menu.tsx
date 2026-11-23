"use client";

import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "./use-sign-out";
import { userDisplay, type ShellUser } from "./user-identity";

export function UserMenu({ user }: { user: ShellUser }) {
  const t = useTranslations("shell.userMenu");
  const handleSignOut = useSignOut();
  const { display, initials } = userDisplay(user);

  return (
    <DropdownMenu>
      {/* Named by hidden text, not aria-label: the visible initials aren't part of the name (WCAG 2.5.3). */}
      <DropdownMenuTrigger className="ring-offset-background focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
        <span className="sr-only">{t("open")}</span>
        <Avatar aria-hidden className="h-9 w-9">
          <AvatarFallback className="bg-accent text-accent-foreground text-xs font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{display}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>{t("logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
