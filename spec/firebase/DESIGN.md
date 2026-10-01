# Firestore layer

Generated rules: `firestore.public.rules`, `firestore.controlled.rules`, `firestore.indexes.json` (from `tools/gen_rules.py`).
**Status: the rules have not been run in the Firebase emulator.** Schemas and the chunk codec are tested (`tools/validate.test.js`); the rules are only structurally checked. Run the matrix at the bottom before any real deployment.

## Layout

```
experiments/{exp}
  admins/{email}                       allow-list of experimenters (managed with console / Admin SDK)
  claims/{n}                           subject-number claim: {n, label: "sub-007", status, created_at}
  claims_by_uid/{uid}                  public mode only: {n, created_at}; one claim per anonymous user
  data/{uid}/sessions/{sub}_{ses}      session record (schema/session.schema.json)
    chunks/{i}                         event chunk (schema/firestore.schema.json#/definitions/chunk)
```

`{exp}` is `storage.firebase.experiment_id`; one Firebase project can host several experiments.

## Access modes

| | controlled | public |
|---|---|---|
| Who writes | signed-in, allow-listed experimenters | anonymous participants (Firebase Auth anonymous) |
| Subject ID | prefilled with the smallest free number, overridable | server-assigned, locked |
| Claims | any free number may be created by an admin | `n` may be created only if `n-1` exists (no gaps) |
| Reads | admins | admins only; participants can never read data back |
| App Check | optional | strongly recommended (enforce it) |

## Subject-ID allocation

Claims are create-only documents keyed by number, so two clients cannot take the same number: the second create fails because the document exists (rules allow create only, never overwrite).

**Controlled.** The client lists `claims` (admin read), takes the smallest missing number, and creates `claims/{n}`. The operator may type another number; the create succeeds only if it is free. Race between two experimenters: the loser gets a permission error, re-lists, retries.

**Public.** Participants cannot list. The allocator probes with `get` (allowed for signed-in users): double `n` until a missing doc is found, then binary-search for the first gap boundary (O(log n) reads). It then creates in one batch `claims/{n}` and `claims_by_uid/{uid}`. Rules enforce contiguity (`n == 1` or `claims/{n-1}` exists) and that the marker is in the same batch (`existsAfter`/`getAfter`). A lost race fails the batch; the client re-probes. A uid that already has a marker re-uses it, so a page reload never burns a number.
Reservations hold `status: reserved`; `reserved -> active` at session start, `active -> complete | void` at the end. A reserved claim older than `claim_timeout_min` may be reused by an admin (manual or `cli`), never by clients.

**Caveat.** An anonymous uid belongs to one browser profile. A participant who returns on another device or after clearing site data is a new uid and gets a new subject number. Multi-session studies across devices need real accounts (e.g. email-link sign-in), which this layout supports by swapping the uid but is not built yet.

## Writing sessions

1. `session` doc created with `status: in_progress` (rules check shape, `uid`, `experiment_id`, `key == subject_id + "_" + session_id`; public mode also checks the label matches the claim).
2. Events buffer in memory and in the local recovery log (IndexedDB). Every `chunk.flush_ms` (default 10 s) or at `chunk.max_events` / `max_bytes`, a chunk is written as `chunks/{i}` (`i` consecutive from 0).
3. At the end the session doc is updated **once** with `status`, `ended_at`, `end_reason`, `eyetracking`, `sinks`, `n_chunks`, `last_seq`. Rules forbid changing anything else, and forbid a second update after the status leaves `in_progress`.
4. Retrying a chunk is safe: `update` is allowed only if the new content is identical.

Events are stored as one NDJSON string per chunk, optionally gzip+base64. Reason: Firestore rejects arrays nested directly in arrays, and `gaze.samples` and `input.pointer.path` are arrays of arrays. Payloads are ASCII-only so `size()` equals bytes; the limit is 900,000 against the 1 MiB document cap. Reference codec: `tools/chunks.py`.

