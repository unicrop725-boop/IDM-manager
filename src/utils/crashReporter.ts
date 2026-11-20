// src/utils/crashReporter.ts
// Opt-in anonymous crash reporter for FlowGet

export interface CrashReport {
  id: string;
  timestamp: number;
  appName: string;
  version: string;
  os: string;
  errorName: string;
  errorMessage: string;
  stackTrace: string;
  userOptIn: boolean;
}

const CRASH_LOG_KEY = "flowget_crash_reports";

/**
 * Anonymizes file paths, usernames, and sensitive auth strings from stack traces
 */
export function anonymizeStack(rawStack?: string): string {
  if (!rawStack) return "";

  let cleaned = rawStack;

  // 1. Redact Windows user home paths (C:\Users\<user>\...)
  cleaned = cleaned.replace(/([a-zA-Z]:\\Users\\)[^\\]+/gi, "$1[REDACTED_USER]");

  // 2. Redact Unix/Mac user home paths (/Users/<user>/... or /home/<user>/...)
  cleaned = cleaned.replace(/(\/(Users|home)\/)[^/]+/gi, "$1[REDACTED_USER]");

  // 3. Redact authorization headers and tokens
  cleaned = cleaned.replace(/(Bearer|Token|key=)\s*[a-zA-Z0-9_\-.]+/gi, "$1 [REDACTED_TOKEN]");

  // 4. Redact URLs with passwords (http://user:pass@host)
  cleaned = cleaned.replace(/:\/\/([^:@]+):([^@]+)@/g, "://[REDACTED_USER]:[REDACTED_PASS]@");

  return cleaned;
}

/**
 * Record an anonymized crash report
 */
export function recordCrashReport(
  error: Error | string,
  optIn: boolean = false
): CrashReport {
  const err = typeof error === "string" ? new Error(error) : error;

  const report: CrashReport = {
    id: `crash_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    appName: "FlowGet",
    version: "1.0.0",
    os: typeof navigator !== "undefined" ? navigator.platform : "Windows",
    errorName: err.name || "Error",
    errorMessage: anonymizeStack(err.message),
    stackTrace: anonymizeStack(err.stack),
    userOptIn: optIn,
  };

  try {
    const existing: CrashReport[] = JSON.parse(
      localStorage.getItem(CRASH_LOG_KEY) || "[]"
    );
    existing.unshift(report);
    // Keep max 20 logs
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(existing.slice(0, 20)));
  } catch {}

  // If user has opted in to anonymous telemetry, forward to Sentry ingest
  if (optIn) {
    sendToSentryIngest(report).catch(() => {});
  }

  return report;
}

/**
 * Dispatches anonymized crash telemetry payload to Sentry endpoint
 */
async function sendToSentryIngest(report: CrashReport): Promise<void> {
  try {
    // Sentry Envelope / Store API endpoint simulation
    const sentryDsn = "https://public@sentry.flowget.net/api/42/envelope/";
    await fetch(sentryDsn, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: report.id,
        timestamp: new Date(report.timestamp).toISOString(),
        platform: "javascript",
        sdk: { name: "flowget.sentry", version: "1.0.0" },
        exception: {
          values: [
            {
              type: report.errorName,
              value: report.errorMessage,
              stacktrace: { frames: report.stackTrace },
            },
          ],
        },
      }),
    });
  } catch {
    // Fail silently without interrupting user
  }
}

export function getCrashReports(): CrashReport[] {
  try {
    return JSON.parse(localStorage.getItem(CRASH_LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

export function clearCrashReports(): void {
  try {
    localStorage.removeItem(CRASH_LOG_KEY);
  } catch {}
}
