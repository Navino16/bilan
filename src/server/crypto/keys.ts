import { env } from "@/env";

export const dataKey = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
export const searchKey = Buffer.from(env.SEARCH_TOKEN_KEY, "base64");
