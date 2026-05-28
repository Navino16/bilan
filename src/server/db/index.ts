import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { env } from "@/env";

const adapter = new PrismaMariaDb(env.DATABASE_URL);

const globalForDb = globalThis as unknown as { __db?: PrismaClient };

export const db = globalForDb.__db ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") globalForDb.__db = db;
