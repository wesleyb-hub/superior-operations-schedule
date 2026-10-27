import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'node_modules/jose'),destination=path.join(root,'employee-password-candidate/vendor/jose-6.2.13');
async function files(directory){const entries=await fs.readdir(directory,{withFileTypes:true});return (await Promise.all(entries.map(async x=>x.isDirectory()?(await files(path.join(directory,x.name))).map(y=>x.name+'/'+y):[x.name]))).flat().sort();}
const metadata=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
assert.equal(metadata.version,'6.2.13');assert.equal(metadata.license,'MIT');
const expected=[...(await files(path.join(source,'dist/webapi'))),'LICENSE.md','package.json'].sort();
assert.deepEqual(await files(destination),expected);
for(const file of expected.filter(x=>x!=='package.json')){
  const a=await fs.readFile(path.join(source,file==='LICENSE.md'?file:'dist/webapi/'+file)),b=await fs.readFile(path.join(destination,file));
  assert.equal(createHash('sha256').update(a).digest('hex'),createHash('sha256').update(b).digest('hex'),file+' differs from pinned npm package');
}
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
assert.equal(lock.packages['node_modules/jose'].version,'6.2.13');assert.match(lock.packages['node_modules/jose'].integrity,/^sha512-/);
console.log('PASS: exact jose6.2.13 webapi bytes, MIT license and locked integrity; no claim of independent cryptographic audit.');
