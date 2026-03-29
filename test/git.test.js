import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getGitContext } from '../src/git.js';

describe('getGitContext', () => {
  it('returns git context when inside a git repo', async () => {
    // This test runs inside the agent-feed repo itself
    const ctx = await getGitContext(process.cwd());
    assert.ok(ctx.git_branch, 'should have a branch');
    assert.ok(ctx.git_commit, 'should have a commit hash');
    assert.equal(typeof ctx.git_branch, 'string');
    assert.equal(typeof ctx.git_commit, 'string');
    assert.equal(ctx.git_commit.length, 40);
  });

  it('returns null values when outside a git repo', async () => {
    const ctx = await getGitContext('/tmp');
    assert.equal(ctx.git_branch, null);
    assert.equal(ctx.git_commit, null);
    assert.equal(ctx.repo, null);
  });

  it('returns a repo name derived from the remote or directory', async () => {
    const ctx = await getGitContext(process.cwd());
    assert.ok(ctx.repo, 'should have a repo name');
    assert.equal(typeof ctx.repo, 'string');
  });
});
