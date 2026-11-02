// Node WASM harness: runs one envelope fixture through the real WASM engine.
// Usage: node scripts/wasm-harness.mjs <request.json>  (stdout = response JSON)
import createModule from '../frontend/src/worker/wasm/pathforge.mjs';
import fs from 'node:fs';

const mod = await createModule();
const req = fs.readFileSync(process.argv[2], 'utf8');
const n = mod.lengthBytesUTF8(req) + 1;
const inPtr = mod._malloc(n);
mod.stringToUTF8(req, inPtr, n);
const outPtr = mod.ccall('pf_execute', 'number', ['number'], [inPtr]);
const out = mod.UTF8ToString(outPtr);
mod.ccall('pf_free', null, ['number'], [outPtr]);
mod._free(inPtr);
process.stdout.write(out);
