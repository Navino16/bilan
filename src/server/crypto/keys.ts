import { createSecretKey } from "node:crypto";
import { env } from "@/env";

// KeyObjects, built once: a raw Buffer key is re-imported by Node on every cipher and HMAC (#295).
export const dataKey = createSecretKey(Buffer.from(env.DATA_ENCRYPTION_KEY, "base64"));
export const searchKey = createSecretKey(Buffer.from(env.SEARCH_TOKEN_KEY, "base64"));
