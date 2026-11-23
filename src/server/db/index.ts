import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { env } from "@/env";
import { processState } from "@/server/process-state";

export const db = processState(
  "db",
  () => new PrismaClient({ adapter: new PrismaMariaDb(env.DATABASE_URL) }),
);
