// PII redaction — runs on EVERY payload before it leaves this machine.
//
// WHY THIS EXISTS: you work at a bank. "I exported customer data to an AI tool" is a
// DPDPA incident regardless of how good the tool is. EIOS must be usable without ever
// putting you in that sentence.
//
// Design: pattern-based, deterministic, and REVERSIBLE via a local-only map — so the
// model reasons over [ACCOUNT_1] and the UI shows you the real value. The mapping never
// leaves the process.
//
// HONEST LIMIT: regex redaction catches structured identifiers (accounts, PAN, cards,
// UPI IDs, phones, emails). It will NOT catch a customer's name written in prose
// ("Ramesh from Andheri branch called"). Treat it as a strong safety net, not a
// guarantee. Do not feed EIOS anything you would not paste into your internal AI tool
// by hand — because that is exactly what it is doing on your behalf.

export type PiiKind =
  | 'ACCOUNT' | 'PAN' | 'CARD' | 'UPI' | 'PHONE' | 'EMAIL' | 'AADHAAR' | 'IFSC' | 'AMOUNT'

export interface RedactionResult {
  text: string
  /** placeholder → original. LOCAL ONLY. Never serialized to the model or disk. */
  map: Map<string, string>
  counts: Record<string, number>
}

interface Rule {
  kind: PiiKind
  re: RegExp
  /** Guard against false positives that would mangle legitimate text. */
  keep?: (m: string) => boolean
}

// Order matters: most specific first, so a card number is not eaten by the account rule.
const RULES: Rule[] = [
  // Indian PAN: 5 letters, 4 digits, 1 letter
  { kind: 'PAN', re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  // Country-coded mobile MUST come before Aadhaar: "+919876543210" is 12 digits and
  // would otherwise be misread as an Aadhaar number. (Caught in live testing.)
  { kind: 'PHONE', re: /\+91[\s-]?[6-9]\d{9}\b/g },
  // Aadhaar: 12 digits, often spaced in groups of 4. Never starts 0 or 1.
  { kind: 'AADHAAR', re: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g },
  // Card: 13-19 digits, optionally separated
  { kind: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g, keep: (m) => luhn(m.replace(/[^\d]/g, '')) },
  // IFSC: 4 letters + 0 + 6 alnum
  { kind: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  // UPI VPA: name@bank
  { kind: 'UPI', re: /\b[\w.\-]{2,}@(?:okhdfcbank|okaxis|oksbi|okicici|ybl|paytm|upi|apl|axl)\b/gi },
  { kind: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g },
  // Indian mobile: optional +91, 10 digits starting 6-9
  { kind: 'PHONE', re: /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g },
  // Bank account: 9-18 digits (after card/aadhaar have had their turn)
  { kind: 'ACCOUNT', re: /\b\d{9,18}\b/g },
]

/** Luhn check so we only redact things that are actually card numbers. */
function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export function redact(input: string): RedactionResult {
  const map = new Map<string, string>()
  const seen = new Map<string, string>() // original → placeholder (stable within a doc)
  const counts: Record<string, number> = {}
  let text = input

  for (const rule of RULES) {
    text = text.replace(rule.re, (match) => {
      if (rule.keep && !rule.keep(match)) return match
      const existing = seen.get(match)
      if (existing) return existing
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1
      const placeholder = `[${rule.kind}_${counts[rule.kind]}]`
      seen.set(match, placeholder)
      map.set(placeholder, match)
      return placeholder
    })
  }
  return { text, map, counts }
}

/** Put the real values back for display to the authorized human. */
export function unredact(text: string, map: Map<string, string>): string {
  let out = text
  for (const [placeholder, original] of map) out = out.split(placeholder).join(original)
  return out
}

/** True if anything sensitive was found — useful for warning the user. */
export function hasPii(counts: Record<string, number>): boolean {
  return Object.values(counts).some((n) => n > 0)
}

export function summarizeRedaction(counts: Record<string, number>): string {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n}× ${k}`)
  return parts.length ? `Redacted before sending: ${parts.join(', ')}` : 'No PII detected'
}
