expfw 0.0.0: the framework. Do not edit these files; they are replaced when you update.

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
