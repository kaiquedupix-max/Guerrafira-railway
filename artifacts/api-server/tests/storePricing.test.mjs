import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
const result=await build({entryPoints:[resolve('src/core/storePricing.ts')],bundle:true,platform:'node',format:'esm',write:false});
const pricing=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('Duo and Trio prices, reference prices and recipient counts are exact',()=>{
 const expected={bronze:20,prata:30,ouro:50,combo:93.33,duo:200};for(const [tier,price] of Object.entries(expected))assert.equal(pricing.storeQuote(tier,'trio').price,price);
 assert.equal(pricing.storeQuote('duo','solo-duo').price,120);const trio=pricing.storeQuote('duo','trio');assert.equal(trio.regularPrice,240);assert.equal(trio.friendSlots,2);assert.equal(trio.name,'Super Combo Trio');
});
test('both servers receive 10 percent additional discount with cent rounding',()=>{
 assert.equal(pricing.storeQuote('duo','both').price,288);assert.equal(pricing.storeQuote('combo','both').price,147);assert.equal(pricing.storeQuote('bronze','both').price,31.5);assert.deepEqual(pricing.selectedServers('both'),['solo-duo','trio']);assert.equal(pricing.parseStoreSelection('unknown'),null);
});
