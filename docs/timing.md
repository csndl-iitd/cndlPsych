# Timing: what is measured, how, and what is not known

The framework stamps every event with the page clock (`performance.now()`). This page says what
those stamps mean, how to measure the delays around them, and what has been measured so far.
**No claim is made about display or trigger latency on any device until the hardware procedure
below has been run on that device.**

## What the stamps mean

| Stamp | Meaning |
|---|---|
| `phase.onset` `t` | the `requestAnimationFrame` timestamp of the first frame after the stimulus was put in the page: the start of the frame in which it can first be painted. The light leaves the screen later (rest of the frame, compositor, scanout, panel). |
| `phase.onset` `data.t_dom` | when the page was changed, just before. |
| `phase.offset` `actual_ms` | clock time at the end of the phase minus the onset stamp. |
| `input.*` `t` | the browser's `event.timeStamp` of the input (when the browser received it). |
| `trigger.sent` `t_event` / `t_sent` | the stamp of the event that caused the trigger, and the clock when the write to the sink was issued. The signal leaves the computer later (serial driver, USB, relay). |

Stimulus durations in milliseconds are timed by jsPsych with a timer that starts when the stimulus
is loaded, and each phase begins on a frame boundary, so planned and actual durations differ by whole
frames, and the rhythm of a sequence can stretch (see the results; the extra frames are consistent
with a frame of rounding at each step, which has not been confirmed in isolation). The displayed refresh rate is measured at the start of a session
(`device.refresh_hz_est` in the session record) and is used to turn `{frames: n}` durations into
milliseconds; the phases are **not** yet locked to frames.

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
measures software overhead and scheduling, **not** display latency (there is no display and no
photodiode) and not the real serial path. These numbers describe this test setup (headless Chromium on one Windows machine) and
should not be assumed to hold on a lab machine.

<!-- results:start -->
- Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36
- Platform: Win32, screen 1280 x 720 @ 1x, estimated refresh 59.9 Hz
- Framework 0.1.0, headless Chromium driven by Playwright, no physical display attached

| Measure | n | min | median | p95 | p99 | max |
|---|---|---|---|---|---|---|
| onset stamp - DOM update (rAF prediction) | 300 | -16.00 | -3.43 | 8.69 | 10.42 | 13.75 |
| stimulus duration - planned (100 ms) | 300 | -11.45 | 11.19 | 24.02 | 27.41 | 30.91 |
| onset-to-onset interval - 200 ms | 299 | -0.01 | 16.66 | 49.99 | 49.99 | 66.66 |
| trigger written - onset stamp | 300 | 1.33 | 7.72 | 16.24 | 17.60 | 18.06 |
| idle blank page: requestAnimationFrame interval (nominal 16.67) | 601 | 16.60 | 16.70 | 16.70 | 16.80 | 16.80 |

All values are milliseconds. The first column of numbers is how many events were measured.
<!-- results:end -->

How to read the rows:

- *onset stamp − DOM update*: the onset stamp is the start of a frame, which can be earlier than
  the moment the page was changed, so this is not a latency; it shows the size of the frame
  quantisation in the stamp.
- *stimulus duration − planned*: how long a 100 ms stimulus stayed up, minus 100.
- *onset-to-onset interval − 200 ms*: the rhythm of the sequence against the planned 200 ms.
  Differences come in whole frames.
- *trigger written − onset stamp*: from the onset stamp to the moment the write to the sink was
  issued (a recording fake here, so no device time is included).
- *idle blank page*: the frame interval of an empty page in the same browser, to show the cadence
  the environment itself provides.

## What this means for experiments

- Use `{frames: n}` for durations that must be a whole number of frames, and the photodiode
  procedure above to learn the fixed delay between trigger and light on your device.
- Expect planned and actual stimulus durations, and the rhythm of fast sequences, to differ by
  whole frames. Analyse with the recorded `actual_ms` and onset stamps, not the planned values.
- Frame-locked phase scheduling (ending a phase on the frame count rather than on a timer) is not
  implemented. It is the change that would remove the stretch seen in the rhythm row.
