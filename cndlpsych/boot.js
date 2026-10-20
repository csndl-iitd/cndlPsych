// What index.html loads: <script src="cndlpsych/boot.js"></script>
//
// A plain script (not a module) because it has to tell the browser where the third-party modules
// are (an import map) before the first module is loaded. It then loads the survey stylesheet and
// starts the framework (start.js). Nothing here depends on the experiment.
//
// The list below must match bundle/vendor.js; tools/dist.test.js checks that it does.
(function loadFramework() {
  const folder = new URL('.', document.currentScript.src).href; // .../cndlpsych/
  const vendor = (file) => `${folder}vendor/${file}`;

  const imports = {
    jspsych: vendor('jspsych.js'),
    '@jspsych/plugin-html-keyboard-response': vendor('jspsych-plugin-html-keyboard-response.js'),
    '@jspsych/plugin-survey': vendor('jspsych-plugin-survey.js'),
    'js-yaml': vendor('js-yaml.js'),
    ajv: vendor('ajv.js'),
    // The Firebase SDK is one file; it is only fetched if storage.firebase is enabled.
    'firebase/app': vendor('firebase.js'),
    'firebase/auth': vendor('firebase.js'),
    'firebase/firestore': vendor('firebase.js'),
    'firebase/app-check': vendor('firebase.js'),
    // The eye tracking add-on is a separate folder next to cndlpsych/ and is only fetched if eye tracking runs.
    webgazer: new URL('../cndlpsych-eyetracking/webgazer.js', folder).href,
  };

  const importMap = document.createElement('script');
  importMap.type = 'importmap';
  importMap.textContent = JSON.stringify({ imports });
  document.head.append(importMap);

  const surveyStyles = document.createElement('link');
  surveyStyles.rel = 'stylesheet';
  surveyStyles.href = vendor('jspsych-plugin-survey.css');
  document.head.append(surveyStyles);

  const start = document.createElement('script');
  start.type = 'module';
  start.src = `${folder}start.js`;
  document.head.append(start);
}());
