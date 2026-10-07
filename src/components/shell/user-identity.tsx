import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export type ShellUser = { name?: string | null; email: string };

export function userDisplay(user: ShellUser) {
  const display = user.name?.trim() || user.email;
  return { display, initials: display.slice(0, 2).toUpperCase() };
}

export function UserIdentity({ user }: { user: ShellUser }) {
  const { display, initials } = userDisplay(user);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-9 w-9">
        <AvatarFallback className="bg-accent text-accent-foreground text-xs font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{display}</p>
        <p className="text-muted-foreground truncate text-xs">{user.email}</p>
      </div>
    </div>
  );
}
