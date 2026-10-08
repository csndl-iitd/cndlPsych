// The script a user's index.html loads (`<script type="module" src="expfw/boot.js">`).
// It starts the experiment in the page's stage element (`<div id="expfw">`, or the body
// when there is none), reading the YAML files that sit next to index.html.
import { surveyCss } from '../framework/authoring/modules/survey-css.js';
import { boot } from '../framework/runtime/boot.js';
import { schemas } from './schemas.js';

function stageRoot() {
  const found = document.getElementById('expfw');
  if (found) return found;
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

/** Resolves with the session result when the experiment ends (also available as `window.expfw.finished`). */
// A module script runs after the document is parsed, so the stage element exists.
// `services`, `store` and `plan` are a handle for tools (`expfw dry-run`) and for debugging in the console.
window.expfw = {};
window.expfw.finished = boot({
  root: stageRoot(), url: './', schemas, styles: [surveyCss],
  onReady: (services, store, plan) => Object.assign(window.expfw, { services, store, plan }),
});
