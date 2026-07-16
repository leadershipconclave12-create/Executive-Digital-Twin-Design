import type { User } from '../domain/types.js'

// Identity — SINGLE USER.
//
// EIOS serves exactly one person: the Deputy Chief (Products). There are no other roles,
// no permission matrix, no "acting as".
//
// WHY THE RBAC LAYER IS GONE, NOT DISABLED:
// With one user, route-level permission checks always return true. A permission system
// that can never deny is theatre — it makes the architecture look sophisticated while
// enforcing nothing. Deleting it is more honest than keeping a stub.
//
// The governance that ACTUALLY matters here did not go away. It got sharper. The
// meaningful boundary was never human-vs-human; it is:
//
//   1. EIOS vs the executive     — the ₹10L autonomous hard-limit, autonomy tiers,
//                                  confidence thresholds  (governance/guardrails.ts)
//   2. This machine vs the model — what may be sent to an LLM  (memory/fabric.ts
//                                  LLM_ACCESS, llm/redact.ts)
//   3. Now vs later              — the immutable audit journal  (governance/audit.ts)
//
// Those three are the real constraints on an executive AI. They are all still enforced.
//
// The `delegate` on a Delegation (e.g. "VP – IT Operations") is a PERSON WHO RECEIVES
// WORK, not a user of EIOS. They never log in. That is why they are plain strings and
// not identities.

/** The one and only user of this system. */
export const DEPUTY_CHIEF: User = {
  id: 'u-dc',
  name: 'Deputy Chief',
  role: 'deputy_chief',
  title: 'Deputy Chief (Products)',
  /**
   * The executive's own approval ceiling (Vol 2 §4.2 authority matrix). Above this, a
   * decision goes to the Board — so this is a real constraint even with one user, and
   * it is distinct from the much lower limit on what EIOS may do *autonomously*.
   */
  financialAuthorityInr: 50_000_000,
}

/** Single-element directory. Kept as a list so the auth seam has a shape to grow into. */
export const USERS: User[] = [DEPUTY_CHIEF]

export function findUser(id: string): User | undefined {
  return id === DEPUTY_CHIEF.id ? DEPUTY_CHIEF : undefined
}

/** The authenticated principal. Exists so the audit trail always has a real actor. */
export function currentUser(): User {
  return DEPUTY_CHIEF
}
