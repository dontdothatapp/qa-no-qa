import fs from 'node:fs';
import path from 'node:path';

export type QaEvent = Record<string, unknown> & { type: string };
export type EventLog = { file: string; append(e: QaEvent): void; read(): QaEvent[] };

/** Append-only JSONL log. Callers must never put password values in events. */
export function openEventLog(file: string): EventLog {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    file,
    append(e: QaEvent) {
      fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n');
    },
    read(): QaEvent[] {
      if (!fs.existsSync(file)) return [];
      const out: QaEvent[] = [];
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          // skip a torn line
        }
      }
      return out;
    },
  };
}
