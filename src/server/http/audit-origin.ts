import { CLIENT_IP_HEADER } from "./client-ip";
import { authHeaders } from "./auth-headers";

/** Client IP and user agent of the current request, for audit rows (same source as the auth hooks). */
export async function auditOrigin(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const headers = await authHeaders();
  return {
    ipAddress: headers.get(CLIENT_IP_HEADER),
    userAgent: headers.get("user-agent"),
  };
}
