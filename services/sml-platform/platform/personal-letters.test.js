'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packetValid, validateArticle, runOnce, OWNER } = require('./personal-letters');
const packet = () => ({ symbol: 'NVDA', hash: 'a'.repeat(64), expires_at: new Date(Date.now()+900000).toISOString(), observed_at: new Date().toISOString(), snapshot: { current: 100 }, bars: [] });
const article = () => ({ title: '$NVDA price analysis', subtitle: 'A measured look', excerpt: 'Observed data and conditional scenarios.', focus_keyword: 'NVDA price analysis', meta_description: 'An evidence-based review of the observed move.', sections: Array.from({length:3}, () => ({ heading:'Observed data', paragraphs:[Array(90).fill('example').join(' ')] })) });
test('valid evidence and schema accepted', () => { assert.ok(packetValid(packet())); assert.ok(validateArticle(article(),packet())); });
test('expired evidence blocked', () => { assert.throws(()=>packetValid({...packet(),expires_at:'2000-01-01'})); });
test('missing date blocked', () => { assert.throws(()=>packetValid({...packet(),observed_at:null})); });
test('stale observations blocked even when fetch fresh', () => { assert.throws(()=>packetValid({...packet(),observed_at:'2000-01-01'})); });
test('HTML blocked', () => { assert.throws(()=>validateArticle({...article(),title:'<script>alert(1)</script>'},packet())); });
test('unrelated tickers blocked', () => { assert.throws(()=>validateArticle({...article(),title:'$MSFT earnings'},packet())); });
test('thin content blocked', () => { const a=article(); a.sections.forEach(s=>s.paragraphs=['Short.']); assert.throws(()=>validateArticle(a,packet())); });
test('idle does not consume model calls', async () => { let calls=0; const r=await runOnce({request:async()=>({due:false}),ai:{generate:async()=>calls++}}); assert.equal(r.status,'idle'); assert.equal(calls,0); });
test('owner mismatch prevents generation', async () => {
 const p=packet(); let calls=0;
 await assert.rejects(runOnce({request:async path=>path==='context'?{due:true,packet:p}:{job_key:'b'.repeat(48),owner_id:12,packet:p},ai:{generate:async()=>calls++}})); assert.equal(calls,0);
});
test('one generation and verifier before completion', async () => {
 const p=packet(), steps=[];
 const r=await runOnce({request:async(path,body)=>{steps.push(path);if(path==='context')return{due:true,packet:p};if(path==='claim')return{job_key:'b'.repeat(48),owner_id:OWNER,packet:p};assert.equal(body.verification.pass,true);return{status:'published'};},
 ai:{generate:async()=>{steps.push('generate');return article();},verify:async()=>{steps.push('verify');return{pass:true,issues:[]};}}});
 assert.equal(r.status,'published');assert.deepEqual(steps,['context','claim','generate','verify','complete']);
});
test('generation failure consumes attempt without retry', async () => {
 const p=packet();let count=0;
 const r=await runOnce({request:async(path,body)=>path==='context'?{due:true,packet:p}:path==='claim'?{job_key:'b'.repeat(48),owner_id:OWNER,packet:p}:{status:body.verification.pass?'published':'held'},ai:{generate:async()=>{count++;throw new Error('timeout');}}});
 assert.equal(count,1);assert.equal(r.status,'held');
});
test('uncertain claim is not retried', async () => {
 let count=0;const p=packet();
 await assert.rejects(runOnce({request:async path=>{if(path==='context')return{due:true,packet:p};count++;throw new Error('timeout');},ai:{}}));assert.equal(count,1);
});
