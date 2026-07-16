// Email ingestion WITHOUT admin consent.
//
// The Graph API path needs an Entra ID app registration and tenant-wide admin consent to
// read a mailbox. In a bank that is a project, not an afternoon.
//
// This path needs none of it: you export your own mail — which you already have every
// right to read — and hand EIOS the file. Nothing new is granted to anyone. It is exactly
// what you do manually every morning, automated.
//
// Supported: .eml (single) · .mbox (many) · .json (array) · .csv (Outlook export)
//
// When Graph access IS eventually approved, it becomes another Connector emitting the
// same ParsedEmail — nothing downstream changes. That is the seam working.

export interface ParsedEmail {
  id: string
  from: string
  to: string
  subject: string
  date: string
  body: string
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Decode RFC 2047 encoded-words (=?utf-8?B?...?=) that Outlook loves. */
function decodeHeader(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _charset, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8')
      return data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x: string, h: string) =>
        String.fromCharCode(parseInt(h, 16)))
    } catch { return data }
  })
}

/** Strip HTML to text — most corporate mail is HTML and the tags are pure token waste. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/**
 * Trim quoted history and signatures. A 40-message reply chain is 95% tokens you already
 * paid for — on a fixed credit budget this matters more than it looks.
 */
export function trimQuoted(body: string): string {
  const markers = [
    /^\s*-{2,}\s*Original Message\s*-{2,}/im,
    /^\s*From:.*\n\s*Sent:/im,
    /^\s*On .* wrote:\s*$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*--\s*$/m, // signature delimiter
  ]
  let cut = body.length
  for (const re of markers) {
    const m = body.match(re)
    if (m?.index !== undefined && m.index < cut) cut = m.index
  }
  return body.slice(0, cut).trim() || body.trim()
}

function parseSingle(raw: string, idx: number): ParsedEmail | null {
  const split = raw.indexOf('\n\n') >= 0 ? raw.indexOf('\n\n') : raw.indexOf('\r\n\r\n')
  const headerBlock = split > 0 ? raw.slice(0, split) : raw
  let body = split > 0 ? raw.slice(split) : ''

  // Unfold RFC 5322 continuation lines before parsing headers.
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ')
  const get = (name: string): string => {
    const m = unfolded.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))
    return m ? decodeHeader(clean(m[1])) : ''
  }

  const subject = get('Subject')
  const from = get('From')
  if (!subject && !from) return null

  if (/content-transfer-encoding:\s*base64/i.test(unfolded)) {
    try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch { /* keep raw */ }
  }
  if (/content-type:\s*text\/html/i.test(unfolded) || /<html|<body|<div/i.test(body)) {
    body = htmlToText(body)
  }

  return {
    id: get('Message-ID') || `MAIL-${idx + 1}`,
    from, to: get('To'),
    subject: subject || '(no subject)',
    date: get('Date') || new Date().toISOString(),
    body: trimQuoted(clean(body)).slice(0, 4000), // cap: tokens are money
  }
}

export function parseEml(raw: string): ParsedEmail[] {
  const one = parseSingle(raw, 0)
  return one ? [one] : []
}

export function parseMbox(raw: string): ParsedEmail[] {
  return raw
    .split(/^From \S+.*$/m)
    .map((chunk, i) => (chunk.trim() ? parseSingle(chunk, i) : null))
    .filter((e): e is ParsedEmail => Boolean(e))
}

export function parseJson(raw: string): ParsedEmail[] {
  const data = JSON.parse(raw) as Record<string, unknown>[]
  const pick = (o: Record<string, unknown>, keys: string[]): string => {
    for (const k of Object.keys(o)) {
      if (keys.includes(k.toLowerCase())) return String(o[k] ?? '')
    }
    return ''
  }
  return (Array.isArray(data) ? data : [data]).map((o, i) => ({
    id: pick(o, ['id', 'messageid', 'message-id']) || `MAIL-${i + 1}`,
    from: pick(o, ['from', 'sender', 'fromaddress']),
    to: pick(o, ['to', 'recipient', 'toaddress']),
    subject: pick(o, ['subject', 'title']) || '(no subject)',
    date: pick(o, ['date', 'received', 'receiveddatetime', 'senton']) || new Date().toISOString(),
    body: trimQuoted(clean(htmlToText(pick(o, ['body', 'bodypreview', 'content', 'text'])))).slice(0, 4000),
  }))
}

/** Minimal CSV reader that survives quoted fields with commas/newlines (Outlook export). */
export function parseCsv(raw: string): ParsedEmail[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quoted) {
      if (c === '"' && raw[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  if (rows.length < 2) return []

  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const col = (r: string[], names: string[]): string => {
    for (const n of names) {
      const i = headers.indexOf(n)
      if (i >= 0 && r[i]) return r[i]
    }
    return ''
  }
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r, i) => ({
    id: `MAIL-${i + 1}`,
    from: col(r, ['from', 'from: (name)', 'from: (address)', 'sender']),
    to: col(r, ['to', 'to: (name)', 'to: (address)']),
    subject: col(r, ['subject', 'title']) || '(no subject)',
    date: col(r, ['date', 'received', 'sent', 'date received']) || new Date().toISOString(),
    body: trimQuoted(clean(htmlToText(col(r, ['body', 'content', 'message'])))).slice(0, 4000),
  }))
}

/** Detect the format and parse. Throws with a useful message rather than returning []. */
export function parseEmails(raw: string, filename = ''): ParsedEmail[] {
  const name = filename.toLowerCase()
  const trimmed = raw.trimStart()

  let out: ParsedEmail[]
  if (name.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) out = parseJson(raw)
  else if (name.endsWith('.csv') || (!name && /^[^\n]*subject[^\n]*,/i.test(trimmed))) out = parseCsv(raw)
  else if (name.endsWith('.mbox') || /^From \S+ /m.test(raw)) out = parseMbox(raw)
  else out = parseEml(raw)

  if (!out.length) {
    throw new Error(
      `Could not parse any email from ${filename || 'input'}. Supported: .eml, .mbox, .json (array of {from,subject,body,date}), .csv (Outlook export).`,
    )
  }
  return out
}
