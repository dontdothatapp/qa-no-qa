import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { stateDir } from './config.ts';

export type CurrentRun = { runDir: string; port: number; token: string; pid: number };
export class DaemonUnreachable extends Error {}
type Env = Record<string, string | undefined>;

export const currentRunFile = (env: Env = process.env) => path.join(stateDir(env), 'current-run.json');

export function readCurrentRun(env: Env = process.env): CurrentRun | null {
  try {
    return JSON.parse(fs.readFileSync(currentRunFile(env), 'utf8'));
  } catch {
    return null;
  }
}

export function writeCurrentRun(run: CurrentRun, env: Env = process.env): void {
  fs.mkdirSync(stateDir(env), { recursive: true });
  fs.writeFileSync(currentRunFile(env), JSON.stringify(run), { mode: 0o600 });
}

export function clearCurrentRun(env: Env = process.env): void {
  fs.rmSync(currentRunFile(env), { force: true });
}

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Alive AND actually a visual-qa daemon (a reused PID after a crash or reboot is not ours). */
export function isOurDaemon(pid: number): boolean {
  if (!isAlive(pid)) return false;
  try {
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return cmd.includes('qa.ts') && cmd.includes(' daemon ');
  } catch {
    return false;
  }
}

/** Sends one command to the run daemon; resolves with its result or throws its error message. */
export async function sendCommand(name: string, args: Record<string, unknown>, env: Env = process.env, timeoutMs = 110_000): Promise<unknown> {
  const run = readCurrentRun(env);
  if (!run) throw new Error('no active run — start one with: qa start <scenarios.yaml>');
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${run.port}/cmd`, {
      method: 'POST',
      headers: { authorization: `Bearer ${run.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new DaemonUnreachable(`the run daemon is not responding (pid ${run.pid}) — run: qa stop, then start again`);
  }
  const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
  if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.result;
}
