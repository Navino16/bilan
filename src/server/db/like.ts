// Prisma's contains/startsWith/endsWith pass the value into LIKE unescaped on MariaDB,
// whose default escape character is the backslash.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
