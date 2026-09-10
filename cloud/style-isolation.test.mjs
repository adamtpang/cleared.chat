import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createGateway } from './gateway.mjs';

test('real gateway and workers isolate private style profiles and exports', async t => {
  const dataDir=mkdtempSync(join(tmpdir(),'cleared-style-gateway-'));
  const gateway=createGateway({dataDir,production:false});
  gateway.server.listen(0,'127.0.0.1');
  await once(gateway.server,'listening');
  t.after(async()=>{
    await new Promise(resolve=>gateway.server.close(resolve));
    rmSync(dataDir,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${gateway.server.address().port}`;
  async function signup(email) {
    const r=await fetch(base+'/signup',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email,password:'synthetic-test-password-123'})});
    return r.headers.get('set-cookie').split(';')[0];
  }
  const a=await signup('style-a@example.invalid'), b=await signup('style-b@example.invalid');
  assert.equal((await fetch(base+'/api/style')).status,401);
  assert.equal((await fetch(base+'/api/style/export')).status,401);
  const update=await fetch(base+'/api/style',{method:'POST',headers:{cookie:a,'content-type':'application/json',origin:base},body:JSON.stringify({explicit:{notes:'Synthetic account A preference',casing:'sentence'}})});
  assert.equal(update.status,200);
  const own=await update.json();
  assert.equal(own.explicit.casing,'sentence');
  const other=await (await fetch(base+'/api/style?userId=style-a',{headers:{cookie:b}})).json();
  assert.equal(other.explicit.notes,'');
  assert.equal(other.explicit.casing,'auto');
  const exportA=await fetch(base+'/api/style/export',{headers:{cookie:a}});
  assert.equal(exportA.headers.get('cache-control'),'no-store');
  assert.match(await exportA.text(),/Synthetic account A preference/);
  const exportB=await fetch(base+'/api/style/export',{headers:{cookie:b}});
  assert.doesNotMatch(await exportB.text(),/Synthetic account A preference/);
  const csrf=await fetch(base+'/api/style',{method:'POST',headers:{cookie:a,'content-type':'application/json',origin:'https://attacker.invalid'},body:'{}'});
  assert.equal(csrf.status,403);
  assert.deepEqual(await csrf.json(),{error:'Forbidden'});
  const spoof=await fetch(base+'/api/style',{method:'POST',headers:{cookie:a,'content-type':'application/json'},body:JSON.stringify({userId:'other'})});
  assert.equal(spoof.status,400);
});
