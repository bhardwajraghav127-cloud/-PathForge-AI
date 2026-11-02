// Typed EngineClient over the WASM worker (M1).
// Guarantees: typed request IDs, Zod envelope validation, per-channel
// stale-response suppression (only older calls are discarded — the latest
// call on a channel always settles with engine data), worker crash recovery,
// explicit loading/error states. No pathfinding lives here.
import { z } from 'zod';

const EnvelopeSchema = z
  .object({ apiVersion: z.literal(1), requestId: z.string(), ok: z.boolean() })
  .passthrough();

export class EngineError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details: unknown = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type EngineStatus = 'loading' | 'ready' | 'crashed' | 'error';
export type CallOutcome =
  | { stale: true }
  | { stale: false; result: unknown; stats: unknown; requestId: string };

interface Pending {
  resolve: (o: CallOutcome) => void;
  reject: (e: Error) => void;
  channel: string;
  seq: number;
}

export class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private latestByChannel = new Map<string, number>();
  private restarts = 0;
  status: EngineStatus = 'loading';
  onStatus: ((s: EngineStatus) => void) | null = null;

  constructor() {
    this.spawn();
  }

  private setStatus(s: EngineStatus) {
    this.status = s;
    this.onStatus?.(s);
  }

  private spawn() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent) => {
      const { id, resJson, error } = ev.data as { id: string; resJson?: string; error?: string };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (import.meta.env.DEV) {
        const w = window as unknown as { __PF_ENGINE_CALLS__?: number };
        w.__PF_ENGINE_CALLS__ = (w.__PF_ENGINE_CALLS__ ?? 0) + 1;
      }
      if (error) {
        p.reject(new EngineError('WORKER_ERROR', error));
        return;
      }
      try {
        const env = EnvelopeSchema.parse(JSON.parse(resJson as string));
        // Stale suppression: only an older call on the same channel is dropped.
        if (this.latestByChannel.get(p.channel) !== p.seq) {
          p.resolve({ stale: true });
          return;
        }
        if (!env.ok) {
          const e = env as unknown as {
            error: { code: string; message: string; details?: unknown };
          };
          p.reject(new EngineError(e.error.code, e.error.message, e.error.details));
          return;
        }
        const full = JSON.parse(resJson as string) as { result: unknown; stats: unknown };
        p.resolve({ stale: false, result: full.result, stats: full.stats, requestId: env.requestId });
      } catch (e) {
        p.reject(e instanceof Error ? e : new Error('envelope parse failed'));
      }
    };
    this.worker.onerror = () => {
      this.setStatus('crashed');
      for (const [, p] of this.pending) p.reject(new EngineError('WORKER_CRASHED', 'worker crashed'));
      this.pending.clear();
      // Auto-recover once; UI can call restart() afterwards.
      if (this.restarts < 1) {
        this.restarts += 1;
        this.spawn();
        this.setStatus('loading');
      }
    };
    this.setStatus('ready');
  }

  restart() {
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.spawn();
  }

  call(
    command: string,
    payload: unknown,
    opts: { channel?: string; timeoutMs?: number } = {},
  ): Promise<CallOutcome> {
    const channel = opts.channel ?? 'default';
    const timeoutMs = opts.timeoutMs ?? 60000;
    this.seq += 1;
    const mySeq = this.seq;
    this.latestByChannel.set(channel, mySeq);
    const requestId = `r-${mySeq}`;
    const reqJson = JSON.stringify({ apiVersion: 1, requestId, command, payload });
    return new Promise<CallOutcome>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new EngineError('TIMEOUT', `engine call timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (o) => {
          window.clearTimeout(timer);
          resolve(o);
        },
        reject: (e: Error) => {
          window.clearTimeout(timer);
          reject(e);
        },
        channel,
        seq: mySeq,
      });
      this.worker?.postMessage({ id: requestId, reqJson });
    });
  }
}
