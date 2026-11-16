import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = Object.freeze({
  viewport: Object.freeze({ width: 1280, height: 800 }),
  confidenceThreshold: 0.7,
  stepBudget: 8,
  scenarioBudget: 40,
  takeoverBudget: 25,
  jevRetryBackoffMs: Object.freeze([500, 1500]) as readonly number[],
  jpegQuality: 80,
  settleMs: 750,
  jevTextChars: 3000,
  evidenceTextChars: 20000,
  maxTargets: 254,
  lookMaxControls: 400,
  lookTextChars: 4000,
  navTimeoutMs: 15000,
  actionTimeoutMs: 5000,
  jevModel: 'jev-latest',
});

export type Defaults = typeof DEFAULTS;
type Env = Record<string, string | undefined>;

function homeDir(env: Env): string {
  return env.HOME || os.homedir();
}

/** Directory of the visual-qa plugin source (real path, symlinks resolved). */
export function pluginRoot(): string {
  return path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))));
}

export function stateDir(env: Env = process.env): string {
  return env.VISUAL_QA_STATE_DIR || path.join(homeDir(env), '.visual-qa');
}

export function outputRoot(env: Env = process.env): string {
  return env.VISUAL_QA_OUTPUT_DIR || path.join(homeDir(env), 'QA');
}

/** The file the person pastes their TypeSafe key into. */
export function keyFile(env: Env = process.env): string {
  return path.join(homeDir(env), '.visual-qa', '.env');
}

function readDotEnvValue(file: string, name: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (key !== name) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

export type KeySource = 'env' | 'home';

/** Finds the TypeSafe key. Callers must never print `key`; report `source` only. */
export function findTypeSafeKey(env: Env = process.env): { key: string; source: KeySource } | null {
  const fromEnv = env.TYPESAFE_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const fromHome = readDotEnvValue(keyFile(env), 'TYPESAFE_API_KEY');
  if (fromHome) return { key: fromHome, source: 'home' };
  return null;
}

export function sanitizeTopic(topic: string): string {
  return topic.replace(/[\/\\:*?"<>|]/g, '-').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Absolute run folder: <outputRoot>/<YYYY-MM-DD> <topic>[ HH-MM[-SS]] — never an existing folder. */
export function runFolderName(topic: string, now: Date, exists: (p: string) => boolean, env: Env = process.env): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const base = path.join(outputRoot(env), `${date} ${sanitizeTopic(topic)}`);
  if (!exists(base)) return base;
  const withMinutes = `${base} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  if (!exists(withMinutes)) return withMinutes;
  return `${withMinutes}-${pad(now.getSeconds())}`;
}
