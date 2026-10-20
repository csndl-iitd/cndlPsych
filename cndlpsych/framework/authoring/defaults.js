// Framework defaults: the lowest level of the input cascade, plus built-in names.

export const BUILTIN_PROFILES = ['desktop', 'phone', 'tablet'];
export const BUILTIN_MODULES = ['response_task', 'survey', 'instructions'];

/** Intents that need no binding: any input / no input. */
export const BUILTIN_INTENTS = ['any', 'none'];

export const BUILTIN_FIELDS = {
  subject: ['subject_id', 'sex', 'age'],
  session: ['session_id'],
};

export const CAMERA_CONSENT = {
  id: 'camera',
  text: 'I agree to my camera being used to estimate where I am looking. No video is recorded or stored.',
  required: true,
};

/** The consent statement added when the webcam is recorded (the experiment's own statement with the same id replaces it). */
export const webcamConsent = (audio) => ({
  id: 'webcam',
  text: `I agree to video${audio ? ' and sound' : ''} of me being recorded with my camera during the session, and to this recording being given to the researchers.`,
  required: true,
});

/** Level 0 of the input cascade (an ordinary scope, so it merges like any other). */
export const INPUT_DEFAULTS = {
  profiles: {
    '*': {
      gestures: ['tap'],
      fire_on: 'up',
      show_zones: false,
      cursor: { autohide_ms: 1000, show_on_move_px: 3 },
    },
  },
};
