import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Its router writes the locale cookie on a soft-navigation locale switch, which the
// middleware no longer does for the router's background requests (next-intl 4.14).
export const { usePathname, useRouter } = createNavigation(routing);
