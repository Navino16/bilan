import { createCipheriv, createDecipheriv, randomBytes, type KeyObject } from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

const b64 = (b: Buffer) => b.toString("base64url");
const fromB64 = (s: string) => Buffer.from(s, "base64url");

export function encrypt(plaintext: string, key: KeyObject | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(enc), b64(tag)].join(".");
}

export function decrypt(stored: string, key: KeyObject | Buffer): string {
  const [version, iv, enc, tag] = stored.split(".");
  if (version !== VERSION) throw new Error(`Unsupported encryption version: ${version}`);
  const decipher = createDecipheriv(ALGO, key, fromB64(iv));
  decipher.setAuthTag(fromB64(tag));
  return Buffer.concat([decipher.update(fromB64(enc)), decipher.final()]).toString("utf8");
}
