import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { resolve } from 'path';

/**
 * Runs the existing scripted demo agent (`apps/demo-agent`) as a child process on the server, so the
 * console's Demo Lab page can trigger any scene with a button click instead of a terminal. This is a
 * thin process wrapper, not a reimplementation: every scene's actual behaviour — the mandate, the
 * gate, the attack, the escalation, the receipt — is exactly the same code path `pnpm demo` uses.
 *
 * Only meaningful when this API instance was itself started under the demo orchestrator (`scripts/
 * demo.mjs`), which is what sets DEMO_API_URL / ATLAS_KEYRING_PATH and runs the API from the repo
 * root — see {@link isConfigured}. In a plain treasury-only deployment these env vars are absent and
 * the Demo Lab endpoints refuse cleanly rather than trying to spawn a binary that isn't built.
 */
@Injectable()
export class AgentDemoService {
  private readonly logger = new Logger(AgentDemoService.name);
  private running = false;

  isConfigured(): boolean {
    return Boolean(process.env.DEMO_API_URL && process.env.ATLAS_KEYRING_PATH);
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Runs one or more scenes (or all six, when `scenes` is omitted) and calls `onLine` for every line
   * the child process prints — narration, kv detail, PASS/FAIL from `atlas verify`, everything.
   * Serialised: only one run at a time, since the underlying scenes share this org's single demo
   * mandate. Resolves with the child's exit code (0 = every scene behaved as designed).
   */
  async run(
    options: { scenes?: number[]; autoApprove?: boolean },
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    if (this.running) {
      throw new Error('A demo run is already in progress');
    }
    if (!this.isConfigured()) {
      throw new Error('Demo mode is not configured on this server (DEMO_API_URL / ATLAS_KEYRING_PATH not set)');
    }
    this.running = true;
    try {
      // See the class doc: only reachable when the API was started from the repo root by the demo
      // orchestrator, which is the only situation isConfigured() allows this to run in at all.
      const cwd = process.cwd();
      const cliPath = resolve(cwd, 'apps/demo-agent/dist/main.js');
      const args = [cliPath, 'run', '--approval-timeout', '900'];
      if (options.scenes && options.scenes.length > 0) args.push('--only', options.scenes.join(','));
      if (options.autoApprove) args.push('--auto-approve');
      this.logger.log(`demo run: node ${args.join(' ')} (cwd=${cwd})`);

      return await new Promise<number>((resolvePromise, reject) => {
        const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        const onAbort = () => child.kill();
        signal?.addEventListener('abort', onAbort);

        const pump = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
          for (const line of chunk.toString('utf8').split('\n')) {
            if (line.length > 0) onLine(stream, line);
          }
        };
        child.stdout.on('data', pump('stdout'));
        child.stderr.on('data', pump('stderr'));
        child.on('error', (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        });
        child.on('close', (code) => {
          signal?.removeEventListener('abort', onAbort);
          resolvePromise(code ?? 1);
        });
      });
    } finally {
      this.running = false;
    }
  }
}
