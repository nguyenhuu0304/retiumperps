export const OWNER='retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37';
export const ASSET='c1d3885930a23a099e28e6f55f8ee8d8908902b57a7ef9d28de6756819d5611c';
export const ASSET_HASH='5c6b3392d5f3769522befe48cb5dc53db3e633e2f3a63f29abba74433ef768a2';
export const SHA256='380b7bf59ad7f7a87afc8444849641d24f2830f774e9355b6f65b130152ebe80';
export const WASM_SIZE=16566;
export const metadata={rcp_type:'retium_perps_custody_probe',traits:['testnet','custody_probe','no_perps_trading'],capabilities:['execute'],lockable_fields:[],evolves_from:'',weight:5,version:'v0.2.0'};
export const STORAGE_KEY='retium-perps:deploy-custody:v0.2.0';
export const txPattern=/^tx_[0-9a-f]{32}$/;
export function checkAccount(a: {address?:unknown;chainId?:unknown}) {
 if(a.address!==OWNER||Number(a.chainId)!==3)throw Error('Chọn đúng ví 37 trên testnet chain 3.');
}
export function checkDeploy(tx:Record<string,unknown>,id:string):'pending'|'failed'|'confirmed' {
 if(!txPattern.test(id)||tx.tx_id!==id||tx.sender!==OWNER||tx.action!=='deploy'||tx.amount!=='0')throw Error('TX không khớp ví 37 / deploy / amount 0. Không gửi lại.');
 const s=String(tx.finality||tx.status);
 if(['Rejected','Voided','Failed'].includes(s))return 'failed';
 if(s!=='HardFinal')return 'pending';
 if(tx.exec_status!=='ok'||tx.exec_error||tx.rejection_reason)return 'failed';
 if(!/^[0-9a-f]{64}$/.test(String(tx.recipient)))throw Error('TX thiếu contract ID hợp lệ.');
 return 'confirmed';
}
export function checkContract(c:Record<string,unknown>,id:string,hash:string) {
 if(c.contract_id!==id||c.code_hash!==hash||c.deployer!==OWNER||c.status!=='deployed')throw Error('Contract ID / code hash / deployer không khớp WASM.');
}
export function checkMarket(m:Record<string,unknown>) {
 if(m.owner!==OWNER||m.asset!==ASSET||m.assetHash!==ASSET_HASH||m.version!=='v0.2.0'||m.testnetOnly!==true||m.positionsEnabled!==false)throw Error('Cấu hình custody không khớp.');
}
export function checkInit(tx:Record<string,unknown>,id:string,contract:string):'pending'|'failed'|'confirmed' {
 if(!txPattern.test(id)||!/^[0-9a-f]{64}$/.test(contract)||tx.tx_id!==id||tx.sender!==OWNER||tx.action!=='call'||tx.amount!=='0'||tx.recipient!==contract)throw Error('TX INIT không khớp ví 37 / contract / amount 0.');
 const call=tx.call as {contract?:unknown;method?:unknown}|null;
 if(!call||call.contract!==contract||call.method!=='init')throw Error('TX không phải method init của custody này.');
 if(['Rejected','Voided','Failed'].includes(String(tx.finality))||['Rejected','Voided','Failed'].includes(String(tx.status)))return 'failed';
 if((tx.finality||tx.status)!=='HardFinal')return 'pending';
 return tx.exec_status==='ok'&&!tx.exec_error&&!tx.rejection_reason?'confirmed':'failed';
}
export function checkInitialized(m:Record<string,unknown>,requirePaused=true) {
 checkMarket(m);
 if(m.initialized!==true||typeof m.paused!=='boolean'||(requirePaused&&m.paused!==true))throw Error('INIT chưa được xác minh ở trạng thái initialized=true, paused=true. Không mở nạp.');
}
