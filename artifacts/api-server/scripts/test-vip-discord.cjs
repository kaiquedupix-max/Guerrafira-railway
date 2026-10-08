// The Discord store now contains website links only. Exercise its migration and checkout compatibility.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.execPath,['--test','tests/storeCheckout.test.mjs'],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
process.exit(result.status??1);
