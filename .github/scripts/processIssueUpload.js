#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(...args) { console.log('[up-zip]', ...args); }

function safeExec(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  } catch (e) {
    console.error('[up-zip] command failed:', cmd, e.message);
    throw e;
  }
}

(async function main() {
  try {
    const bodyRaw = process.env.ISSUE_BODY || '';
    const title = process.env.ISSUE_TITLE || '';
    log('Processing issue:', title);

    let payload = null;

    // 1. 尝试解析为标准 JSON
    try {
      payload = JSON.parse(bodyRaw);
    } catch (e) {
      // 2. 如果不是纯 JSON，尝试从文本中抽取 JSON 子串
      const jsonMatch = bodyRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          payload = JSON.parse(jsonMatch[0]);
        } catch (ee) {
          // ignore
        }
      }
    }

    // 3. 再尝试更宽松的正则抽取 path 与 content
    if (!payload || !payload.path || !payload.content) {
      const pathMatch = bodyRaw.match(/["']?path["']?\s*:\s*["']([^"']+)["']/i)
        || bodyRaw.match(/path\s*[:=]\s*([^\r\n]+)/i);
      const contentMatch = bodyRaw.match(/["']?content["']?\s*:\s*["']([A-Za-z0-9+\/=\r\n]+)["']/i)
        || bodyRaw.match(/content\s*[:=]\s*([A-Za-z0-9+\/=\r\n]+)/i);
      if (pathMatch && contentMatch) {
        payload = {
          path: (pathMatch[1] || pathMatch[0]).trim(),
          content: (contentMatch[1] || contentMatch[0]).trim()
        };
      }
    }

    if (!payload || !payload.path || !payload.content) {
      log('No valid payload found in issue body. Expected JSON like {"path":"uploads/x.zip","content":"..."}');
      // 不把工作流标记为失败，只是记录信息
      process.exit(0);
    }

    // Normalize path
    const targetPath = path.join(process.cwd(), payload.path);
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    // decode base64 and write file
    const buffer = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64');
    fs.writeFileSync(targetPath, buffer);
    log('Wrote file to', targetPath, ' size:', buffer.length);

    // Commit and push
    safeExec('git config user.name "github-actions[bot]"');
    safeExec('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');

    safeExec('git add -A');

    const commitMsg = `up-zip: add ${payload.path} (from issue)`;
    // If no changes to commit, skip
    try {
      safeExec(`git diff --staged --quiet || git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    } catch (e) {
      // commit might fail if no staged changes; ignore
    }

    // Push (actions/checkout@v4 with persist-credentials allows using GITHUB_TOKEN)
    try {
      safeExec('git push');
      log('Pushed changes to repository.');
    } catch (e) {
      console.error('git push failed:', e.message);
      // still exit 0 to avoid failing the whole job if push blocked by branch protection
    }

  } catch (err) {
    console.error('[up-zip] Unexpected error', err);
    process.exit(1);
  }
})();
