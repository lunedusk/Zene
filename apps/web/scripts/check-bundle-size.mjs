#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const MAX_TOTAL_JS = 1_500_000;
const MAX_CHUNK_JS = 600_000;
const MAX_TOTAL_CSS = 250_000;

if (!fs.existsSync(dist)) {
    console.error('check-bundle-size: dist/ missing — run vite build first');
    process.exit(2);
}

function walk(dir, acc = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, acc);
        else acc.push(p);
    }
    return acc;
}

const files = walk(dist);
let totalJs = 0;
let totalCss = 0;
let maxJs = 0;
const report = [];

for (const f of files) {
    const st = fs.statSync(f);
    const rel = path.relative(dist, f);
    if (f.endsWith('.js')) {
        totalJs += st.size;
        maxJs = Math.max(maxJs, st.size);
        report.push({ rel, type: 'js', size: st.size });
    } else if (f.endsWith('.css')) {
        totalCss += st.size;
        report.push({ rel, type: 'css', size: st.size });
    }
}

console.log(JSON.stringify({ totalJs, maxJs, totalCss, files: report.length }, null, 2));

let failed = false;
if (totalJs > MAX_TOTAL_JS) {
    console.error(`FAIL total JS ${totalJs} > ${MAX_TOTAL_JS}`);
    failed = true;
}
if (maxJs > MAX_CHUNK_JS) {
    console.error(`FAIL max JS chunk ${maxJs} > ${MAX_CHUNK_JS}`);
    failed = true;
}
if (totalCss > MAX_TOTAL_CSS) {
    console.error(`FAIL total CSS ${totalCss} > ${MAX_TOTAL_CSS}`);
    failed = true;
}
if (failed) process.exit(1);
console.log('check-bundle-size: PASS');
