import { headers as nextHeaders } from "next/headers";
import { withClientIp } from "./client-ip";

/** Request headers for auth.api.* calls, with the client IP resolved even if proxy.ts was skipped. */
export async function authHeaders(): Promise<Headers> {
  return withClientIp(await nextHeaders());
}