### Cost per session (order of magnitude)

Writes: 1 claim + 1 marker + 1 session + 1 session update + N chunks. A 20-minute session at the default flush is about 120 chunks, so ~125 writes. Reads at start: 1 (controlled: one list of claims, 1 read per existing claim; public: ~2·log2(n)). Raise `flush_ms` to cut writes; the local log protects against a tab crash in between. Check current Firestore pricing and quota before a large launch and set budget alerts.

## Export contract

Export is independent of storage. `cli export-firestore` uses the **Admin SDK** (bypasses rules) with `collectionGroup('sessions')` filtered by `experiment_id`, reads each session's `chunks` ordered by `i`, and runs `read_chunks`-equivalent integrity checks:

- chunk indices consecutive `0..n_chunks-1` (missing -> incomplete)
- `seq` continuous across chunks, final `to_seq == last_seq`
- duplicate chunks tolerated, reported
- session with `status: in_progress` and no `n_chunks` -> flagged as interrupted; still exportable, marked partial

Output is the same session + event stream the local store produces, so the BIDS writer has one input format.

## Deployment checklist

1. Create the project; enable Firestore (native mode) and Authentication (Google for admins; Anonymous for public).
2. `python3 tools/gen_rules.py`; deploy `firestore.<mode>.rules` as `firestore.rules`, plus `firestore.indexes.json`.
3. Add experimenters: create `experiments/{exp}/admins/{email}` (email must be verified).
4. Public mode: register App Check (reCAPTCHA Enterprise / Turnstile) and **enforce** it for Firestore and Auth.
5. Set budget alerts and a Firestore quota alert.
6. Dry-run with `cli validate` and a test session; export it and check the integrity report.

## Known limits

- Public mode cannot stop a determined attacker from creating many anonymous users, each taking a subject number. App Check and rate limits reduce this; they do not remove it.
- Contiguity means an abandoned claim keeps its number. That is intended (BIDS ids are never reused); `void` marks them.
- Collection-group reads need the field overrides in `firestore.indexes.json`.
- Unverified rules-language assumptions: `string(int)` in paths, `existsAfter`/`getAfter` inside batched writes, `diff().affectedKeys()` on update. These are the first things the emulator tests should confirm.

## Rules test matrix (to run in the emulator)

| # | Mode | Actor | Action | Expect |
|---|---|---|---|---|
| 1 | public | anon A | create claim 1 + marker 1 in one batch | allow |
| 2 | public | anon A | create claim 1 without marker | deny |
| 3 | public | anon B | create claim 1 again | deny |
| 4 | public | anon B | create claim 3 while 2 missing | deny |
| 5 | public | anon A | second claim (marker exists) | deny |
| 6 | public | anon A | create session whose subject_id != own claim label | deny |
| 7 | public | anon A | create own session, valid shape | allow |
| 8 | public | anon A | create session with extra key / wrong uid / wrong key | deny |
| 9 | public | anon A | read own session or chunk | deny |
| 10 | public | anon A | end-of-session update of allowed keys | allow |
| 11 | public | anon A | second update after status left in_progress | deny |
| 12 | public | anon A | update changing `subject_id` | deny |
| 13 | public | anon A | create chunk 0 with valid shape | allow |
| 14 | public | anon A | create chunk with 950,000-char payload | deny |
| 15 | public | anon A | rewrite chunk with different payload | deny |
| 16 | public | anon A | rewrite chunk with identical payload | allow |
| 17 | public | anon A | write into another uid's data | deny |
| 18 | public | admin | list claims, read data, collection-group query | allow |
| 19 | public | non-admin signed-in | collection-group read | deny |
| 20 | controlled | admin | create claim 5 (override) | allow |
| 21 | controlled | admin | create claim 5 again | deny |
| 22 | controlled | anon | any write | deny |
| 23 | both | unverified-email user listed as admin | any admin action | deny |
