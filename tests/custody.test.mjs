import test from 'node:test';
import assert from 'node:assert/strict';
import {CustodyModel, MAX_CUSTODY} from '../src/lib/protocol/custody-model.ts';
const asset = {id:'test-rtd', codeHash:'test-code-hash'};
class Token {
  funds = new Map([['alice',1000n],['bob',1000n],['admin',0n],['vault',0n]]);
  allowances = new Map(); asset = {...asset}; mode = 'ok'; hook;
  identity() {return {...this.asset};}
  balance(a) {return this.funds.get(a) ?? 0n;}
  checkpoint() {return {funds:new Map(this.funds),allowances:new Map(this.allowances)};}
  rollback(s) {this.funds=s.funds;this.allowances=s.allowances;}
  move(from,to,n) {
    if (this.mode==='throw') throw Error('TOKEN_TRAP');
    assert.ok(this.balance(from)>=n);
    const credited=this.mode==='tax'? n-1n:n;
    this.funds.set(from,this.balance(from)-n);this.funds.set(to,this.balance(to)+credited);
    this.hook?.();
    if(this.mode==='error') return {ok:false,error:'declined after mutation'};
    if(this.mode==='malformed') return 'success';
    if(this.mode==='false') return {ok:false};
    return {ok:true};
  }
  transferFrom(from,to,n) {
    const a=this.allowances.get(from)??0n;assert.ok(a>=n,'ALLOWANCE_REQUIRED');
    this.allowances.set(from,a-n);return this.move(from,to,n);
  }
  transfer(from,to,n) {return this.move(from,to,n);}
}
function fixture() {const token=new Token();const vault=new CustodyModel('admin','vault',asset,token);vault.initialize('admin');vault.setPaused('admin',false);return {token,vault};}
function approve(t,a,n=1000n){t.allowances.set(a,n);}
test('custody: pinned initializer, no repeated init, immutable configured identity',()=>{
 const t=new Token(), a={...asset},v=new CustodyModel('admin','vault',a,t);a.id='evil';
 assert.throws(()=>v.initialize('alice'),/OWNER_ONLY/);v.initialize('admin');
 assert.throws(()=>v.initialize('admin'),/ALREADY_INITIALIZED/);
 t.asset.codeHash='changed';v.setPaused('admin',false);approve(t,'alice');
 assert.throws(()=>v.deposit('alice',1n),/ASSET_IDENTITY/);assert.equal(v.liabilities(),0n);
});
test('custody: approval is not a deposit; two users cannot withdraw each other or admin sweep',()=>{
 const {token:t,vault:v}=fixture();approve(t,'alice');approve(t,'bob');assert.equal(v.balanceOf('alice'),0n);
 v.deposit('alice',100n);v.deposit('bob',200n);
 assert.throws(()=>v.withdraw('admin',1n),/INSUFFICIENT_CREDIT/);
 assert.throws(()=>v.withdraw('alice',101n),/INSUFFICIENT_CREDIT/);
 v.withdraw('bob',200n);assert.equal(v.balanceOf('alice'),100n);assert.equal(t.balance('bob'),1000n);
});
test('custody: unsuccessful and malformed token replies roll back balances and allowance',()=>{
 for(const mode of ['throw','error','malformed','false','tax']) {
  const {token:t,vault:v}=fixture();approve(t,'alice');t.mode=mode;
  assert.throws(()=>v.deposit('alice',100n));assert.equal(v.balanceOf('alice'),0n);
  assert.equal(t.balance('alice'),1000n);assert.equal(t.balance('vault'),0n);assert.equal(t.allowances.get('alice'),1000n);
 }
});
test('custody: payout failure restores credit and does not consume a withdrawal',()=>{
 for(const mode of ['throw','error','malformed','false','tax']){
  const {token:t,vault:v}=fixture();approve(t,'alice');v.deposit('alice',100n);t.mode=mode;
  assert.throws(()=>v.withdraw('alice',100n));assert.equal(v.balanceOf('alice'),100n);assert.equal(t.balance('vault'),100n);
  t.mode='ok';v.withdraw('alice',100n);assert.equal(v.liabilities(),0n);
  assert.throws(()=>v.withdraw('alice',100n),/INSUFFICIENT_CREDIT/);
 }
});
test('custody: pause blocks deposits but preserves withdrawals; owner cannot use token callbacks',()=>{
 const {token:t,vault:v}=fixture();approve(t,'alice');v.deposit('alice',100n);
 assert.throws(()=>v.setPaused('bob',true),/OWNER_ONLY/);v.setPaused('admin',true);
 assert.throws(()=>v.deposit('alice',1n),/DEPOSITS_PAUSED/);v.withdraw('alice',100n);
});
test('custody: reentrancy during deposit or withdrawal cannot double-credit or double-spend',()=>{
 const {token:t,vault:v}=fixture();approve(t,'alice');t.hook=()=>v.deposit('alice',1n);
 assert.throws(()=>v.deposit('alice',100n),/REENTRANCY/);assert.equal(v.liabilities(),0n);
 t.hook=undefined;v.deposit('alice',100n);t.hook=()=>v.withdraw('alice',1n);
 assert.throws(()=>v.withdraw('alice',100n),/REENTRANCY/);assert.equal(v.balanceOf('alice'),100n);
 t.hook=undefined;v.withdraw('alice',100n);
});
test('custody: amount bounds and missing allowance leave state intact',()=>{
 const {token:t,vault:v}=fixture();
 for(const n of [0n,-1n,MAX_CUSTODY+1n])assert.throws(()=>v.deposit('alice',n),/AMOUNT_LIMIT/);
 assert.throws(()=>v.deposit('alice',1n),/ALLOWANCE_REQUIRED/);assert.equal(v.liabilities(),0n);assert.equal(t.balance('alice'),1000n);
});
test('custody: 1000 alternating multi-user operations conserve tokens and cover every credit',()=>{
 const {token:t,vault:v}=fixture();approve(t,'alice',100000n);approve(t,'bob',100000n);
 for(let i=0;i<1000;i++){
  const a=i%2?'alice':'bob';if(v.balanceOf(a)>0n)v.withdraw(a,v.balanceOf(a));else v.deposit(a,BigInt(i%50+1));
  assert.equal(v.liabilities(),v.balanceOf('alice')+v.balanceOf('bob'));
  assert.ok(t.balance('vault')>=v.liabilities());assert.equal(t.balance('alice')+t.balance('bob')+t.balance('vault'),2000n);
 }
});
