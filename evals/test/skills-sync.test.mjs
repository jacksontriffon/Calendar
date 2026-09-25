// The app ships its own copy of skills/ inside index.html (SKILL_FILES). They must match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function embeddedSkills() {
  const line = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('\n').find((l) => l.includes('const SKILL_FILES'));
  const tpl = JSON.parse(line.trim());
  const start = tpl.indexOf('const SKILL_FILES = ') + 'const SKILL_FILES = '.length;
  return JSON.parse(tpl.slice(start, tpl.indexOf('\n};\n', start) + 2));
}

function diskSkills() {
  const out = {};
  const dir = path.join(ROOT, 'skills');
  for (const name of fs.readdirSync(dir)) {
    if (!fs.statSync(path.join(dir, name)).isDirectory()) continue;
    out[name] = {};
    const walk = (rel) => {
      for (const f of fs.readdirSync(path.join(dir, name, rel))) {
        const p = rel ? rel + '/' + f : f;
        if (fs.statSync(path.join(dir, name, p)).isDirectory()) walk(p);
        else out[name][p] = fs.readFileSync(path.join(dir, name, p), 'utf8');
      }
    };
    walk('');
  }
  return out;
}

test('SKILL_FILES in index.html matches skills/', () => {
  assert.deepEqual(embeddedSkills(), diskSkills());
});
