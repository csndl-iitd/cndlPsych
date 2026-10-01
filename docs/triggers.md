# Triggers: sinks, formats, the relay, and how to test with real hardware

## What happens at run time

1. **Connect trigger sinks** (after the forms and the device check, before anything is recorded). Serial and USB sinks show a screen with a *Connect* button, because browsers only show their device picker after a click. A websocket sink connects without a screen.
2. A **required** sink (`required: true`, the default) that cannot connect shows *Try again* / *Cancel the session*. Cancelling ends the session and leaves **no recorded data**. An **optional** sink (`required: false`) that cannot connect is skipped: the log gets `sink.status` (`error`) and a `system.warning` (`sink_unavailable`), and its triggers are logged as `trigger.dropped` (`disconnected`).
3. While the session runs, every event on the bus is checked against the trigger rules of the current block / trial. A match sends a message to each target sink and logs `trigger.sent` (with `t_event`, the time of the causing event, and `t_sent`, the time the message was handed to the sink) or `trigger.dropped` (with a reason: `queue_full`, `disconnected`, `out_of_range`, `error`).
4. If a **required** sink is lost during the session, the session stops with an error (`system.error`, `session.end` reason `error`). Pause-and-reconnect is not implemented.
5. At the end, queued triggers are written (and logged) before `session.end`.

`phase.onset` is stamped on the animation frame after the stimulus was put on screen, and the trigger is handed to the sink when that event is delivered. How close that is to the photons is **not measured yet** (M10).

## Formats

| `format` | What is sent | Notes |
|---|---|---|
| `raw` | bytes | No template: one byte, the value. With a template: space-separated hex bytes, where `{value:02x}` stands for the value, e.g. `"AA {value:02x} 55"` sends `AA`, the value, `55`. The value must be 0-255. `reset_after_ms` then writes `reset_value` (default 0) through the same template; a new trigger cancels a pending reset. |
| `ndjson` | one JSON object per line | Fields chosen with `fields` (default `seq, value, event, t_event, t_sent`); available: `seq value event rule t_event t_sent time_origin_ms session_id block trial phase stimulus correct rt_ms profile`. `newline`: `lf` (default), `crlf`, `none`. |
| `template` | text | `{field}` / `{field:spec}` substitution with the same fields, e.g. `"T{value:02x},{stimulus}"`. Spec: `[0][width][.precision][x|X|d|f|s]`. |

`min_gap_ms` (per sink, or `triggers.defaults.min_gap_ms`) keeps a minimum time between writes; `max_queue` (default 256) bounds the queue. `ack: true` records each answer from the receiver as `sink.sync` (round trip, no clock offset). `sync: {pings, interval_s}` (websocket only) estimates the receiver's clock: the page sends `{"ping": id, "t": ms}` and the receiver answers `{"pong": id, "t": <its clock in ms>}`; `offset_ms` is the receiver time minus the page time `t`.

`cli validate` rejects raw templates that are not hex bytes, unknown template fields, values above 255 for raw sinks, one value used for two different events in a block, `sync` on a non-websocket sink, `ack` on USB, and `reset_after_ms` on a text format.

## Browsers

| Sink | Works in | Notes |
|---|---|---|
| `serial` (Web Serial) | desktop Chrome / Edge | Not on phones, Firefox or Safari. |
| `usb` (WebUSB) | Chrome / Edge, including Android | No acknowledgements. |
| `websocket` | every browser | Use it with the relay for phones and other browsers. |

## The relay

```
npm install serialport                      # once; the relay loads it only when it runs
node cli/relay.js --list                    # show serial ports
node cli/relay.js --port COM3 --baud 115200 --json-value --ack
```

The browser connects to `ws://localhost:8765` (a websocket sink). The relay writes to the serial port:

* binary frames (a websocket sink with `format: raw`): the bytes, unchanged;
* text frames: the UTF-8 text unchanged, or with `--json-value` one byte, the integer `value` of an ndjson line (the example project's `lab_ws` sink works with `--json-value`);
* `--ack`: answers `{"ack": true}` after each write, so `ack: true` on the sink measures browser-to-port time;
* `{"ping": ...}` lines are answered with `{"pong": ...}` and never written to the port.

It listens on `127.0.0.1` only. For a page served from another machine use `--host` and `--origin https://your.lab.server` (repeatable) to say which pages may connect.

## Testing with real hardware (what automated tests cannot do)

Automated tests use fake ports and a virtual serial pair; **real EEG amplifiers and the physical delay between the browser and the port are not tested**. To check your own setup:

**1. Loopback (no amplifier).** Use a USB-serial adapter and join its TX and RX pins with a wire. Open a serial monitor (any terminal program, set to a hex view) on a *second* adapter, or use one adapter and read it back with the same port in a small script, so you can see the bytes the browser writes.

1. Run the relay on the port: `node cli/relay.js --port COM3 --json-value --ack`.
2. Serve the project (`npm run play` for the example) and open `http://localhost:4173/?scale=0.2&sinks=example`. The example expects a serial device (the picker appears: choose the adapter) and the relay on port 8765.
3. Click through the entry screens. For every trigger value in `spec/examples/experiment.yaml` you should see that byte on the loopback line (for the serial sink also a `00` reset byte 5 ms later), in the order of `trigger.sent` in `sessionStore.events`.

**2. With the amplifier.** Repeat with the amplifier's trigger input instead of the loopback. Check the values arrive as markers in the recording, that nothing arrives before the first stimulus, and that the reset byte clears the line (some amplifiers need a minimum pulse width: set `reset_after_ms` accordingly, and `min_gap_ms` if triggers can follow each other closely).

**3. Timing.** `t_event` to `t_sent` in the log is only the software hand-off. Photodiode-to-trigger-edge latency is measured in M10; until then do not quote latency figures for a setup.

## Troubleshooting

* *"Web Serial is not available"*: use desktop Chrome or Edge on `https` or `localhost`, or a websocket sink with the relay.
* *"could not connect to ws://..."*: the relay is not running, or another page already holds the port.
* *Nothing is written for some triggers*: look for `trigger.dropped` events and their `reason`.
