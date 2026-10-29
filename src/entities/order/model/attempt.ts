import { z } from "zod";
const attemptSchema = z.object({
  key: z.string(),
  status: z.enum(["pending", "uncertain"]),
  createdAt: z.number(),
});
export type OrderAttempt = z.infer<typeof attemptSchema>;
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const STORAGE_KEY = "11c-order-attempt";
// No customer/contact details are persisted. Unknown delivery must not expire automatically.
export function readOrderAttempt(
  storage: Pick<AttemptStorage, "getItem">,
): OrderAttempt | null {
  try {
    const parsed = attemptSchema.safeParse(
      JSON.parse(storage.getItem(STORAGE_KEY) || "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function writeOrderAttempt(
  storage: Pick<AttemptStorage, "setItem">,
  attempt: OrderAttempt,
) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(attempt));
    return true;
  } catch {
    return false;
  }
}
export function clearOrderAttempt(
  storage: AttemptStorage,
  expectedKey?: string,
) {
  try {
    if (expectedKey && readOrderAttempt(storage)?.key !== expectedKey) return;
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* Keep conservative UI status if storage is unavailable. */
  }
}
