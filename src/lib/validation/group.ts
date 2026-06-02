// Client-safe group role constants/types — kept out of `server/services/groups`
// (which imports the DB) so client components can use them without pulling
// server-only modules into the browser bundle.
export const GROUP_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
