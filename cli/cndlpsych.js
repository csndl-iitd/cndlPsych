#!/usr/bin/env node
// The `cndlpsych` command: one entry for the tools in this folder.
//
//   cndlpsych init <dir>            create an experiment from the template
//   cndlpsych validate <dir>        check the YAML (the same checks the editor shows)
//   cndlpsych dry-run <dir>         play the whole experiment with a synthetic participant and print what happened
//   cndlpsych serve <dir>           host it on http://localhost:8080
//   cndlpsych deploy <dir>          publish to Firebase Hosting (and Firestore rules)
//   cndlpsych migrate <dir>         upgrade spec_version
//   cndlpsych export-firestore ...  export Firestore sessions as BIDS
//   cndlpsych relay ...             trigger relay (WebSocket to serial)
//   cndlpsych listen ...            receive triggers on a WebSocket, show them, optionally write a CSV
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const COMMANDS = {
  init: 'init.js', validate: 'validate.js', 'dry-run': 'dry-run.js', serve: 'serve.js', deploy: 'deploy.js', migrate: 'migrate.js',
  'export-firestore': 'export-firestore.js', relay: 'relay.js', listen: 'listen.js',
};

// In a project folder (cndlpsych/cli/) not every tool is there (init is not), and the few third-party
// packages the code imports are found through the hook in register.mjs; in the repository they are in node_modules.
const available = Object.keys(COMMANDS).filter((command) => existsSync(join(import.meta.dirname, COMMANDS[command])));
const hook = join(import.meta.dirname, 'register.mjs');

const [name, ...args] = process.argv.slice(2);
if (!available.includes(name)) {
  console.error(`usage: cndlpsych <${available.join('|')}> [arguments]`);
  process.exit(name === undefined || name === '--help' ? 0 : 2);
}
const run = spawnSync(process.execPath, [...(existsSync(hook) ? ['--import', pathToFileURL(hook).href] : []), join(import.meta.dirname, COMMANDS[name]), ...args], { stdio: 'inherit' });
process.exit(run.status ?? 1);
