cndlpsych 0.0.0: the framework. Do not edit these files; they are replaced when you update.

boot.js        what index.html loads; says where the third-party modules are, then starts start.js
start.js       loads the schemas and runs the framework on the files next to index.html
framework/     the framework's own code, one folder per layer (read ARCHITECTURE.md in the repository)
  foundation/  clock, event bus, matcher, random numbers, session record: depends on nothing
  pipeline/    input, gestures, input mapping, triggers and sinks, frame timing, eye tracking
  stage/       the stage, its layout, cursor and overlays
  storage/     local storage (IndexedDB), Firebase, export formats (BIDS, CSV, JSONL)
  authoring/   the YAML compiler and the modules that run blocks (instructions, response task, survey)
  runtime/     wires everything together and runs a session
schemas/       the JSON Schemas the YAML files are checked against
vendor/        third-party code, one readable file per package (see THIRD-PARTY-LICENSES.txt)
types.d.ts     types for custom stimuli and tasks
cli/           the command line tools (validate, serve, dry-run, deploy, listen, relay, export-firestore, migrate)
firebase/      the Firestore rules and indexes that deploy publishes
package.json   says the files here are ES modules

The tools need Node.js 20.6 or newer. From the folder that holds index.html:

  node cndlpsych/cli/cndlpsych.js validate .         check the YAML files
  node cndlpsych/cli/cndlpsych.js serve .            open http://localhost:8080
  node cndlpsych/cli/cndlpsych.js dry-run .          play it with a synthetic participant (npm install @playwright/test; npx playwright install chromium)
  node cndlpsych/cli/cndlpsych.js listen --ack       show the triggers a websocket sink sends
  node cndlpsych/cli/cndlpsych.js relay --port COM3  websocket to serial port (npm install serialport)
  node cndlpsych/cli/cndlpsych.js deploy .           publish to Firebase Hosting (needs firebase-tools: npx firebase-tools login)
  node cndlpsych/cli/cndlpsych.js export-firestore   Firestore sessions as BIDS (npm install firebase-admin)

The same commands are npm scripts in package.json (npm run validate, npm run serve, ...).
