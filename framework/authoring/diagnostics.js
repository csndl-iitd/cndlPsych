// Diagnostics carry a stable code, the file, a YAML path and a human message.
// The same objects feed `cli validate` and (later) the VS Code extension.

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** ['blocks', 3, 'input', 'a.b'] -> 'blocks[3].input["a.b"]' */
export function formatPath(segments) {
  let text = '';
  for (const segment of segments) {
    if (typeof segment === 'number') text += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) text += text ? `.${segment}` : segment;
    else text += `[${JSON.stringify(segment)}]`;
  }
  return text;
}

export function createReporter() {
  const diagnostics = [];
  const seen = new Set();

  function add(severity, code, file, path, message) {
    const diagnostic = { severity, code, file, path: formatPath(path), message };
    const key = `${severity}|${code}|${file}|${diagnostic.path}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(diagnostic);
  }

  return {
    error: (code, file, path, message) => add('error', code, file, path, message),
    warn: (code, file, path, message) => add('warning', code, file, path, message),
    diagnostics,
    get errors() { return diagnostics.filter((d) => d.severity === 'error'); },
    get warnings() { return diagnostics.filter((d) => d.severity === 'warning'); },
  };
}
