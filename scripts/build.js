#!/usr/bin/env node
/* Собирает dist/vsemvamdam-helper-<версия>.zip — готовое к установке расширение. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `vsemvamdam-helper-${version}.zip`);
if (fs.existsSync(out)) fs.unlinkSync(out);
execFileSync('zip', ['-r', '-q', '-X', out, 'manifest.json', 'src', 'icons', '_locales', '-x', 'icons/icon.svg'], { cwd: root, stdio: 'inherit' });
console.log(out);
