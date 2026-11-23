export const NAME_MAX = 100;

export function displayName(user: { name?: string | null; email: string }): string {
  return user.name?.trim() || user.email;
}
