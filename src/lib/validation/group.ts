// Client-safe group role constants/types — kept out of `server/services/groups`
// (which imports the DB) so client components can use them without pulling
// server-only modules into the browser bundle.
export const GROUP_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

// Roles that can be handed out via an invitation. OWNER is intentionally excluded
// (you become OWNER only through a promotion by an existing OWNER) so an ADMIN
// can't mint an account that outranks them.
export const INVITABLE_GROUP_ROLES = ["ADMIN", "MEMBER"] as const;
export type InvitableGroupRole = (typeof INVITABLE_GROUP_ROLES)[number];
