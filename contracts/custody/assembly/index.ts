// Isolated Retium Perps custody TESTNET probe. No positions, oracle, fees or admin sweep.
import { JSON } from 'assemblyscript-json/assembly';
import { u128 } from 'as-bignum/assembly';
@external('env','read_state') declare function read_state(k:usize,kl:i32,o:usize,m:i32):i32;
@external('env','write_state') declare function write_state(k:usize,kl:i32,v:usize,vl:i32):void;
@external('env','emit_event') declare function emit_event(t:usize,tl:i32,d:usize,dl:i32):i32;
@external('env','get_self_contract_id') declare function get_self_contract_id(o:usize,m:i32):i32;
@external('env','get_contract_code_hash') declare function get_contract_code_hash(c:usize,cl:i32,o:usize,m:i32):i32;
@external('env','call_contract') declare function call_contract(c:usize,cl:i32,m:usize,ml:i32,a:usize,al:i32,o:usize,om:i32):i32;
// METADATA_START
export const RCP_METADATA:usize=memory.data<u8>([82,67,80,95,77,69,84,65,68,65,84,65,58,123,34,114,99,112,95,116,121,112,101,34,58,34,114,101,116,105,117,109,95,112,101,114,112,115,95,99,117,115,116,111,100,121,95,112,114,111,98,101,34,44,34,116,114,97,105,116,115,34,58,91,34,116,101,115,116,110,101,116,34,44,34,99,117,115,116,111,100,121,95,112,114,111,98,101,34,44,34,110,111,95,112,101,114,112,115,95,116,114,97,100,105,110,103,34,93,44,34,99,97,112,97,98,105,108,105,116,105,101,115,34,58,91,34,101,120,101,99,117,116,101,34,93,44,34,108,111,99,107,97,98,108,101,95,102,105,101,108,100,115,34,58,91,93,44,34,101,118,111,108,118,101,115,95,102,114,111,109,34,58,34,34,44,34,119,101,105,103,104,116,34,58,53,44,34,118,101,114,115,105,111,110,34,58,34,118,48,46,50,46,48,34,125,0]);
// METADATA_END
const OWNER='retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37';
const ASSET='c1d3885930a23a099e28e6f55f8ee8d8908902b57a7ef9d28de6756819d5611c';
const ASSET_HASH='5c6b3392d5f3769522befe48cb5dc53db3e633e2f3a63f29abba74433ef768a2';
const ACCOUNT_CAP=u128.fromString('1000000000000000000'); // 1 RTD maximum per account
const TOTAL_CAP=u128.fromString('10000000000000000000'); // 10 RTD maximum total liabilities
const ZERO=u128.Zero;
function guard(x:bool):void { if(!x) unreachable(); }
function q(s:string):string { return JSON.Value.String(s).stringify(); }
function read(k:string):string {
 const key=String.UTF8.encode(k),out=new ArrayBuffer(4096);
 const n=read_state(changetype<usize>(key),key.byteLength,changetype<usize>(out),4096);
 guard(n>=0&&n<4096);return n==0?'':String.UTF8.decodeUnsafe(changetype<usize>(out),n);
}
function write(k:string,v:string):void {
 const key=String.UTF8.encode(k),val=String.UTF8.encode(v);
 write_state(changetype<usize>(key),key.byteLength,changetype<usize>(val),val.byteLength);
}
function digits(s:string):u128 {
 guard(s.length>0&&s.length<=39);let n=ZERO;
 for(let i=0;i<s.length;i++){
  const c=s.charCodeAt(i);guard(c>=48&&c<=57);const d=u128.fromU32(c-48);
  guard(n<=(u128.Max-d)/u128.fromU32(10));n=n*u128.fromU32(10)+d;
 }return n;
}
function number(k:string):u128 {const s=read(k);return s.length?digits(s):ZERO;}
function add(a:u128,b:u128):u128 {const n=a+b;guard(n>=a);return n;}
function sub(a:u128,b:u128):u128 {guard(a>=b);return a-b;}
function hex(s:string,n:i32):bool {
 if(s.length!=n)return false;
 for(let i=0;i<n;i++){const c=s.charCodeAt(i);if(!((c>=48&&c<=57)||(c>=97&&c<=102)))return false;}return true;
}
function wallet(s:string):bool {return s.startsWith('rete')&&hex(s.substring(4),68);}
function self():string {
 const out=new ArrayBuffer(128);const n=get_self_contract_id(changetype<usize>(out),128);
 guard(n==64);const s=String.UTF8.decodeUnsafe(changetype<usize>(out),n);guard(hex(s,64));return s;
}
function tokenCheck():void {
 const id=String.UTF8.encode(ASSET),out=new ArrayBuffer(128);
 const n=get_contract_code_hash(changetype<usize>(id),id.byteLength,changetype<usize>(out),128);
 guard(n==64);guard(String.UTF8.decodeUnsafe(changetype<usize>(out),n)==ASSET_HASH);
}
function xcall(method:string,args:string[]):string {
 const id=String.UTF8.encode(ASSET),m=String.UTF8.encode(method);let s='[';
 for(let i=0;i<args.length;i++){if(i)s+=',';s+=q(args[i]);}s+=']';
 const a=String.UTF8.encode(s),out=new ArrayBuffer(4096);
 const n=call_contract(changetype<usize>(id),id.byteLength,changetype<usize>(m),m.byteLength,changetype<usize>(a),a.byteLength,changetype<usize>(out),4096);
 guard(n>0&&n<=4096);return String.UTF8.decodeUnsafe(changetype<usize>(out),n).trim();
}
function success(s:string):void {
 if(s=='true')return;
 const parsed=JSON.parse<string>(s);guard(parsed instanceof JSON.Obj);const o=<JSON.Obj>parsed;
 guard(!o.has('error'));const b=o.getBool('ok');guard(b!==null);guard(b!.valueOf());
}
function tokenBalance(w:string):u128 {
 let s=xcall('balance_of',[w]);
 if(s.startsWith('"')){const p=JSON.parse<string>(s);guard(p instanceof JSON.Str);s=(<JSON.Str>p).valueOf();}
 return digits(s);
}
function ack(action:string,caller:string,n:u128):string {
 const event=String.UTF8.encode('perps_custody_'+action);
 const data='{"account":'+q(caller)+',"amountAtomic":'+q(n.toString())+'}';const d=String.UTF8.encode(data);
 guard(emit_event(changetype<usize>(event),event.byteLength,changetype<usize>(d),d.byteLength)>=0);
 return '{"ok":true,"action":'+q(action)+',"amountAtomic":'+q(n.toString())+'}';
}
function market():string {
 return '{"ok":true,"version":"v0.2.0","testnetOnly":true,"positionsEnabled":false,"owner":'+q(OWNER)+',"asset":'+q(ASSET)+',"assetHash":'+q(ASSET_HASH)+',"initialized":'+(read('init')=='1'?'true':'false')+',"paused":'+(read('paused')=='0'?'false':'true')+',"liabilitiesAtomic":'+q(number('total').toString())+',"accountCapAtomic":'+q(ACCOUNT_CAP.toString())+',"totalCapAtomic":'+q(TOTAL_CAP.toString())+'}';
}
function handle(action:string,caller:string,args:string[],attached:u128):string {
 guard(attached==ZERO);guard(read('lock')!='1');
 if(action=='market'){guard(args.length==0);return market();}
 if(action=='account'){
  guard(args.length==1&&wallet(args[0]));return '{"ok":true,"account":'+q(args[0])+',"freeAtomic":'+q(number('credit:'+args[0]).toString())+'}';
 }
 guard(wallet(caller)); // Deliberately disallow contract callers for this probe.
 if(action=='init'){
  guard(args.length==0&&caller==OWNER&&read('init')!='1');tokenCheck();
  write('init','1');write('paused','1');write('total','0');return ack('init',caller,ZERO);
 }
 guard(read('init')=='1');
 if(action=='set_paused'){
  guard(caller==OWNER&&args.length==1&&(args[0]=='true'||args[0]=='false'));
  if(args[0]=='false')tokenCheck();write('paused',args[0]=='true'?'1':'0');return ack('pause',caller,ZERO);
 }
 guard(action=='deposit'||action=='withdraw');guard(args.length==1);
 const amount=digits(args[0]);guard(amount>ZERO);
 const key='credit:'+caller,credit=number(key),total=number('total');
 if(action=='deposit'){guard(read('paused')=='0');guard(add(credit,amount)<=ACCOUNT_CAP&&add(total,amount)<=TOTAL_CAP);}
 else guard(amount<=credit);
 write('lock','1');tokenCheck();const vault=self(),before=tokenBalance(vault),userBefore=tokenBalance(caller);
 guard(before>=total);
 if(action=='deposit'){
  success(xcall('transfer_from',[caller,vault,amount.toString()]));
  guard(tokenBalance(vault)==add(before,amount)&&tokenBalance(caller)==sub(userBefore,amount));
  write(key,add(credit,amount).toString());write('total',add(total,amount).toString());
 }else{
  write(key,sub(credit,amount).toString());write('total',sub(total,amount).toString());
  success(xcall('transfer',[caller,amount.toString()]));
  guard(tokenBalance(vault)==sub(before,amount)&&tokenBalance(caller)==add(userBefore,amount));
 }
 guard(tokenBalance(vault)>=number('total'));write('lock','0');return ack(action,caller,amount);
}
export function on_use(inputPtr:i32,inputLen:i32,outputPtr:i32):i32 {
 guard(inputPtr==0&&inputLen>0&&inputLen<=8192&&outputPtr>=inputLen&&outputPtr+4096<=65536);
 const parsed=JSON.parse<string>(String.UTF8.decodeUnsafe(inputPtr,inputLen));guard(parsed instanceof JSON.Obj);const o=<JSON.Obj>parsed;
 const a=o.getString('action'),c=o.getString('caller'),v=o.getString('value'),arr=o.getArr('args');
 guard(a!==null&&c!==null&&v!==null&&arr!==null);
 const args=new Array<string>(),values=arr!.valueOf();guard(values.length<=1);
 for(let i=0;i<values.length;i++){guard(values[i] instanceof JSON.Str);const s=(<JSON.Str>values[i]).valueOf();guard(s.length<=256);args.push(s);}
 const reply=handle(a!.valueOf(),c!.valueOf(),args,digits(v!.valueOf()));const bytes=String.UTF8.encode(reply);guard(bytes.byteLength<=4096);
 memory.copy(outputPtr,changetype<usize>(bytes),bytes.byteLength);return bytes.byteLength;
}
