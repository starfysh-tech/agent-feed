import { getAdapter, AGENTS } from './adapters/index.js';
import { getGitContext } from './git.js';
import { randomUUID } from 'node:crypto';

// Known limitation: when both proxy and OTel capture the same Gemini turn,
// they assign different session ids (proxy mints a UUID; OTel reads vendor
// session.id). UI shows them as two sessions for now. A correlation bridge
// would need a stable cross-path key (request body content is too variable);
// deferred until we have real data on how often this matters.

// Extract the agent's working directory from the request system prompt.
// Claude Code includes "Primary working directory: /path/to/repo" in the system prompt.
function extractWorkingDirectory(rawRequest) {
  if (!rawRequest) return null;
  try {
    const parsed = JSON.parse(rawRequest);
    const system = parsed?.system;
    if (!system) return null;
    const parts = Array.isArray(system) ? system : [system];
    for (const part of parts) {
      const text = typeof part === 'string' ? part : part?.text;
      if (!text) continue;
      const match = text.match(/Primary working directory:\s*(.+)/);
      if (match) return match[1].trim();
    }
  } catch {}
  return null;
}

// Allowlist: keep only last 2 messages + metadata. Drops tools (~138KB),
// system (~15KB), model, max_tokens, etc. — all redundant across turns.
// Only applies to Anthropic/OpenAI requests (Gemini uses `contents`, not `messages`).
function trimRequestForStorage(rawRequest) {
  if (!rawRequest) return rawRequest;
  try {
    const parsed = JSON.parse(rawRequest);
    const messages = parsed?.messages;
    if (!Array.isArray(messages) || messages.length <= 2) return rawRequest;
    return JSON.stringify({
      messages: messages.slice(-2),
      metadata: parsed.metadata,
    });
  } catch {
    return rawRequest;
  }
}

export class Pipeline {
  constructor({ db, classifierFn = null }) {
    this.db = db;
    this.classifierFn = classifierFn;
  }

  // source: 'proxy' (default) or 'otel'. Backward-compatible.
  // Classifier runs only for source='proxy' rows because proxy bodies are
  // untruncated; OTel bodies may be cut at ~60-250KB.
  async process(capture, source = 'proxy') {
    // Skip non-200 responses (proxy path; OTel sink supplies its own captures)
    if (capture.statusCode !== 200) return;

    const adapter = getAdapter(capture.host);

    // Skip unknown agents
    if (adapter.name === AGENTS.UNKNOWN) return;

    const context = {
      proxySessionId: randomUUID(),
      requestHash: this._hashRequest(capture.rawRequest),
      rawRequest: capture.rawRequest,
    };

    const sessionId = adapter.extractSessionId(capture.rawResponse, context);
    if (!sessionId) return;

    const content = adapter.extractContent(capture.rawResponse);
    const model = adapter.extractModel(capture.rawResponse) ?? 'unknown';
    const tokenCount = adapter.extractTokenCount(capture.rawResponse);

    // turn_index is derived atomically inside the INSERT (see Database.insertRecord).
    // Survives daemon restarts and avoids the check-then-write race that
    // concurrent captures for the same (session, source) would otherwise hit.

    // Run classifier only for proxy source (untruncated bodies). OTel rows
    // get the same response text via UI coalesce when paired with proxy.
    let responseSummary = content?.slice(0, 200) ?? '';
    let flags = [];

    if (source === 'proxy' && this.classifierFn && content) {
      try {
        const result = await this.classifierFn(content);
        responseSummary = result.response_summary ?? responseSummary;
        flags = result.flags ?? [];
      } catch (err) {
        console.error('[pipeline] classifier error:', err.message ?? err);
      }
    }

    // Collect git context from the agent's working directory (not the proxy's)
    const agentCwd = extractWorkingDirectory(capture.rawRequest) ?? process.cwd();
    const gitCtx = await getGitContext(agentCwd);

    // Build and insert record
    const recordId = await this.db.insertRecord({
      timestamp: capture.timestamp,
      agent: adapter.name,
      session_id: sessionId,
      // turn_index omitted -> derived atomically inside the INSERT
      working_directory: agentCwd,
      repo: gitCtx.repo,
      git_branch: gitCtx.git_branch,
      git_commit: gitCtx.git_commit,
      response_summary: responseSummary,
      response_text: content,
      raw_request: trimRequestForStorage(capture.rawRequest),
      raw_response: capture.rawResponse,
      token_count: tokenCount,
      model,
      source,
      request_id: capture.requestId ?? null,
    });

    // Insert flags
    for (const flag of flags) {
      try {
        await this.db.insertFlag({
          record_id: recordId,
          type: flag.type,
          content: flag.content,
          context: flag.context,
          confidence: flag.confidence,
        });
      } catch {
        // skip invalid flags silently
      }
    }

    return recordId;
  }

  _hashRequest(rawRequest) {
    if (!rawRequest) return randomUUID();
    // Simple hash for Gemini session fallback
    let hash = 0;
    for (let i = 0; i < rawRequest.length; i++) {
      hash = ((hash << 5) - hash) + rawRequest.charCodeAt(i);
      hash |= 0;
    }
    return `req_${Math.abs(hash).toString(16)}`;
  }
}
