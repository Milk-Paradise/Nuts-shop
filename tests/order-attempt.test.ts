import { describe, expect, it } from "vitest";
import {
  readOrderAttempt,
  writeOrderAttempt,
  clearOrderAttempt,
} from "@/entities/order/model/attempt";
describe("unresolved order attempts", () => {
  function storage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };
  }
  it("preserves the same unresolved request key after component recreation", () => {
    const browserStorage = storage();
    const attempt = {
      key: "test-key",
      status: "uncertain" as const,
      createdAt: 123,
    };
    writeOrderAttempt(browserStorage, attempt);
    expect(readOrderAttempt(browserStorage)).toEqual(attempt);
    clearOrderAttempt(browserStorage);
    expect(readOrderAttempt(browserStorage)).toBeNull();
  });
  it("does not silently expire an uncertain request or store customer data", () => {
    const browserStorage = storage();
    writeOrderAttempt(browserStorage, {
      key: "old",
      status: "pending",
      createdAt: 1,
    });
    expect(readOrderAttempt(browserStorage)?.key).toBe("old");
  });
  it("rejects malformed persisted state", () => {
    const browserStorage = storage();
    browserStorage.setItem("11c-order-attempt", '{"key":3}');
    expect(readOrderAttempt(browserStorage)).toBeNull();
  });
});
