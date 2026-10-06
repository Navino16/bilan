import { db } from "@/server/db";

export type PasskeyView = {
  id: string;
  name: string | null;
  createdAt: Date;
  // Backed up to a sync provider (iCloud Keychain, Google Password Manager…) vs bound to one device.
  synced: boolean;
};

export async function listPasskeys(userId: string): Promise<PasskeyView[]> {
  const rows = await db.passkey.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true, backedUp: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(({ backedUp, ...r }) => ({ ...r, synced: backedUp }));
}
