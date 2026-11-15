import { TypeSafeClient, TypeSafeError, APIError, APIConnectionError, type RetryPolicy } from '@typesafe-ai/sdk';
import { DEFAULTS, findTypeSafeKey } from './config.ts';

export type Operation = 'click' | 'type' | 'select' | 'press_enter' | 'scroll' | 'wait' | 'done' | 'blocked';
export type JevUsage = { inputTokens: number; outputTokens: number };
export type JevRequest = { state: Record<string, unknown>; questions: Record<string, unknown> };
export type JevAnswer = {
  operation: Operation;
  opConfidence: number;
  target: number | null;
  targetConfidence: number;
  usage: JevUsage;
  latencyMs: number;
};
export type JevErrorKind = 'transient' | 'fatal' | 'request';

export class JevError extends Error {
  kind: JevErrorKind;
  constructor(message: string, kind: JevErrorKind) {
    super(message);
    this.name = 'JevError';
    this.kind = kind;
  }
}

export interface JevClient {
  decide(req: JevRequest): Promise<JevAnswer>;
}

/** transient: retry later / hand back; fatal: key or account problem; request: our request was rejected. */
export function classifyError(e: unknown): JevErrorKind {
  if (e instanceof JevError) return e.kind;
  if (e instanceof APIConnectionError) return 'transient'; // includes APITimeoutError
  if (e instanceof APIError) {
    const s = e.status;
    if (s === 401 || s === 402 || s === 403) return 'fatal';
    if (s === 408 || s === 429 || s >= 500) return 'transient';
    return 'request';
  }
  if (e instanceof TypeSafeError) return 'request'; // rejected by the SDK before sending
  return 'transient';
}

function toJevError(e: unknown): JevError {
  if (e instanceof JevError) return e;
  const kind = classifyError(e);
  const status = e instanceof APIError ? ` (HTTP ${e.status})` : '';
  return new JevError(`Jev ${kind} error${status}: ${(e as Error)?.message ?? String(e)}`, kind);
}

type ChoiceAnswer = { choice?: string; confidence?: number };

export function createTypeSafeClient(
  opts: { fetch?: typeof fetch; apiKey?: string; retry?: Partial<RetryPolicy>; timeoutMs?: number } = {},
): JevClient {
  const apiKey = opts.apiKey ?? findTypeSafeKey()?.key;
  if (!apiKey) {
    return { decide: async () => { throw new JevError('No TypeSafe API key found', 'fatal'); } };
  }
  // The SDK retries 408/429/5xx, timeouts and connection errors (2 retries, 500 ms doubling by default).
  const client = new TypeSafeClient({
    apiKey,
    timeout: opts.timeoutMs ?? 10000,
    retry: { maxRetries: 2, backoffInitialMs: DEFAULTS.jevRetryBackoffMs[0], ...opts.retry },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    logLevel: 'off',
  } as ConstructorParameters<typeof TypeSafeClient>[0]);

  return {
    async decide(req: JevRequest): Promise<JevAnswer> {
      const started = Date.now();
      let result: { answers: Record<string, ChoiceAnswer>; usage?: { input_tokens: number | null; output_tokens: number | null } };
      try {
        result = (await client.systemOne({ model: DEFAULTS.jevModel, ...req } as Parameters<TypeSafeClient['systemOne']>[0])) as unknown as typeof result;
      } catch (e) {
        throw toJevError(e);
      }
      const op = result.answers.operation ?? {};
      const target = result.answers.target ?? {};
      const usage = result.usage as Record<string, number | null> | undefined;
      return {
        operation: (op.choice ?? 'blocked') as Operation,
        opConfidence: op.confidence ?? 0,
        target: target.choice && target.choice !== 'none' ? Number(target.choice) : null,
        targetConfidence: target.confidence ?? 0,
        usage: {
          inputTokens: usage?.input_tokens ?? usage?.inputTokens ?? 0,
          outputTokens: usage?.output_tokens ?? usage?.outputTokens ?? 0,
        },
        latencyMs: Date.now() - started,
      };
    },
  };
}

/** Test double: answers in FIFO order (JevError entries are thrown); records every request. */
export function createScriptedClient(answers: Array<Partial<JevAnswer> | JevError>): JevClient & { requests: JevRequest[] } {
  const queue = [...answers];
  const requests: JevRequest[] = [];
  return {
    requests,
    async decide(req: JevRequest): Promise<JevAnswer> {
      requests.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error('scripted Jev client exhausted');
      if (next instanceof JevError) throw next;
      return {
        operation: 'done',
        opConfidence: 1,
        target: null,
        targetConfidence: 1,
        usage: { inputTokens: 100, outputTokens: 10 },
        latencyMs: 1,
        ...next,
      };
    },
  };
}
