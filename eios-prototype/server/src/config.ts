// Central configuration. In production these come from Azure App Configuration /
// Key Vault (Vol 4). The AI provider seam lets a real Azure OpenAI endpoint drop
// in without touching business logic.
export const config = {
  port: Number(process.env.PORT ?? 4180),
  /** ADR-003 (Vol 2 §4.2): autonomous financial hard-limit, in INR. */
  autonomousFinancialLimitInr: Number(process.env.EIOS_AUTONOMOUS_LIMIT_INR ?? 1_000_000),
  /** Minimum model confidence for a decision to be eligible for auto-execution. */
  autonomousConfidenceThreshold: Number(process.env.EIOS_AUTO_CONFIDENCE ?? 0.85),
  ai: {
    // provider: 'mock' (default, self-contained) | 'azure-openai' (needs creds)
    provider: process.env.EIOS_AI_PROVIDER ?? 'mock',
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    azureApiKey: process.env.AZURE_OPENAI_API_KEY ?? '',
    azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
  },
  /**
   * The event log is the system of record (Phase 2). Durable by default — set
   * EIOS_EVENT_LOG=off for ephemeral runs. In production this seam is Kafka /
   * Azure Event Hubs; the append/read contract is identical.
   */
  eventLog: {
    path: process.env.EIOS_EVENT_LOG ?? './data/events.jsonl',
    snapshotPath: process.env.EIOS_SNAPSHOT ?? './data/snapshot.json',
  },
}
export type Config = typeof config
