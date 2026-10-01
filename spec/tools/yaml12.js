import { load as jsYamlLoad, CORE_SCHEMA, types } from 'js-yaml';

// js-yaml 4 implements YAML 1.2: bare `on`/`off`/`yes`/`no` stay strings, so
// `on:` remains the key "on". The core schema keeps timestamps as strings; the
// sources use `<<` merge keys with anchors, so the merge type is added back.
const SCHEMA = CORE_SCHEMA.extend({ implicit: [types.merge] });

export function loadYaml(text) {
  return jsYamlLoad(text, { schema: SCHEMA });
}
