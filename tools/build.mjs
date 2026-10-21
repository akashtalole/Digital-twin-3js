#!/usr/bin/env node
// Assembles the page from src/app.html + src/styles.css.
//   index.html          full document for static hosting / local dev
//   dist/artifact.html  body-only variant with inlined CSS (for embedding hosts
//                       that supply their own <html>/<head> skeleton)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const THREE_VERSION = '0.160.0';
const head = (css) => `<title>Cross-Dock Twin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap">
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"
} }
</script>
${css}`;

const body = read('src/app.html');
const script = '<script type="module" src="src/main.js"></script>';

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head('<link rel="stylesheet" href="src/styles.css">')}
</head>
<body>
${body}
${script}
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), index);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/artifact.html'), `${head(`<style>\n${read('src/styles.css')}</style>`)}\n${body}\n${script}\n`);
console.log('Wrote index.html and dist/artifact.html');
