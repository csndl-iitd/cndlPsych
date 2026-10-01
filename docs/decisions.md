# Decisions log

Record every deviation from ARCHITECTURE.md or `spec/` here: date, what changed, why.

Open at hand-off (defaults assumed): `on:` key kept (YAML 1.2 loader required); no profile groups in v1;
`design:` kept small; `sex` enum to be checked against the BIDS target in M8; custom events limited to
`task.*` / `semantic.*`; real accounts for multi-device public studies not built.

## 2026-10-01 - M0 repo and tooling

- **Python build/validate ported to Node and deleted.** `spec/tools/build.py`, `validate.py`, `yaml12.py` are replaced by `build.js`, `validate.test.js`, `yaml12.js`. `build.js` output was compared with the Python output byte for byte (all 14 files, LF endings) before deletion. `build.js --check` (`npm run check:schemas`) fails when `spec/schema/` is stale. `chunks.py` and `gen_rules.py` stay as the references for M7.
- **`chunks.js` added now** (not in M7) because the validator's Firestore section needs the codec. It is a tooling port only; the runtime codec in `storage/` is still M7. Parity is by round trip, not by bytes: Python `json.dumps` writes `1.0` where JS writes `1`, and gzip headers can differ, so M7 must decide what "identical" means for the shared fixture.
- **js-yaml 4 with `CORE_SCHEMA` + the merge type.** The core schema is YAML 1.2 (`on` stays a string, `16:9` stays a string); the sources use `<<` merge keys, which the core schema omits. js-yaml is pinned to major 4 (npm now resolves 5).
- **Ajv strict mode on, except `strictTypes` and `strictRequired`.** Those two police style (`pattern` without `type`, `required` of a property defined in a sibling subschema) that the schemas use on purpose. Unknown keywords still fail.
- **`.gitattributes` forces LF.** The Python reference wrote CRLF on Windows when run in place; generated files must not depend on the OS.
- **Layer rules are enforced twice**: `eslint.config.js` (`no-restricted-imports`, `no-restricted-syntax` for dynamic SDK imports, storage/random globals) and `tools/check-layers.js` (CI; also sees dynamic imports and `export ... from`). Both are tested with deliberately bad imports. `foundation` may import its own siblings (`./x.js`) but nothing else.
- **Test naming:** Vitest `*.test.js`, Playwright `*.e2e.js`, both beside the code.
- **`tsc` scope** is `spec/types.d.ts` plus `spec/examples/custom/**`; framework code is added to `tsconfig.json` as it is written.
- `esbuild` is installed but has no script yet; the first bundle is built when there is something to bundle (M4/M10).

### M0 not verified

- CI (`.github/workflows/ci.yml`) has never run: there is no remote. The same steps pass locally on Windows 11 / Node 24 (`npm run ci`, `npm run typecheck`, `npm run test:browser`).
- Playwright ran Chromium only (desktop and Pixel 7 emulation). WebKit, Firefox and real phones are untested.
- The Python reference `validate.py` itself failed one case on Windows (its `file://` URL for the custom generator import); the other 72 cases passed there. The Node port covers all of them.
