import { describe, it, expect } from "vitest";
import { escapeLike } from "@/server/db/like";

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character itself (#223)", () => {
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
    expect(escapeLike("plain@mail.test")).toBe("plain@mail.test");
  });
});
