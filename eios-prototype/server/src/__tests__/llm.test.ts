import { describe, it, expect } from 'vitest'
import { redact, unredact, summarizeRedaction } from '../llm/redact.js'
import { CostLedger, BudgetExceededError, LlmProvider, estimateTokens } from '../llm/provider.js'
import { parseEmails, trimQuoted } from '../ingest/email.js'
import { triageStats } from '../ingest/triage.js'
import type { TriagedEmail } from '../ingest/triage.js'

// ===========================================================================
// PII REDACTION — nothing sensitive may leave this machine (DPDPA)
// ===========================================================================
describe('PII redaction', () => {
  it('redacts a bank account number', () => {
    const r = redact('Customer A/C 50100234567890 is impacted')
    expect(r.text).not.toContain('50100234567890')
    expect(r.text).toContain('[ACCOUNT_1]')
  })

  it('redacts a valid card number but leaves a random long digit string alone', () => {
    const card = redact('Card 4111111111111111 declined')
    expect(card.text).toContain('[CARD_1]')
    // Fails Luhn → not a card. Must not be mangled as one.
    const notCard = redact('Ref 4111111111111112 in ticket')
    expect(notCard.text).not.toContain('[CARD_1]')
  })

  it('redacts PAN, email and UPI VPA', () => {
    const r = redact('PAN ABCDE1234F, mail rakesh@bank.in, upi ramesh@okhdfcbank')
    expect(r.text).toContain('[PAN_1]')
    expect(r.text).toContain('[EMAIL_1]')
    expect(r.text).toContain('[UPI_1]')
  })

  it('REGRESSION: a +91 mobile is a PHONE, not an AADHAAR', () => {
    // Caught in live testing: "+919876543210" is 12 digits and was being
    // misclassified as an Aadhaar number.
    const r = redact('Call me on +919876543210')
    expect(r.text).toContain('[PHONE_1]')
    expect(r.text).not.toContain('AADHAAR')
  })

  it('still redacts a real Aadhaar', () => {
    const r = redact('Aadhaar 2234 5678 9012 on file')
    expect(r.text).toContain('[AADHAAR_1]')
  })

  it('is stable — the same value maps to the same placeholder', () => {
    const r = redact('A/C 50100234567890 ... again 50100234567890')
    expect(r.text.match(/\[ACCOUNT_1\]/g)).toHaveLength(2)
    expect(r.map.size).toBe(1)
  })

  it('is reversible for the authorized human', () => {
    const original = 'Card 4111111111111111 for rakesh@bank.in'
    const r = redact(original)
    expect(unredact(r.text, r.map)).toBe(original)
  })

  it('reports what it redacted rather than doing it silently', () => {
    const r = redact('A/C 50100234567890 and rakesh@bank.in')
    expect(summarizeRedaction(r.counts)).toMatch(/ACCOUNT/)
    expect(summarizeRedaction(r.counts)).toMatch(/EMAIL/)
  })

  it('says so plainly when there is no PII', () => {
    expect(summarizeRedaction(redact('UPI switch is degraded').counts)).toBe('No PII detected')
  })
})

// ===========================================================================
// COST CONTROL — $50 must never be a surprise
// ===========================================================================
describe('Cost ledger and budget guard', () => {
  const call = (costUsd: number) => ({
    at: new Date().toISOString(), model: 'gpt-4o-mini', purpose: 'email-triage',
    promptTokens: 500, completionTokens: 150, costUsd, latencyMs: 200,
  })

  it('tracks spend and remaining budget', () => {
    const l = new CostLedger(50)
    l.record(call(0.01)); l.record(call(0.02))
    expect(l.spent()).toBeCloseTo(0.03)
    expect(l.remaining()).toBeCloseTo(49.97)
  })

  it('HARD STOPS at the budget rather than overspending', () => {
    const l = new CostLedger(0.05)
    l.record(call(0.05))
    expect(() => l.assertWithinBudget()).toThrow(BudgetExceededError)
  })

  it('projects how many more calls the remaining credit buys', () => {
    const l = new CostLedger(50)
    l.record(call(0.0001))
    // The number that actually matters on a fixed allowance.
    expect(l.report().projectedCallsRemaining).toBeGreaterThan(100_000)
  })

  it('attributes spend by purpose so cost is never anonymous', () => {
    const l = new CostLedger(50)
    l.record(call(0.01))
    l.record({ ...call(0.5), purpose: 'one-prompt-reasoning' })
    const r = l.report()
    expect(r.byPurpose['email-triage'].calls).toBe(1)
    expect(r.byPurpose['one-prompt-reasoning'].costUsd).toBeCloseTo(0.5)
  })

  it('refuses to call at all when unconfigured — rather than failing obscurely', async () => {
    const p = new LlmProvider({ baseUrl: '', apiKey: '', pricing: {}, budgetUsd: 50 })
    expect(p.isConfigured()).toBe(false)
    await expect(p.complete({ model: 'x', purpose: 'test', messages: [] })).rejects.toThrow(/No LLM configured/)
  })

  it('estimates tokens when the gateway hides usage (a silent $0 is a lie)', () => {
    expect(estimateTokens('abcd'.repeat(100))).toBeGreaterThan(50)
  })
})

