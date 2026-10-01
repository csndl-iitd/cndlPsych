"""Reference implementation of the Firestore chunk format (the JS sink ports this).

An event stream is cut into chunks; each chunk stores its events as ONE string
(NDJSON, optionally gzip+base64) because Firestore rejects nested arrays and our
pointer/gaze sample rows are arrays of arrays. Payloads are ASCII-only
(ensure_ascii) so a string's length equals its byte size, matching the rules'
size() check and the 1 MiB document limit.
"""
import base64
import gzip
import json

# base64 of gzip output is at most ~1.37x the raw size in the worst case
_BASE64_BOUND = 1.37


def _ndjson(events):
    return "\n".join(json.dumps(e, ensure_ascii=True, separators=(",", ":")) for e in events)


def encode_chunk(events, i, encoding="json"):
    text = _ndjson(events)
    payload = text if encoding == "json" else base64.b64encode(gzip.compress(text.encode("ascii"), mtime=0)).decode("ascii")
    return {
        "i": i,
        "n_events": len(events),
        "from_seq": events[0]["seq"],
        "to_seq": events[-1]["seq"],
        "t_first": events[0]["t"],
        "t_last": events[-1]["t"],
        "encoding": encoding,
        "payload": payload,
    }


def make_chunks(events, max_events=400, max_bytes=600_000, encoding="json"):
    """Cut events into chunks no larger than max_events / max_bytes (payload bytes)."""
    raw_limit = max_bytes if encoding == "json" else int(max_bytes / _BASE64_BOUND)
    chunks, buf, buf_bytes = [], [], 0
    for e in events:
        size = len(json.dumps(e, ensure_ascii=True, separators=(",", ":"))) + 1
        if size > raw_limit:
            raise ValueError(f"event seq {e['seq']} ({size} B) exceeds the chunk limit; producers must cap sample chunks")
        if buf and (len(buf) >= max_events or buf_bytes + size > raw_limit):
            chunks.append(encode_chunk(buf, len(chunks), encoding))
            buf, buf_bytes = [], 0
        buf.append(e)
        buf_bytes += size
    if buf:
        chunks.append(encode_chunk(buf, len(chunks), encoding))
    return chunks


def decode_chunk(chunk):
    text = chunk["payload"]
    if chunk["encoding"] == "gzip-base64":
        text = gzip.decompress(base64.b64decode(text)).decode("ascii")
    return [json.loads(line) for line in text.split("\n")]


def read_chunks(chunks):
    """Merge chunks into an event list, reporting integrity problems.

    Returns (events, issues). Duplicated chunks (retries) are tolerated; missing
    chunk indices and seq gaps are reported so export can flag incomplete sessions.
    """
    issues, events, seen = [], [], set()
    ordered = sorted(chunks, key=lambda c: c["i"])
    expected_i = 0
    last_seq = None
    for c in ordered:
        if c["i"] in seen:
            issues.append(f"duplicate chunk {c['i']}")
            continue
        seen.add(c["i"])
        if c["i"] != expected_i:
            issues.append(f"missing chunk(s) {expected_i}..{c['i'] - 1}")
        expected_i = c["i"] + 1
        decoded = decode_chunk(c)
        if len(decoded) != c["n_events"]:
            issues.append(f"chunk {c['i']}: n_events {c['n_events']} != {len(decoded)} decoded")
        if last_seq is not None and decoded and decoded[0]["seq"] != last_seq + 1:
            issues.append(f"seq gap before chunk {c['i']}: {last_seq} -> {decoded[0]['seq']}")
        if decoded:
            last_seq = decoded[-1]["seq"]
        events.extend(decoded)
    return events, issues


def has_nested_array(node, inside_array=False):
    """True if a JSON value contains an array directly inside an array (Firestore rejects these)."""
    if isinstance(node, list):
        if inside_array:
            return True
        return any(has_nested_array(v, True) for v in node)
    if isinstance(node, dict):
        return any(has_nested_array(v, False) for v in node.values())
    return False
