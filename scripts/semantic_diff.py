#!/usr/bin/env python3
"""Semantic diff of two envelope responses, masking volatile fields.

Volatile (masked): stats.elapsedUs, result.build (native vs wasm).
Everything else (paths, costs, IDs, event order) must agree exactly.
Usage: semantic_diff.py <a.json> <b.json>
"""
import json
import sys


def mask(doc):
    if isinstance(doc, dict):
        stats = doc.get("stats")
        if isinstance(stats, dict):
            stats.pop("elapsedUs", None)
        result = doc.get("result")
        if isinstance(result, dict):
            result.pop("build", None)
    return doc


def main():
    with open(sys.argv[1]) as f:
        a = mask(json.load(f))
    with open(sys.argv[2]) as f:
        b = mask(json.load(f))
    if a == b:
        print(f"PARITY OK: {sys.argv[1]} == {sys.argv[2]} (masked elapsedUs, build)")
        return 0
    print(f"PARITY FAIL: {sys.argv[1]} != {sys.argv[2]}")
    print("--- native ---")
    print(json.dumps(a, indent=1, sort_keys=True)[:3000])
    print("--- wasm ---")
    print(json.dumps(b, indent=1, sort_keys=True)[:3000])
    return 1


if __name__ == "__main__":
    sys.exit(main())
