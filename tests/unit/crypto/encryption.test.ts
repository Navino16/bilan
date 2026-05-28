import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/server/crypto/encryption";

const key = Buffer.alloc(32, 7);

describe("encryption", () => {
  it("round-trips a string", () => {
    const enc = encrypt("CB AMAZON EU 42,99", key);
    expect(enc).toMatch(/^v1\./);
    expect(decrypt(enc, key)).toBe("CB AMAZON EU 42,99");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encrypt("secret", key);
    expect(() => decrypt(enc, Buffer.alloc(32, 9))).toThrow();
  });
});
