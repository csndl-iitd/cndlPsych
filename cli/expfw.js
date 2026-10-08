#!/usr/bin/env node
// The `expfw` command: one entry for the tools in this folder.
//
//   expfw init <dir>            create an experiment from the template
//   expfw validate <dir>        check the YAML (the same checks the editor shows)
//   expfw dry-run <dir>         play the whole experiment with a synthetic participant and print what happened
//   expfw serve <dir>           host it on http://localhost:8080
//   expfw deploy <dir>          publish to Firebase Hosting (and Firestore rules)
//   expfw migrate <dir>         upgrade spec_version
//   expfw export-firestore ...  export Firestore sessions as BIDS
//   expfw relay ...             trigger relay (WebSocket to serial)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const COMMANDS = {
  init: 'init.js', validate: 'validate.js', 'dry-run': 'dry-run.js', serve: 'serve.js', deploy: 'deploy.js', migrate: 'migrate.js',
  'export-firestore': 'export-firestore.js', relay: 'relay.js',
};

const [name, ...args] = process.argv.slice(2);
if (!COMMANDS[name]) {
  console.error(`usage: expfw <${Object.keys(COMMANDS).join('|')}> [arguments]`);
  process.exit(name === undefined || name === '--help' ? 0 : 2);
}
const run = spawnSync(process.execPath, [join(import.meta.dirname, COMMANDS[name]), ...args], { stdio: 'inherit' });
process.exit(run.status ?? 1);
