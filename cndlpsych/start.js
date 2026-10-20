// Starts the experiment in the page: loads the schemas the compiler checks the YAML against, then
// runs the framework on the files next to index.html. Loaded by boot.js.
import { boot } from './framework/runtime/boot.js';

const schemaFolder = new URL('./schemas/', import.meta.url);

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);
  return response.json();
}

/** schemas/index.json lists the schema files; the result is {file name: parsed schema}. */
async function loadSchemas() {
  const names = await fetchJson(new URL('index.json', schemaFolder));
  const entries = await Promise.all(names.map(async (name) => [name, await fetchJson(new URL(name, schemaFolder))]));
  return Object.fromEntries(entries);
}

function stageRoot() {
  const found = document.getElementById('cndlpsych');
  if (found) return found;
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

// `services`, `store` and `plan` are a handle for tools (`cndlpsych dry-run`) and for the console.
window.cndlpsych = {};
window.cndlpsych.finished = loadSchemas().then((schemas) => boot({
  root: stageRoot(),
  url: './',
  schemas,
  onReady: (services, store, plan) => Object.assign(window.cndlpsych, { services, store, plan }),
}));
