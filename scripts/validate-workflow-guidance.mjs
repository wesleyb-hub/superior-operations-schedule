// No network or runtime dependencies. Syntax + physical-workflow reference contract.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Script} from 'node:vm';
import assert from 'node:assert/strict';
const html=await readFile(resolve(import.meta.dirname,'../index.html'),'utf8');
for(const [,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new Script(source);
const guidance=html.match(/<details class="workflow-reference[^]*?<\/details>/)?.[0];
assert.ok(guidance,'Collapsible reference is missing');
for(const phrase of ['ahead of wall production','Setup Complete is not the same as Ready for Pour','Pour wall beds first, then pads and columns','does not call for a second physical inspection','before the delivery truck arrives','slab-on-grade foam only where applicable','Supply-only jobs','no bed-layout or load-sheet generation'])assert.ok(guidance.includes(phrase),`Missing distinction: ${phrase}`);
assert.ok(html.includes("document.getElementById('wallsWorkflowReference').hidden=!['walls','qc','delivery'].includes(state.view)"),'Reference must be scoped to relevant operational views');
assert.ok(html.includes(':focus-visible')&&html.includes('@media(prefers-reduced-motion:reduce)'),'Shared keyboard/motion safeguards missing');
assert.ok(guidance.includes('hidden>'),'Reference should not display before authorized rendering');
assert.ok(html.includes('@media(max-width:900px){.import-shell{grid-template-columns:minmax(0,1fr)}}'),'Import upload and preview panels must stack on narrow screens');
console.log('PASS: inline JavaScript syntax, scoped workflow guidance, keyboard focus, and reduced-motion contracts. This does not validate live workflow enforcement.');
