import fs from 'node:fs';
const path=new URL('../assembly/index.ts',import.meta.url);
const metadata={rcp_type:'retium_perps_custody_probe',traits:['testnet','custody_probe','no_perps_trading'],capabilities:['execute'],lockable_fields:[],evolves_from:'',weight:5,version:'v0.2.0'};
const bytes=[...Buffer.from('RCP_METADATA:'+JSON.stringify(metadata)+'\0')];
const source=fs.readFileSync(path,'utf8').replace(/\/\/ METADATA_START[\s\S]*?\/\/ METADATA_END/,'// METADATA_START\nexport const RCP_METADATA:usize=memory.data<u8>(['+bytes.join(',')+']);\n// METADATA_END');
fs.writeFileSync(path,source);
