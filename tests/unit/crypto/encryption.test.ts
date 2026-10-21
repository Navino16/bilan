import { createSecretKey } from "node:crypto";
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

  // Written by the Buffer-key implementation: stored data must stay readable with KeyObjects (#295).
  it("reads a stored value with a KeyObject built from the same bytes", () => {
    const stored = "v1.AQEBAQEBAQEBAQEB.NaOp9t3-tkGf9Jl0UANCHZHC.2l6RfqFaC0CQUQnUWlo05Q";
    expect(decrypt(stored, createSecretKey(key))).toBe("CB AMAZON EU 42,99");
    expect(decrypt(encrypt("secret", createSecretKey(key)), key)).toBe("secret");
  });
});
