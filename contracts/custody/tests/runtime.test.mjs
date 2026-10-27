// Actual custody WASM + mock host/token. Rollback is simulated, not proof of chain behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const wasm=fs.readFileSync(new URL('../build/retium_perps_custody.wasm',import.meta.url));
const mod=new WebAssembly.Module(wasm),U=10n**18n;
const O='retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37', A='rete'+'1'.repeat(68),B='rete'+'2'.repeat(68),V='a'.repeat(64);
const ID='c1d3885930a23a099e28e6f55f8ee8d8908902b57a7ef9d28de6756819d5611c', H='5c6b3392d5f3769522befe48cb5dc53db3e633e2f3a63f29abba74433ef768a2';
function host(){
 let state=new Map(),funds=new Map([[A,100n*U],[B,100n*U],[O,100n*U],[V,0n]]),allow=new Map(),events=[],hash=H,mode='ok',hook;
 const bal=a=>funds.get(a)??0n;
 function call(caller,action,args=[],value='0'){
  const old=[new Map(state),new Map(funds),new Map(allow),[...events]];let memory;
  const txt=(p,n)=>Buffer.from(memory.buffer,p,n).toString();
  const put=(p,m,s)=>{const b=Buffer.from(s);if(b.length>m)return -1;new Uint8Array(memory.buffer,p,b.length).set(b);return b.length;};
  const env={
   read_state:(p,n,o,m)=>put(o,m,state.get(txt(p,n))??''),write_state:(p,n,v,l)=>state.set(txt(p,n),txt(v,l)),
   get_self_contract_id:(p,m)=>put(p,m,V),get_contract_code_hash:(p,n,o,m)=>txt(p,n)===ID?put(o,m,hash):-1,
   emit_event:(p,n,d,l)=>{events.push([txt(p,n),JSON.parse(txt(d,l))]);return 0;},
   call_contract:(c,cl,mp,ml,ap,al,out,max)=>{
    assert.equal(txt(c,cl),ID);const method=txt(mp,ml),a=JSON.parse(txt(ap,al));
    if(method==='balance_of')return put(out,max,mode==='quoted'?JSON.stringify(String(bal(a[0]))):String(bal(a[0])));
    if(mode==='trap')return -1;let from,to,n;
    if(method==='transfer_from'){[from,to]=a;n=BigInt(a[2]);const av=allow.get(from)??0n;if(av<n)return -1;allow.set(from,av-n);}
    else{assert.equal(method,'transfer');from=V;to=a[0];n=BigInt(a[1]);}
    if(bal(from)<n)return -1;funds.set(from,bal(from)-n);funds.set(to,bal(to)+(mode==='tax'?n-1n:n));hook?.();
    return put(out,max,mode==='error'?'{"ok":false,"error":"mutated then refused"}':mode==='false'?'{"ok":false}':mode==='bad'?'"success"':mode==='true'?'true':'{"ok":true}');
   }
  };
  try{const ins=new WebAssembly.Instance(mod,{env});memory=ins.exports.memory;
   const input=Buffer.from(JSON.stringify({caller,action,args,value,token_context:null}));new Uint8Array(memory.buffer,0,input.length).set(input);
   const out=input.length+1024,n=ins.exports.on_use(0,input.length,out);assert.ok(n>0&&n<=4096);return JSON.parse(txt(out,n));
  }catch(e){[state,funds,allow,events]=old;throw e;}
 }
 return {call,bal,credit:a=>BigInt(call(a,'account',[a]).freeAtomic),total:()=>BigInt(call(A,'market').liabilitiesAtomic),approve:(a,n)=>allow.set(a,n),mode:m=>mode=m,hash:h=>hash=h,hook:h=>hook=h,fund:(a,n)=>funds.set(a,n),snapshot:()=>JSON.stringify({state:[...state],funds:[...funds].map(([a,n])=>[a,String(n)]),allow:[...allow].map(([a,n])=>[a,String(n)]),events})};
}
function setup(){const h=host();h.call(O,'init');h.call(O,'set_paused',['false']);h.approve(A,100n*U);h.approve(B,100n*U);return h;}
test('WASM ABI, metadata and allowed host imports',()=>{
 const allowed=['read_state','write_state','emit_event','get_self_contract_id','get_contract_code_hash','call_contract'];
 for(const x of WebAssembly.Module.imports(mod)){assert.equal(x.module,'env');assert.ok(allowed.includes(x.name));}
 assert.ok(WebAssembly.Module.exports(mod).some(x=>x.name==='on_use'));assert.ok(wasm.includes(Buffer.from('RCP_METADATA:')));assert.ok(wasm.length<1048576);
});
test('pinned initialization, once only, asset hash and native attachment',()=>{
 const h=host();assert.throws(()=>h.call(A,'init'));h.hash('0'.repeat(64));assert.throws(()=>h.call(O,'init'));h.hash(H);
 h.call(O,'init');assert.throws(()=>h.call(O,'init'));assert.equal(h.call(A,'market').paused,true);
 assert.throws(()=>h.call(O,'set_paused',['false'],'1'));assert.throws(()=>h.call(A,'set_paused',['false']));
});
test('approval never credits; two wallets own separate credits; no admin sweep or duplicate withdrawal',()=>{
 const h=setup();assert.equal(h.credit(A),0n);h.call(A,'deposit',[String(U/10n)]);h.call(B,'deposit',[String(U/5n)]);
 assert.equal(h.total(),3n*U/10n);assert.throws(()=>h.call(O,'withdraw',['1']));assert.throws(()=>h.call(A,'withdraw',[String(U/5n)]));
 h.call(B,'withdraw',[String(U/5n)]);assert.equal(h.bal(B),100n*U);assert.equal(h.credit(A),U/10n);assert.throws(()=>h.call(B,'withdraw',['1']));
});
test('negative/malformed/token tax replies rollback custody, token, allowance and events',()=>{
 for(const mode of ['trap','error','false','bad','tax']){
  const h=setup(),before=h.snapshot();h.mode(mode);assert.throws(()=>h.call(A,'deposit',[String(U/10n)]));assert.equal(h.snapshot(),before,mode);
  h.mode('ok');h.call(A,'deposit',[String(U/10n)]);const after=h.snapshot();h.mode(mode);
  assert.throws(()=>h.call(A,'withdraw',[String(U/10n)]));assert.equal(h.snapshot(),after,mode);
  h.mode('ok');h.call(A,'withdraw',[String(U/10n)]);assert.equal(h.credit(A),0n);
 }
});
test('pause allows exits; changed asset hash blocks operation; donation cannot create owner credit',()=>{
 const h=setup();h.call(A,'deposit',[String(U/10n)]);h.call(O,'set_paused',['true']);assert.throws(()=>h.call(A,'deposit',['1']));
 h.call(A,'withdraw',[String(U/10n)]);h.fund(V,U);assert.equal(h.total(),0n);assert.throws(()=>h.call(O,'withdraw',['1']));
 h.hash('f'.repeat(64));assert.throws(()=>h.call(O,'set_paused',['false']));
});
test('callback reentry, contract callers, owner spoof argument and arbitrary payout recipient refused',()=>{
 const h=setup();let blocked=0;h.hook(()=>{assert.throws(()=>h.call(A,'deposit',['1']));blocked++;});h.call(A,'deposit',[String(U/10n)]);assert.equal(blocked,1);
 h.hook(()=>assert.throws(()=>h.call(A,'withdraw',['1'])));h.call(A,'withdraw',[String(U/10n)]);assert.equal(h.credit(A),0n);
 assert.throws(()=>h.call(V,'deposit',['1']));assert.throws(()=>h.call(A,'init',['"caller":"'+O+'"']));assert.throws(()=>h.call(A,'withdraw',['1',B]));
});
test('strict atomic amounts, account cap and missing allowance; explicit true and quoted balance accepted',()=>{
 const h=setup();for(const n of ['0','-1','1.2','1e18','9'.repeat(40),String(U+1n)])assert.throws(()=>h.call(A,'deposit',[n]));
 h.approve(A,0n);assert.throws(()=>h.call(A,'deposit',['1']));h.approve(A,U);h.mode('true');h.call(A,'deposit',[String(U/10n)]);
 h.mode('quoted');h.call(A,'withdraw',[String(U/10n)]);assert.equal(h.total(),0n);
});
test('ten-wallet cap refuses eleventh before token pull',()=>{
 const h=setup();for(let i=1;i<=10;i++){const who='rete'+i.toString(16).padStart(68,'0');h.fund(who,U);h.approve(who,U);h.call(who,'deposit',[String(U)]);}
 const extra='rete'+'b'.repeat(68);h.fund(extra,U);h.approve(extra,U);const before=h.snapshot();assert.throws(()=>h.call(extra,'deposit',['1']));assert.equal(h.snapshot(),before);assert.equal(h.total(),10n*U);
});
test('100 fresh-instance deposit/withdraw cycles conserve token balances and liabilities',()=>{
 const h=setup();for(let i=0;i<100;i++){
  const who=i%2?A:B,n=BigInt(i%7+1)*10n**14n;h.call(who,'deposit',[String(n)]);assert.equal(h.total(),h.credit(A)+h.credit(B));
  h.call(who,'withdraw',[String(n)]);assert.equal(h.total(),0n);assert.equal(h.bal(V),0n);assert.equal(h.bal(A)+h.bal(B),200n*U);
 }
});