// ===========================================================================
// EMAIL INGESTION — no admin consent required
// ===========================================================================
describe('Email parsing', () => {
  it('parses a JSON export', () => {
    const out = parseEmails(JSON.stringify([
      { from: 'a@b.in', subject: 'UPI down', body: 'switch failing', date: '2026-07-16T06:00:00Z' },
    ]), 'inbox.json')
    expect(out).toHaveLength(1)
    expect(out[0].subject).toBe('UPI down')
  })

  it('parses an .eml with headers and body', () => {
    const out = parseEmails(`From: noc@bank.in\nTo: dc@bank.in\nSubject: P1 incident\nDate: Thu, 16 Jul 2026 06:00:00 +0530\n\nUPI switch is down.`, 'a.eml')
    expect(out[0].from).toContain('noc@bank.in')
    expect(out[0].subject).toBe('P1 incident')
    expect(out[0].body).toContain('UPI switch is down')
  })

  it('parses an mbox with several messages', () => {
    const out = parseEmails(`From bob@x.in Thu Jul 16 06:00:00 2026\nFrom: bob@x.in\nSubject: One\n\nBody one.\nFrom alice@x.in Thu Jul 16 07:00:00 2026\nFrom: alice@x.in\nSubject: Two\n\nBody two.`, 'inbox.mbox')
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  it('parses an Outlook CSV with quoted commas', () => {
    const out = parseEmails(`Subject,From,Body\n"Renewal, urgent",vendor@x.com,"Please review, thanks"`, 'export.csv')
    expect(out[0].subject).toBe('Renewal, urgent')
  })

  it('strips HTML so we do not pay tokens for markup', () => {
    const out = parseEmails(JSON.stringify([{ from: 'a@b.in', subject: 'x', body: '<div><p>Hello</p><style>.a{}</style></div>' }]), 'i.json')
    expect(out[0].body).not.toContain('<div>')
    expect(out[0].body).toContain('Hello')
  })

  it('trims quoted reply chains — 95% of a thread is tokens already paid for', () => {
    const trimmed = trimQuoted('My reply.\n\n-----Original Message-----\nFrom: someone\nOld thread noise')
    expect(trimmed).toBe('My reply.')
  })

  it('throws a useful error rather than silently returning nothing', () => {
    expect(() => parseEmails('not an email at all', 'x.eml')).toThrow(/Could not parse/)
  })
})

// ===========================================================================
// THE VALUE QUESTION — did it actually save time?
// ===========================================================================
describe('Triage stats', () => {
  const t = (needsExecutive: boolean, priority: string): TriagedEmail => ({
    email: { id: 'x', from: 'a', to: 'b', subject: 's', date: '2026-07-16', body: '' },
    verdict: {
      priority: priority as never, summary: '', suggestedAction: '', office: 'operations',
      needsExecutive, confidence: 0.9, reasoning: '',
    },
    redaction: '', costUsd: 0.0002, model: 'gpt-4o-mini',
  })

  it('reports the reduction the executive actually feels', () => {
    const s = triageStats([t(true, 'urgent'), t(false, 'routine'), t(false, 'informational'), t(false, 'informational')])!
    expect(s.total).toBe(4)
    expect(s.needsExecutive).toBe(1)
    expect(s.reductionPct).toBe(75)
    expect(s.minutesSaved).toBe(6) // 3 filtered × 2 min
  })

  it('surfaces low-confidence verdicts for review', () => {
    const low = t(true, 'routine'); low.verdict.confidence = 0.3
    expect(triageStats([low, t(false, 'routine'), t(false, 'routine')])!.lowConfidence).toBe(1)
  })

  it('returns null on an empty run rather than dividing by zero', () => {
    expect(triageStats([])).toBeNull()
  })
})
