# Timing: what is measured, how, and what is not known

The framework stamps every event with the page clock (`performance.now()`). This page says what
those stamps mean, how to measure the delays around them, and what has been measured so far.
**No claim is made about display or trigger latency on any device until the hardware procedure
below has been run on that device.**

## How phases are timed

Durations are counted in display frames (`pipeline/frames.js`). A phase of `duration: 100` on a
60 Hz display is 6 frames; `{frames: 6}` says the same thing directly. The refresh rate is measured
at the start of every session (`device.refresh_hz_est` in the session record), so the same YAML
gives the right frame count on 60, 120 or 144 Hz displays.

A phase ends inside the animation-frame callback of the frame that completes its count, and the
next phase is drawn in the same callback, so it is painted in that same frame: no gap, and no extra
rounding where one phase hands over to the next. Both events carry that frame's timestamp. Each
phase counts its frames from its own onset frame, so a frame that arrives late delays what follows
by that much and the phases keep their lengths. A response ends a phase when the response arrives,
which is between frames, so the next phase is painted in the following frame.

Not covered: nothing can make a frame arrive on time. If the main thread is blocked, a frame is late;
the phase then lasts one frame more than planned, which shows in the log (`frames` in `phase.offset`
differs from `planned_frames` in `phase.onset`). Background tabs stop animation frames altogether.
Phases without a duration (waiting for a response) and the instructions pages use ordinary timers.

## What the stamps mean

| Stamp | Meaning |
|---|---|
| `phase.onset` `t` | the `requestAnimationFrame` timestamp of the frame in which the stimulus is first painted: the start of that frame. The light leaves the screen later (rest of the frame, compositor, scanout, panel). |
| `phase.onset` `data.t_dom` | when the page was changed, a little after the frame start. |
| `phase.offset` `t`, `actual_ms`, `frames` | the frame timestamp of the frame that ended the phase; `actual_ms` is that minus the onset stamp; `frames` is how many frames that is. |
| `input.*` `t` | the browser's `event.timeStamp` of the input (when the browser received it). |
| `trigger.sent` `t_event` / `t_sent` | the stamp of the event that caused the trigger, and the clock when the write to the sink was issued. The signal leaves the computer later (serial driver, USB, relay). |

Because the frame timestamp is the start of the frame and is taken before the callback runs, an event
can carry a `t` a few milliseconds earlier than events emitted before it in the same callback. Order
by `seq`, not by `t`.

## Hardware procedure (the one that measures display and trigger latency)

You need: a photodiode (or light sensor) taped to the bottom-left corner of the screen, the
trigger line you will really use (the EEG amplifier's trigger input, or a TTL strobe from the
trigger box), and a recorder that samples both on one clock at 1 kHz or faster (the EEG
amplifier's analog inputs, an oscilloscope, or a DAQ).

1. `expfw init timing-run --template timing`, then `expfw serve timing-run`, and open the page on
   **the device and browser you will use for the study**, in full screen, at its normal brightness
   and with the same background load you will have in the study.
2. Edit `timing-run/experiment.yaml` if the trigger goes through a relay (a websocket sink) rather
   than Web Serial. The project shows 300 black / white flashes of 100 ms with a 100 ms gap. Each
   one sends one trigger byte and flips the photodiode patch (`overlay.photodiode`, toggle mode).
3. Start the recording, then run the page. Save the recording as CSV with a header row:
   `time_s,photodiode,trigger` (seconds, then one column per channel).
4. `node tools/timing/analyze.js recording.csv` prints the distribution of
   *photodiode edge − trigger edge* in milliseconds (median, p95, p99, max) and the sample interval
   of the recording, which is the resolution of the result. Positive means the screen changed
   after the trigger line went high.
5. Report the distribution with the device, browser and version, operating system, refresh rate
   and display, and the trigger path. Repeat on each device class you will use (a laptop, a phone
   and a tablet are different classes).

`tools/timing/analyze.js` is tested on synthetic signals only (`tools/timing/analyze.test.js`); it
has not yet been run on a real recording.

## Software-only measurements (reproducible; `node tools/timing/measure.js`)

`measure.js` runs the same timing project through the real framework in headless Chromium with
recording fake devices and reports what the framework can see of its own scheduling. It
measures software scheduling, **not** display latency (there is no display and no photodiode) and not
the real serial path. These numbers describe this test setup (headless Chromium on one Windows
machine) and should not be assumed to hold on a lab machine.

Before frame-locking (timer-based durations, same machine, same project) the rows below read: stimulus
duration minus planned, median +11 ms (p95 +24, max +31); onset-to-onset interval minus 200 ms, median
+17 ms (p95 +50, max +67). Frame-locking removed that stretch; the table is the current state.

<!-- results:start -->
- Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36
- Platform: Win32, screen 1280 x 720 @ 1x, estimated refresh 59.9 Hz
- Framework 0.1.0, headless Chromium driven by Playwright, no physical display attached

| Measure | n | min | median | p95 | p99 | max |
|---|---|---|---|---|---|---|
| onset stamp - DOM update (frame start vs. page write) | 300 | -17.10 | -8.00 | -3.50 | -3.00 | -2.70 |
| stimulus duration - planned (100 ms) | 300 | -0.10 | 0.00 | 0.10 | 0.10 | 0.10 |
| onset-to-onset interval - 200 ms | 299 | -0.10 | 0.00 | 0.10 | 0.10 | 0.10 |
| trigger written - onset stamp | 300 | 2.90 | 8.10 | 11.71 | 13.73 | 20.87 |
| idle blank page: requestAnimationFrame interval (nominal 16.67) | 598 | 16.50 | 16.70 | 16.70 | 16.80 | 33.30 |

All values are milliseconds. The first column of numbers is how many events were measured.

Flashes that lasted a different number of frames than planned (a late frame): 0 of 300.
<!-- results:end -->

How to read the rows:

- *onset stamp − DOM update*: the onset stamp is the start of a frame; the page is written a few
  milliseconds later inside that frame's callback, so this is negative. It is not a latency; it shows
  how far into the frame the page was written.
- *stimulus duration − planned*: how long a 100 ms stimulus stayed up, minus 100.
- *onset-to-onset interval − 200 ms*: the rhythm of the sequence against the planned 200 ms.
- *trigger written − onset stamp*: from the onset stamp to the moment the write to the sink was
  issued (a recording fake here, so no device time is included).
- *idle blank page*: the frame interval of an empty page in the same browser, to show the cadence
  the environment itself provides.

## What this means for experiments

- Planned and actual stimulus durations, and the rhythm of sequences, agree to the timestamp
  precision as long as no frame is late. Late frames are counted in the log (`frames` against
  `planned_frames`); count them in your own data and decide what to do with those trials.
- Use the photodiode procedure above to learn the fixed delay between trigger and light on your
  device. The software cannot see it.
- The next phase is built and drawn inside the same frame callback that ends the previous one, so a
  stimulus that takes long to build (a heavy custom generator) or to decode (a large image) can make
  that frame late. Nothing is prepared in advance yet; keep stimuli light and preload large images.
