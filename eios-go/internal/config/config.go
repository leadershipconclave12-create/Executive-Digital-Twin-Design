// Package config centralises runtime configuration and loads a .env file if
// present (Go stdlib only — no dependencies). This is the Go equivalent of the
// prototype's config.ts + the loadEnv fix.
package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                       int
	AutonomousFinancialLimitInr int64
	AutonomousConfidence        float64
	AccessToken                 string
	EventLogPath                string
	SnapshotPath                string

	LLMBaseURL       string
	LLMAPIKey        string
	LLMSmallModel    string
	LLMFrontierModel string
	LLMBudgetUSD     float64
}

// LoadDotEnv reads KEY=VALUE lines from the given path into the process
// environment (without overriding already-set vars). Missing file is not an error.
func LoadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		val = strings.Trim(val, `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, val)
		}
	}
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil {
			return n
		}
	}
	return def
}

func Load() Config {
	return Config{
		Port:                        int(envInt("PORT", 4180)),
		AutonomousFinancialLimitInr: envInt("EIOS_AUTONOMOUS_LIMIT_INR", 1_000_000),
		AutonomousConfidence:        envFloat("EIOS_AUTO_CONFIDENCE", 0.85),
		AccessToken:                 env("EIOS_ACCESS_TOKEN", ""),
		EventLogPath:                env("EIOS_EVENT_LOG", "./data/events.jsonl"),
		SnapshotPath:                env("EIOS_SNAPSHOT", "./data/snapshot.json"),
		LLMBaseURL:                  env("EIOS_LLM_BASE_URL", ""),
		LLMAPIKey:                   env("EIOS_LLM_API_KEY", ""),
		LLMSmallModel:               env("EIOS_LLM_SMALL_MODEL", "claude-haiku-4-5"),
		LLMFrontierModel:            env("EIOS_LLM_FRONTIER_MODEL", "claude-opus-4-8"),
		LLMBudgetUSD:                envFloat("EIOS_LLM_BUDGET_USD", 50),
	}
}
