import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(testDirectory, '..');

function read(relativePath) {
  return readFileSync(resolve(rootDirectory, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function isSameOriginAsset(value) {
  return Boolean(value)
    && !/^(?:[a-z][a-z\d+.-]*:|\/\/|data:|javascript:)/i.test(value);
}

function assertIndexUsesExternalAssets() {
  const html = read('index.html');

  assert(!/<style\b/i.test(html), 'index.html must not contain a <style> element.');
  assert(!/\sstyle\s*=/i.test(html), 'index.html must not contain style attributes.');
  assert(!/\son[a-z][\w:-]*\s*=/i.test(html), 'index.html must not contain inline event handlers.');

  const scriptTags = html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
  assert(scriptTags.length > 0, 'index.html must load its scripts as external same-origin files.');
  for (const tag of scriptTags) {
    const attributes = parseAttributes(tag.slice(0, tag.indexOf('>') + 1));
    assert(attributes.has('src'), `Inline script element found: ${tag.slice(0, 80)}`);
    assert(isSameOriginAsset(attributes.get('src')), `Script is not same-origin: ${attributes.get('src')}`);

    const body = tag.slice(tag.indexOf('>') + 1, tag.toLowerCase().lastIndexOf('</script'));
    assert(body.trim() === '', `Script with src must not contain inline code: ${attributes.get('src')}`);
  }

  const stylesheetTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of stylesheetTags) {
    const attributes = parseAttributes(tag);
    if ((attributes.get('rel') ?? '').toLowerCase() !== 'stylesheet') {
      continue;
    }
    assert(isSameOriginAsset(attributes.get('href')), `Stylesheet is not same-origin: ${attributes.get('href')}`);
  }
}

function parseCsp(headers) {
  const match = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/mi);
  assert(match, '_headers must define Content-Security-Policy.');

  const directives = new Map();
  for (const segment of match[1].split(';')) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      directives.set(tokens[0], tokens.slice(1));
    }
  }
  return { raw: match[1], directives };
}

function assertDirective(directives, name, expected) {
  const actual = directives.get(name);
  assert(actual, `CSP is missing ${name}.`);
  assert(actual.length === expected.length && expected.every((value) => actual.includes(value)),
    `CSP ${name} must be exactly ${expected.join(' ')}; found ${actual.join(' ')}.`);
}

function assertStrictCsp() {
  const headers = read('_headers');
  const { raw, directives } = parseCsp(headers);

  assert(!/'unsafe-inline'|'unsafe-eval'|\bhttps?:|\*|\bdata:/i.test(raw.replace(/img-src[^;]*/i, '')),
    'CSP must not allow inline/eval code, wildcard sources, or third-party network sources.');
  assertDirective(directives, 'default-src', ["'self'"]);
  assertDirective(directives, 'script-src', ["'self'"]);
  assertDirective(directives, 'script-src-attr', ["'none'"]);
  assertDirective(directives, 'style-src', ["'self'"]);
  assertDirective(directives, 'style-src-attr', ["'none'"]);
  assertDirective(directives, 'connect-src', ["'self'"]);
  assertDirective(directives, 'object-src', ["'none'"]);
  assertDirective(directives, 'frame-ancestors', ["'none'"]);

  for (const asset of ['/', '/index.html', '/sw.js', '/app.js', '/secure-vault.js', '/styles.css', '/secure-vault.css', '/manifest.json']) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = headers.match(new RegExp(`^${escaped}\\s*\\r?\\n((?:[ \\t]+[^\\r\\n]+\\r?\\n?)*)`, 'm'));
    assert(block && /Cache-Control:\s*[^\r\n]*no-cache/i.test(block[1]), `${asset} must have a no-cache policy.`);
  }
}

function assertJavaScriptSyntax() {
  for (const relativePath of ['app.js', 'secure-vault.js', 'sw.js', 'chart.umd.min.js']) {
    const result = spawnSync(process.execPath, ['--check', resolve(rootDirectory, relativePath)], {
      encoding: 'utf8'
    });
    assert(result.status === 0, `${relativePath} failed node --check:\n${result.stderr || result.stdout}`);
  }
}

assertIndexUsesExternalAssets();
assertStrictCsp();
assertJavaScriptSyntax();

console.log('Static security checks passed.');
