export const INSTANCE_ROLES = ["USER", "ADMIN", "SUPER_ADMIN"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export function isInstanceRole(value: string): value is InstanceRole {
  return (INSTANCE_ROLES as readonly string[]).includes(value);
}

// A user can hold several role rows; the most privileged one wins, none means USER.
export function topRole(keys: string[]): InstanceRole {
  if (keys.includes("SUPER_ADMIN")) return "SUPER_ADMIN";
  if (keys.includes("ADMIN")) return "ADMIN";
  return "USER";
}

export function mayHandleRole(actorIsActiveSuperAdmin: boolean, role: InstanceRole): boolean {
  return role === "USER" || actorIsActiveSuperAdmin;
}

export const CREATABLE_ROLES = ["USER", "ADMIN"] as const satisfies readonly InstanceRole[];
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

export function creatableRoles(actorIsActiveSuperAdmin: boolean): CreatableRole[] {
  return CREATABLE_ROLES.filter((r) => mayHandleRole(actorIsActiveSuperAdmin, r));
}
