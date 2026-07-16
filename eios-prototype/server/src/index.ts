import { createApp } from './app.js'
import { config } from './config.js'
import { aiProvider } from './cognitive/aiProvider.js'
import { pulse } from './twin/pulse.js'
import { perception } from './perception/index.js'
import { eventStore, verifyDeterminism } from './platform/index.js'

const app = createApp()

// PHASE 2: rebuild the organization from its recorded history before serving traffic.
// The twin is a materialized view of the log — not state that happens to survive.
const rebuilt = perception.rebuildFromLog()
const determinism = verifyDeterminism(eventStore)

app.listen(config.port, () => {
  // Start the organizational heartbeat — EIOS runs continuously, not on request.
  pulse.start(4000)
  // Snapshot periodically so boot does not have to fold the entire log forever.
  setInterval(() => perception.snapshot(), 60_000).unref()

  const log = eventStore.stats()
  // eslint-disable-next-line no-console
  console.log(
    `EIOS operating system listening on http://localhost:${config.port}\n` +
    `  AI provider     : ${aiProvider.name}\n` +
    `  Autonomous limit: ₹${config.autonomousFinancialLimitInr.toLocaleString('en-IN')} (ADR-003)\n` +
    `  Event log       : ${log.durable ? log.path : 'EPHEMERAL (EIOS_EVENT_LOG=off)'} — ${log.events} events, digest ${log.digest}\n` +
    `  Twin rebuilt    : ${rebuilt.events} events replayed, state ${rebuilt.hash}\n` +
    `  Determinism     : ${determinism.deterministic ? 'VERIFIED' : '*** FAILED ***'}\n` +
    `  Pulse           : beating every 4s (GET /api/pulse, stream at /api/pulse/stream)\n` +
    `  Try: GET /api/platform/scorecard`,
  )
})
