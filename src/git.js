import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getGitContext(cwd = process.cwd()) {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!branch) {
    return { repo: null, git_branch: null, git_commit: null };
  }

  const commit = await git(['rev-parse', 'HEAD'], cwd);

  // Try to get repo name from remote URL first, fall back to directory name
  const remoteUrl = await git(['remote', 'get-url', 'origin'], cwd);
  let repo = null;
  if (remoteUrl) {
    // Extract repo name from URL: https://github.com/org/repo.git -> repo
    const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
    repo = match ? match[1] : null;
  }
  if (!repo) {
    // Fall back to top-level directory name
    const topLevel = await git(['rev-parse', '--show-toplevel'], cwd);
    repo = topLevel ? path.basename(topLevel) : null;
  }

  return {
    repo,
    git_branch: branch,
    git_commit: commit,
  };
}
