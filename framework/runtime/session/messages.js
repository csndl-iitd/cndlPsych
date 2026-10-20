// Plain full-screen messages for the participant (the end of a session, a refusal, an error).
import { markdownToHtml } from '../../authoring/modules/markdown.js';

/** Replace the display with a centred message written in Markdown. */
export function showMessage(display, markdown) {
  display.innerHTML = `<div class="cndlpsych-message" style="max-width:40em;padding:2em;text-align:center;line-height:1.5">${markdownToHtml(markdown)}</div>`;
}
