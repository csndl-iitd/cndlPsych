// The look of everything the participant reads: one font, a dark palette to match the dark stage,
// compact forms, and scrolling for anything taller than the screen. It is injected once, before the
// experiment's own styles, so `stage.font`, `stage.background` and stimulus styles in the YAML win.
//
// The survey library (SurveyJS, behind every form and consent screen) is themed through its CSS
// variables; the rules after them are what the variables cannot do (no card frames, tight rows).

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PALETTE = {
  '--sjs-base-unit': '5px',
  '--sjs-font-size': '15px',
  '--sjs-corner-radius': '6px',
  '--sjs-font-family': FONT,
  '--sjs-general-backcolor': '#11151c',
  '--sjs-general-backcolor-dim': 'transparent',
  '--sjs-general-backcolor-dim-light': '#161b24',
  '--sjs-general-backcolor-dim-dark': '#1d2330',
  '--sjs-general-forecolor': '#e8eaee',
  '--sjs-general-forecolor-light': '#a3acbb',
  '--sjs-general-dim-forecolor': '#e8eaee',
  '--sjs-general-dim-forecolor-light': '#a3acbb',
  '--sjs-primary-backcolor': '#6aa5ff',
  '--sjs-primary-backcolor-light': 'rgba(106, 165, 255, 0.18)',
  '--sjs-primary-backcolor-dark': '#4d8df0',
  '--sjs-primary-forecolor': '#08111f',
  '--sjs-border-default': '#3b4352',
  '--sjs-border-light': '#2a313d',
  '--sjs-border-inside': '#2a313d',
  '--sjs-editor-background': '#161b24',
  '--sjs-editorpanel-backcolor': '#161b24',
  '--sjs-editorpanel-hovercolor': '#1d2330',
  '--sjs-question-background': 'transparent',
  '--sjs-questionpanel-backcolor': 'transparent',
  '--sjs-questionpanel-hovercolor': 'transparent',
  '--sjs-special-red': '#ff8080',
  '--sjs-special-red-light': 'rgba(255, 128, 128, 0.14)',
  '--sjs-shadow-small': 'none',
  '--sjs-shadow-medium': 'none',
  '--sjs-shadow-large': 'none',
  '--sjs-shadow-inner': 'inset 0 0 0 1px #5f6a7d', // the ring around radio buttons and checkboxes
  '--sjs-font-questiontitle-color': '#e8eaee',
  '--sjs-font-questiondescription-color': '#a3acbb',
  '--sjs-font-pagetitle-color': '#e8eaee',
  '--sjs-font-pagedescription-color': '#a3acbb',
  '--sjs-font-editorfont-color': '#e8eaee',
  '--sjs-font-editorfont-placeholdercolor': '#7d8696',
};
// SurveyJS writes its own values into the style attribute of its root element; !important wins over that.
const PALETTE_CSS = Object.entries(PALETTE).map(([name, value]) => `  ${name}: ${value} !important;`).join('\n');

export const THEME_CSS = `
/* ---- the page: one font for stimuli, instructions and forms ---- */
.cndlpsych-stage {
  font-family: ${FONT};
  line-height: 1.5;
}

/* ---- the display holds what is on screen. A form taller than the screen scrolls, by wheel, keys or touch.
        The child centres itself with auto margins, which (unlike align-items) never pushes the top out of reach. ---- */
.cndlpsych-display {
  position: absolute;
  inset: 0;
  display: flex;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  -webkit-user-select: text;
  user-select: text;
}
.cndlpsych-display > * {
  margin: auto;
  max-width: 100%;
}

/* ---- survey palette (dark) and size (compact) ---- */
.cndlpsych-display,
.cndlpsych-display .sd-root-modern {
${PALETTE_CSS}
  color: var(--sjs-general-forecolor);
}

/* ---- forms: no cards, tight rows ---- */
/* A form's wrappers span the display, so the form column can centre itself. (Other content shrink-wraps and the display centres it.) */
.cndlpsych-display .jspsych-content-wrapper:has(.jspsych-survey-container),
.cndlpsych-display .jspsych-content:has(.jspsych-survey-container) { width: 100%; max-width: none; }
/* The plugin gives its container an inline min-width of 800px; a form is a narrow column. */
.cndlpsych-display .jspsych-survey-container {
  width: min(100vw, 36rem);
  min-width: 0 !important;
  max-width: 100vw;
  margin: 0 auto;
}
.cndlpsych-display .sd-root-modern {
  width: 100%;
  min-height: 0;
  background: transparent;
}
.cndlpsych-display .sd-root-modern--full-container { min-height: 0; }
.cndlpsych-display .sd-body,
.cndlpsych-display .sd-body.sd-body--static { width: 100%; max-width: none; margin: 0; padding: 12px 16px; box-sizing: border-box; }
.cndlpsych-display .sd-page { padding: 0; }
.cndlpsych-display .sd-row { margin-top: 0; }
.cndlpsych-display .sd-row:not(:first-child) { margin-top: 10px; }
.cndlpsych-display .sd-element--with-frame,
.cndlpsych-display .sd-element--complex,
.cndlpsych-display .sd-question--complex {
  border: 0;
  box-shadow: none;
  padding: 0;
  background: transparent;
}
.cndlpsych-display .sd-question__header { padding-bottom: 4px; }
.cndlpsych-display .sd-question__title { font-size: 15px; font-weight: 600; }
.cndlpsych-display .sd-question__content { padding: 0; }
.cndlpsych-display .sd-item__control-label,
.cndlpsych-display .sd-selectbase__label { font-size: 15px; }
.cndlpsych-display .sd-input { padding: 6px 10px; min-height: 0; line-height: 1.4; }
.cndlpsych-display .sd-html,
.cndlpsych-display .sd-html * { font-size: 15px; line-height: 1.5; }
.cndlpsych-display .sd-root-modern h1 { font-size: 1.5em; }
.cndlpsych-display .sd-root-modern h2 { font-size: 1.25em; }
.cndlpsych-display .sd-root-modern h3 { font-size: 1.1em; }
.cndlpsych-display .sd-root-modern h1,
.cndlpsych-display .sd-root-modern h2,
.cndlpsych-display .sd-root-modern h3 { margin: 0.2em 0 0.4em; line-height: 1.25; }
.cndlpsych-display .sd-html p { margin: 0.4em 0; }
.cndlpsych-display .sd-navigation__complete-btn,
.cndlpsych-display .sd-btn { padding: 8px 22px; min-height: 0; }
.cndlpsych-display .sd-action-bar,
.cndlpsych-display .sd-footer { margin-top: 12px; padding: 0; }
.cndlpsych-display .sd-title.sd-container-modern__title { padding: 8px 16px 0; background: transparent; box-shadow: none; }
/* Question titles: the library sets the wrapper to font-size 0 and sizes the text through rules that radio-group titles miss. */
.cndlpsych-display .sd-question__title .sv-string-viewer,
.cndlpsych-display .sd-element__title .sv-string-viewer { font-size: 15px; }
.cndlpsych-display .sd-container-modern__title .sd-title { color: var(--sjs-general-forecolor); }
.cndlpsych-display .sd-container-modern__title,
.cndlpsych-display .sd-container-modern__title .sd-title,
.cndlpsych-display .sd-container-modern__title .sv-string-viewer { font-size: 19px; font-weight: 600; line-height: 1.3; }
.cndlpsych-display .sd-selectbase { margin: 0; padding: 0; }
.cndlpsych-display .sd-selectbase__item { margin: 0 14px 0 0; padding: 0; }
`;
