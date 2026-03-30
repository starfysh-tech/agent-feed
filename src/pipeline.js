import { getAdapter, AGENTS } from './adapters/index.js';
import { getGitContext } from './git.js';
import { randomUUID } from 'node:crypto';

// Track turn counts per session in memory
const sessionTurnCounts = new Map();

export class Pipeline {
  constructor({ db, classifierFn = null }) {
    this.db = db;
    this.classifierFn = classifierFn;
  }

  async process(capture) {
    // Skip non-200 responses
    if (capture.statusCode !== 200) return;

    const adapter = getAdapter(capture.host);

    // Skip unknown agents
    if (adapter.name === AGENTS.UNKNOWN) return;

    // Build context for adapter (Gemini needs proxy-generated session ID)
    const context = {
      proxySessionId: randomUUID(),
      requestHash: this._hashRequest(capture.rawRequest),
    };

    const sessionId = adapter.extractSessionId(capture.rawResponse, context);
    if (!sessionId) return;

    const content = adapter.extractContent(capture.rawResponse);
    const model = adapter.extractModel(capture.rawResponse) ?? 'unknown';
    const tokenCount = adapter.extractTokenCount(capture.rawResponse);

    // Track turn index per session
    const turnKey = sessionId;
    const turnIndex = (sessionTurnCounts.get(turnKey) ?? 0) + 1;
    sessionTurnCounts.set(turnKey, turnIndex);

    // Run classifier if provided
    let responseSummary = content?.slice(0, 200) ?? '';
    let flags = [];

    if (this.classifierFn && content) {
      try {
        const result = await this.classifierFn(content);
        responseSummary = result.response_summary ?? responseSummary;
        flags = result.flags ?? [];
      } catch (err) {
        console.error('[pipeline] classifier error:', err.message ?? err);
      }
    }

    // Collect git context
    const gitCtx = await getGitContext(process.cwd());

    // Build and insert record
    const recordId = await this.db.insertRecord({
      timestamp: capture.timestamp,
      agent: adapter.name,
      session_id: sessionId,
      turn_index: turnIndex,
      working_directory: process.cwd(),
      repo: gitCtx.repo,
      git_branch: gitCtx.git_branch,
      git_commit: gitCtx.git_commit,
      response_summary: responseSummary,
      raw_request: capture.rawRequest,
      raw_response: capture.rawResponse,
      token_count: tokenCount,
      model,
    });

    // Insert flags
    for (const flag of flags) {
      try {
        await this.db.insertFlag({
          record_id: recordId,
          type: flag.type,
          content: flag.content,
          confidence: flag.confidence,
        });
      } catch {
        // skip invalid flags silently
      }
    }
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
