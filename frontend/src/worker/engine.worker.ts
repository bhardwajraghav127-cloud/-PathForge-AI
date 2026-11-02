// Single-threaded WASM worker: loads the real C++ engine module and
// executes one envelope per message. No routing decisions happen here.
import createModule from './wasm/pathforge.mjs';

interface WasmApi {
  ccall(fn: string, ret: string | null, args: string[], vals: number[]): number | null;
  _malloc(n: number): number;
  _free(p: number): void;
  lengthBytesUTF8(s: string): number;
  stringToUTF8(s: string, ptr: number, n: number): void;
  UTF8ToString(p: number): string;
}

let api: WasmApi | null = null;

async function ready(): Promise<WasmApi> {
  if (!api) api = (await createModule()) as unknown as WasmApi;
  return api;
}

self.onmessage = async (ev: MessageEvent<{ id: string; reqJson: string }>) => {
  const { id, reqJson } = ev.data;
  try {
    const m = await ready();
    const n = m.lengthBytesUTF8(reqJson) + 1;
    const inPtr = m._malloc(n);
    m.stringToUTF8(reqJson, inPtr, n);
    const outPtr = m.ccall('pf_execute', 'number', ['number'], [inPtr]);
    const out = m.UTF8ToString(outPtr as number);
    m.ccall('pf_free', null, ['number'], [outPtr as number]);
    m._free(inPtr);
    (self as unknown as { postMessage(m: unknown): void }).postMessage({ id, resJson: out });
  } catch (err) {
    (self as unknown as { postMessage(m: unknown): void }).postMessage({
      id,
      error: err instanceof Error ? err.message : 'WORKER_ERROR',
    });
  }
};
