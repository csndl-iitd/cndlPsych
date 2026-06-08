# Psychophysics Experiment Platform Template

A modern, high-performance, and modular web-based psychophysics experiment platform. This template leverages **jsPsych** (v8) for trial sequencing, **Firebase Firestore** for cloud data syncing, **WebSerial/WebUSB/WebSockets** for hardware/event triggering, and web media APIs for **synchronized webcam and screen recording**.

Use this repository as a boilerplate to develop, configure, and deploy BIDS-compatible psychology and cognitive science experiments.

---

## Table of Contents
1. [Getting Started & Local Development](#1-getting-started--local-development)
2. [Firebase Setup & Configuration](#2-firebase-setup--configuration)
3. [Experiment Settings & UI Controls](#3-experiment-settings--ui-controls)
4. [Building the Timeline (`timeline.yaml`)](#4-building-the-timeline-timelineyaml)
5. [Code-Free Surveys & Forms (`forms.yaml`)](#5-code-free-surveys--forms-formsyaml)
6. [BIDS Compatibility & Minimal Required Forms](#6-bids-compatibility--minimal-required-forms)
7. [Creating Coded Blocks](#7-creating-coded-blocks)
8. [Hardware Triggers & Event Logging](#8-hardware-triggers--event-logging)
9. [How to Write Custom Receivers](#9-how-to-write-custom-receivers)
10. [Example Trigger Receivers](#10-example-trigger-receivers)
11. [Setup Notes & Best Practices](#11-setup-notes--best-practices)

---

## 1. Getting Started & Local Development

This template is designed to run directly in the browser with minimal build tooling. All dependencies are loaded via CDNs (jsPsych plugins, js-yaml, Firebase, etc.).

### Local Setup
To run the project locally, serve the directory using a local development server (such as `npm run dev`, `live-server`, or the VS Code Live Server extension). Serving over HTTP/HTTPS is required for ES Modules and Web Media APIs to function.

```bash
# Example serving with python
python -m http.server 8000
```

### Directory Structure
```
├── index.html              # Main application entrypoint and settings UI
├── forms.yaml              # Configuration for code-free surveys
├── timeline.yaml           # Experiment block sequence configuration
├── stimuli.yaml            # Stimuli assets and trial templates
├── styles/
│   └── main.css            # Platform styles (glassmorphism UI)
└── src/
    ├── main.js             # UI Controller and configuration state
    ├── experiment.js       # Central jsPsych initialization and execution engine
    ├── firebase.js         # Firebase Cloud Firestore integration
    ├── logger.js           # Central event bus and trigger dispatcher
    ├── media.js            # Webcam and screen recorder controllers
    ├── triggers.js         # WebSerial, WebUSB, and WebSocket controllers
    └── blocks/             # Experiment blocks (modules)
        ├── survey.js       # Code-free survey generator
        ├── keyboard_task.js # Template-driven keyboard response task
        └── stroop.js       # Custom-coded Stroop task
```

---

## 2. Firebase Setup & Configuration

The platform uses Firebase Firestore to log participant data, session logs, and trial metrics in real-time.

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** and follow the setup prompts.
3. In your project dashboard, navigate to **Build > Firestore Database** and click **Create Database**. Start in **production mode** or **test mode**.

### Step 2: Configure Firestore Security Rules
Ensure your security rules allow document creation and updates. You can use the configuration defined in [firestore.rules](firestore.rules):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /participants/{document} {
      allow read, write: if true;
    }
    match /sessions/{document} {
      allow read, write: if true;
    }
    match /trials/{document} {
      allow create: if true;
      allow read: if false;
    }
    match /experiment_events/{document} {
      allow create: if true;
      allow read: if false;
    }
  }
}
```

### Step 3: Link Project Credentials
When launching the application locally:
1. Enter your Firebase project credentials (`API Key`, `Auth Domain`, and `Project ID`) in the **Firebase Configuration** panel of the Settings UI.
2. Click **Save Config**. The credentials will save locally in your browser's `localStorage` (under the key `cndlpsych_config`) and connect to Firestore.
3. If connection succeeds, the badge changes to `Configured` or `Local Mode`.

> [!NOTE]
> **Local-Only Mode:** If you do not want to sync data to the cloud, uncheck **Enable Firestore Recording**. The platform will run in a standalone local mode, and you can download all results locally as a CSV at the end of the experiment.

---

## 3. Experiment Settings & UI Controls

Before starting an experiment, the configuration dashboard allows you to configure hardware, recording, and debugging parameters:

*   **Trigger Mechanisms**: Used to send onset markers to external recording hardware (e.g. EEG, fNIRS, Eye-trackers).
    *   `WebSerial (PC)`: Communicates with local COM ports at **115,200 Baud**.
    *   `WebUSB (Android)`: Communicates directly with USB devices via raw WebUSB protocols.
    *   `WebSocket`: Dispatches JSON payloads (containing timestamp and value) to a custom websocket server URL (e.g., `ws://localhost:8080`).
    *   `Trigger Format`: Select between sending values as a **Character** (e.g., `"10\n"`) or a **Raw Hex Byte** (e.g., `0x0A`).
*   **Media Recording**:
    *   Check `Record Webcam` and/or `Record Screen` to record behavior/responses.
    *   Click **Request Permissions** to initialize user permission prompts.
    *   **Target FPS Controls**: Configure custom target framerates for your webcam and screen capture. The UI displays the hardware ranges supported by the current user media device.
*   **Data Downloads**: On experiment completion, the **Done Panel** provides downloads for:
    *   `Download CSV Data` (jsPsych trial-by-trial logs)
    *   `Download Webcam Recording` (WebM video format)
    *   `Download Screen Recording` (WebM video format)

---

## 4. Building the Timeline (`timeline.yaml`)

The structure of the experiment is defined entirely inside [timeline.yaml](timeline.yaml). The central engine (`experiment.js`) parses this file, imports the corresponding JS modules dynamically from `src/blocks/`, and feeds them into the jsPsych timeline.

### Schema
```yaml
blocks:
  - id: "unique_block_id"
    module: "js_filename_without_extension"
    config:
      # Block-specific settings passed directly to the module
```

### Example
```yaml
blocks:
  - id: "participant_survey"
    module: "survey"              # Loads src/blocks/survey.js
    config:
      form_id: "participant"      # Renders only the participant form from forms.yaml

  - id: "session_survey"
    module: "survey"
    config:
      form_id: "session"          # Renders only the session form from forms.yaml

  - id: "stroop_task"
    module: "stroop"              # Loads src/blocks/stroop.js
    config:
      repetitions: 2
      randomize: true
      post: [200, 500]            # Random ITI delay range in ms
      fixation_duration: 500
      trial_duration: 2000

  - id: "psychometric_survey"
    module: "survey"
    config:
      form_id: "psychometric"     # Renders only the psychometric form at the end
```

---

## 5. Code-Free Surveys & Forms (`forms.yaml`)

The `survey` block module ([src/blocks/survey.js](src/blocks/survey.js)) generates styled, responsive HTML forms from [forms.yaml](forms.yaml).

### Supported Question Types
1.  `text`: Standard text input field.
2.  `number`: Numeric input field (with min/max bounds like age).
3.  `multi-choice`: Rendered as a list of radio buttons (single selection).
4.  `multi-select`: Rendered as checkboxes (multiple selections, returned joined with `;`).
5.  `dropdown`: Selection box for languages, types, etc.
6.  `likert`: Horizontal scale using radio buttons (ideal for psychometric ratings).

### Features
*   **Timeline Modularity (`form_id` parameter)**: Instead of rendering all surveys in a single bulk block, you can target and run individual surveys separately by defining `form_id: "your_form_id"` under the block's `config` in `timeline.yaml`. This allows you to intersperse forms (e.g., placing the participant/session setup forms at the start and psychometric surveys at the very end) anywhere in the timeline.
*   **Auto-Population**: When typing a participant ID inside the `participant` form, the platform dynamically queries Firestore for existing records under that ID. If matching history is found, fields like age, gender, language, and preferred devices are auto-populated.
*   **Auto-Numbering**: The `session` form queries Firestore database history in the background to automatically identify and pre-fill the next session number (e.g. `ses-02` if `ses-01` already exists) for the participant.

---

## 6. BIDS Compatibility & Minimal Required Forms

To ensure that your experiment is **Brain Imaging Data Structure (BIDS)** compliant, the experiment *must* begin with two minimal forms inside `forms.yaml`: a **Participant Form** and a **Session Form**.

Under the hood, the experiment engine processes these form entries and formats the IDs using the standardized BIDS syntax (padded identifiers):
*   **Participant ID** is saved with the `sub-` prefix (e.g. `sub-004`).
*   **Session Number** is saved with the `ses-` prefix (e.g. `ses-02`).

### Minimal BIDS Form Configuration

Ensure the following two forms are defined at the top of your `forms.yaml`:

```yaml
forms:
  - id: "participant"
    type: "survey-text"
    data:
      phase: "setup"
    questions:
      - prompt: "Participant ID:"
        name: "participant_id"
        required: true
      - prompt: "Age:"
        name: "age"
        type: "text"
        required: true
      - prompt: "Sex:"
        name: "sex"
        type: "multi-choice"
        options:
          - "Male"
          - "Female"
        required: false

  - id: "session"
    type: "survey-text"
    data:
      phase: "setup"
    questions:
      - prompt: "Session Number:"
        name: "session_number"
        required: true
```

These inputs map database links correctly between the `participants` collection, `sessions` metadata, and individual trial metrics inside the `trials` collection.

---

## 7. Creating Coded Blocks

You can write custom, highly specialized experiment blocks in pure Javascript and load them dynamically.

### Coded Block Module Rules
To create a new coded block:
1.  Create a Javascript file under `src/blocks/` (e.g., `src/blocks/n_back.js`).
2.  Your module **must export** an asynchronous function called `createTimeline(blockConfig)`:
    ```javascript
    export async function createTimeline(blockConfig) {
        const timeline = [];
        // Construct and push jsPsych trial configurations to timeline
        return timeline;
    }
    ```
3.  Add the block ID and module name to `timeline.yaml` to include it in the experiment execution path.

> [!WARNING]
> **Dynamic ES Module Caching Gotcha:**
> Modern browsers aggressively cache dynamically imported ES modules (e.g., `await import('./blocks/your_block.js')`) in an internal V8 module registry.
> 
> Even if you edit a custom JavaScript block file on disk and perform a **Hard Reload (Ctrl + F5)**, the browser may continue to run the old cached code from memory.
> 
> **How to bypass:** To ensure code changes to JavaScript blocks take effect immediately during development:
> 1. Open the browser's **Developer Tools (F12)**.
> 2. Navigate to the **Network** tab.
> 3. Check **Disable cache**.
> 4. Keep the Developer Tools panel open while testing.

### Template and Asset Loading
You can fetch stimuli and trial templates from `stimuli.yaml` inside your custom module to decouple visual assets from code:

```javascript
// Fetch and parse templates from stimuli.yaml
const response = await fetch('stimuli.yaml');
const yamlText = await response.text();
const parsed = jsyaml.load(yamlText);
const stimuliList = parsed.stimuli;
```

---

## 8. Hardware Triggers & Event Logging

Centralized logging and event bus logic are managed by [src/logger.js](src/logger.js).

### Logging Events
Events (like trial start/finish, configuration saves, etc.) can be recorded using the centralized `logger` instance. This writes to local console buffers and saves asynchronously to the Firestore `experiment_events` collection:

```javascript
import { logger } from '../logger.js';

// Log custom behavioral details
logger.logEvent('target_reached', { target: 'blue_circle', reactionTime: 345 });
```

### Dispatching Hardware Triggers
For EEG/MEG/fNIRS synchronization, send triggers at critical experimental milestones (e.g., fixation onset, stimulus presentation, participant response):

```javascript
// Send trigger number 11 to the connected device (serial port, USB, or websocket)
logger.dispatchTrigger(11);
```

### Under the Hood: Trigger Implementations
Depending on your configuration in the UI settings panel, trigger dispatching behaves differently:

#### A. Serial Port (WebSerial & WebUSB)
When running in `WebSerial` or `WebUSB` mode, the platform writes raw data directly to the device interface:
*   **Character Format:** Converts the value to a string, appends a newline character (`\n`), and transmits the ASCII/UTF-8 encoded bytes. For example, sending trigger `11` transmits `[49, 49, 10]`.
*   **Hex Format:** Directly transmits the value as a single, unsigned 8-bit byte. For example, sending trigger `11` transmits `[11]` (which is `0x0B`).

#### B. WebSockets
When running in `WebSocket` mode, the platform dispatches a JSON-stringified packet containing timing and numeric metadata:
*   **Character Format:** Sends `{"trigger": "11\n", "time": <performance_now_timestamp>}`.
*   **Hex Format:** Sends `{"trigger": 11, "hex": "0x0B", "time": <performance_now_timestamp>}`.

> [!NOTE]
> **Understanding the `time` (time_offset) Parameter:**
> The `time` value sent in WebSocket packets is captured using the browser's `performance.now()` API immediately before transmission. This timestamp represents the exact millisecond offset (with microsecond precision) relative to when the experiment page loaded.
>
> **Why this matters:** WebSocket transmission is asynchronous and prone to operating system context-switching or network queueing delays (jitter). By capturing the timestamp in the browser immediately at trigger invocation, the Python receiver can record the *exact* moment the event happened on the screen, compensating for any network transmission lag.

#### Standard Marker Key (Example System):
*   `10`: Fixation Cross Onset
*   `11`: Congruent Stimulus Onset
*   `12`: Incongruent Stimulus Onset
*   `21`: Correct Response Registered
*   `22`: Incorrect Response Registered
*   `23`: Response Timeout

---

## 9. How to Write Custom Receivers

If you are writing your own script, software interface, or hardware firmware (e.g., for Arduino, LabStreamingLayer, or custom EEG software) to receive triggers, you should follow these protocol rules:

### A. Implementing a Serial Port Receiver
*   **Baud Rate & Settings:** Configure your serial port connection to **115,200 Baud**, 8 data bits, no parity, and 1 stop bit (8N1).
*   **Handling Character Format:** 
    *   The platform sends the trigger as an ASCII string followed by a newline byte (`10` / `0x0A` / `\n`).
    *   **Implementation:** Accumulate incoming bytes into a buffer until you read the byte `10`. Then, decode the buffer (excluding the newline) as a UTF-8/ASCII string, strip whitespace, and parse the resulting text as an integer.
*   **Handling Hex Format:** 
    *   The platform sends a single, raw unsigned 8-bit byte representing the trigger value directly.
    *   **Implementation:** Read individual bytes directly as they arrive. Each byte represents the integer trigger value (e.g., receiving `0x5A` translates directly to decimal trigger `90`).

### B. Implementing a WebSocket Server Receiver
*   **Network Role:** Your receiver must run a **WebSocket server** listening on a port configured in the platform (e.g., `ws://localhost:8080`). The browser experiment acts as the client and establishes the connection.
*   **Data Format:** The browser sends all messages as text frames containing a JSON-stringified object.
*   **Parsing JSON Objects:**
    *   **In Character Mode:** The JSON object contains:
        *   `trigger` (string): The trigger value with a trailing newline (e.g., `"11\n"`).
        *   `time` (number): Browser-side high-resolution time offset in milliseconds.
    *   **In Hex Mode:** The JSON object contains:
        *   `trigger` (number): The integer trigger value (e.g., `11`).
        *   `hex` (string): The hexadecimal string representation (e.g., `"0x0B"`).
        *   `time` (number): Browser-side high-resolution time offset in milliseconds.

---

## 10. Example Trigger Receivers

The [`examples/`](examples) folder contains utility Python scripts implementing the logic above:

*   **Serial/COM Port Receiver ([read_serial_triggers.py](examples/read_serial_triggers.py))**: Listens on a local serial interface (Virtual COM port) for markers. Handles both character buffering and raw byte processing.
*   **WebSocket Server Receiver ([read_websocket_triggers.py](examples/read_websocket_triggers.py))**: Runs a local WebSocket server that receives JSON packets containing triggers, hex values, and high-resolution timestamps.

See the header documentation inside each script for installation requirements and usage guidelines.

---

## 11. Setup Notes & Best Practices

Depending on the device running the experiment, use these guidelines to configure your environment:

### Setup for Smartphone-Based Experiment Devices
*   **WebUSB for Direct Hardware Triggering** `**[Android]**`**:**
    *   To trigger external hardware (e.g., Arduinos or serial controllers) directly from a smartphone, connect the device to the phone's charging port using a **USB OTG (On-The-Go) cable/adapter**.
    *   *Note on iOS:* iOS (Safari and other browsers) does not support WebUSB due to platform sandbox limitations. This direct method is only compatible with Android browsers like Chrome.
*   **Wired USB Trigger Relay (USB Tethering / Hotspot + WebSocket)** `**[Android / iOS]**`**:**
    *   If you need to send triggers from a smartphone to a host PC running recording/analysis software (without intermediate microcontrollers or local Wi-Fi):
        1. Connect the phone to the PC with a USB cable.
        2. Enable wired network sharing:
            *   **Android:** Enable **USB Tethering** in your phone Settings (under *Network & Internet > Hotspot & Tethering*).
            *   **iOS:** Enable **Personal Hotspot** under settings and connect the iPhone to the PC via USB (on Windows, this requires iTunes/Apple USB drivers installed).
        3. Identify the IP address of this tethered/hotspot interface on the PC (e.g., via `ipconfig` on Windows or `ifconfig` on macOS/Linux).
        4. Run `read_websocket_triggers.py` on the PC, binding it to that interface IP.
        5. Enter `ws://<PC_INTERFACE_IP>:8080` in the experiment settings on the phone. Triggers will be transmitted over the wired USB connection.
*   **Wireless Triggering (Wi-Fi + WebSocket)** `**[Android / iOS]**`**:**
    *   Ensure the smartphone and the recording PC are on the same local Wi-Fi network.
    *   Run the Python WebSocket server on the PC and enter the PC's Wi-Fi network IP address in the phone's experiment dashboard.

### Setup for PC-Based Experiment Devices
*   **WebSerial for Direct Connection:**
    *   **Browser Support:** WebSerial is supported on desktop versions of Chrome, Edge, and Opera. Firefox and Safari do not currently support the WebSerial API.
    *   **Driver Setup:** When connecting to microcontrollers or serial adapters (like USB-to-TTL boards), ensure the proper manufacturer drivers (e.g., FTDI, Silicon Labs CP210X, WCH CH340) are installed on the OS so the device enumerates as a standard COM port (Windows) or `/dev/tty` node (macOS/Linux).
*   **Virtual COM Ports for Local App Integration (WebSerial + com0com):**
    *   To relay triggers to other local programs on the same PC via serial emulation without physical hardware:
        1. Install a virtual null-modem serial port emulator such as **`com0com`** (Windows) or set up a pseudo-terminal pair (macOS/Linux).
        2. Create a linked virtual COM port pair (e.g., `COM10` <-> `COM11`).
        3. In the experiment settings UI, choose **WebSerial**, click **Connect Device**, and select one end of the pair (e.g., `COM10`).
        4. Configure your receiver script or recording software (e.g., `read_serial_triggers.py`) to listen on the other end of the pair (e.g., `COM11`).
*   **WebSockets for Local Application Integration:**
    *   If you want to feed markers to other desktop software running on the same PC (such as LabStreamingLayer or Python scripts) via TCP connections:
        1. Run `read_websocket_triggers.py` locally on the computer.
        2. Set the trigger mode to **WebSocket** in the browser dashboard and configure the URL to `ws://localhost:8080`.


