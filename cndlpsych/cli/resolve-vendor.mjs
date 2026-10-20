// Resolves the third-party modules the tools import to the readable copies in ../vendor/.
const VENDOR = new URL('../vendor/', import.meta.url);
const FILES = { 'js-yaml': 'js-yaml.js', ajv: 'ajv.js' };

export async function resolve(specifier, context, next) {
  if (specifier in FILES) return { url: new URL(FILES[specifier], VENDOR).href, shortCircuit: true };
  return next(specifier, context);
}
