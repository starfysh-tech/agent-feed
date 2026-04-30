// HTTP readiness probe used by `agent-feed start` to confirm the daemon is
// fully ready — not just that it spawned and bound a port, but that the UI
// server is serving requests AND the DB is queryable (the migration-failure
// detector). Replaces a previous file-existence wait that didn't catch
// daemons that crashed after writing the env file.
//
// Targets 127.0.0.1 explicitly (matching the UI server's explicit IPv4 bind)
// to avoid macOS's 'localhost'→::1 resolution that previously produced a
// probe-vs-bind mismatch.
//
// timeoutMs can be overridden via AGENT_FEED_HEALTH_TIMEOUT_MS env var for
// machines with very large DBs or slow disks.

const DEFAULT_TIMEOUT_MS = Number(process.env.AGENT_FEED_HEALTH_TIMEOUT_MS) || 30_000;
// Per-request timeout intentionally 5s (not 2s): under WAL contention with a
// concurrent migration on a multi-GB DB, a SELECT 1 inside /api/health can
// queue. 5s leaves room without making total budget noticeably less responsive.
const PER_REQUEST_TIMEOUT_MS = 5_000;

export async function waitForHealth(port, { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // lastErr is always a string by the time we return — callers can rely on
  // it for the failure message without conditional checks.
  let lastErr = 'no probe attempt before deadline';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.ok) return { ok: true };
        // Daemon answered but is reporting unhealthy (e.g. db not ready)
        lastErr = `daemon reported unhealthy: ${JSON.stringify(body)}`;
      } else {
        lastErr = `health probe HTTP ${res.status}`;
      }
    } catch (err) {
      // Connection refused / abort / DNS — daemon not yet listening or
      // request exceeded PER_REQUEST_TIMEOUT_MS. AbortError messages from
      // fetch are terse; prepend our context so logs are actionable.
      const msg = err?.message ?? String(err);
      lastErr = err?.name === 'TimeoutError' || /aborted|timeout/i.test(msg)
        ? `request to /api/health timed out after ${PER_REQUEST_TIMEOUT_MS}ms (daemon may be migrating a large DB)`
        : msg;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, lastError: lastErr };
}
