import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
test('sandbox has no live transaction method, Retium Pay API or database client', async()=>{
 const ui=await readFile(new URL('../src/app/page.tsx',import.meta.url),'utf8');
 const engine=await readFile(new URL('../src/lib/engine.ts',import.meta.url),'utf8');
 for(const forbidden of ['retium_call','retium_sendTransfer','retium_deploy','DATABASE_URL','/api/payments','/api/dex','localStorage']){
  assert.ok(!ui.includes(forbidden),`UI must not contain ${forbidden}`);
  assert.ok(!engine.includes(forbidden),`engine must not contain ${forbidden}`);
 }
 assert.ok(ui.includes('retium_requestAccounts'));
 assert.ok(ui.includes('className="live-locked" disabled'));
 const children=await readdir(new URL('../src/app/',import.meta.url));
 assert.ok(!children.includes('api'));
});
