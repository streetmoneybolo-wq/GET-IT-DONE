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
const { roboticHits, createAI } = require('./personal-letters');
const long = 'word '.repeat(60).trim();
const modern = () => ({ title: '$NVDA Pushes Higher and the Range Gets Tight', subtitle: 'A tighter tape', excerpt: 'Buyers stepped in.', focus_keyword: 'NVDA stock', meta_description: 'Why the NVDA move matters.',
  hook: 'Buyers showed up early. They did not leave.', watch_next: long, image_prompt: 'Abstract glowing green line chart on dark glass', keywords: ['NVDA stock', 'NVDA breakout'],
  sections: [1, 2, 3].map(i => ({ heading: `Part ${i}`, paragraphs: [long] })), scenarios: { bullish: long, bearish: long, neutral: long } });
test('new structured article (hook, scenarios, keywords) validates', () => { const r = validateArticle(modern(), packet()); assert.deepEqual(Object.keys(r.scenarios), ['bullish', 'bearish', 'neutral']); assert.equal(r.keywords.length, 2); });
test('scenarios must be exactly bullish/bearish/neutral', () => { const a = modern(); a.scenarios = { bullish: long, bearish: long }; assert.throws(() => validateArticle(a, packet())); });
test('robotic phrasing from the old voice is caught', () => {
  const a = modern(); a.sections[0].paragraphs = ['What the observed move shows is limited. This does not establish a trend, and these are possibilities, not forecasts.'];
  assert.ok(roboticHits(a).length >= 2); assert.equal(roboticHits(modern()).length, 0);
});
test('generate = write, audit, one rewrite when the audit fails; still one attempt', async () => {
  const p = packet(), calls = []; let n = 0;
  const fetchImpl = async (url, opts) => { const body = JSON.parse(opts.body); const name = body.text.format.name; calls.push(name);
    const out = name === 'personal_letter_voice_audit' ? { pass: false, issues: ['Scenarios are generic.'] } : modern();
    return { ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(out), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }) }; };
  const ai = createAI({ apiKey: 'k', model: 'm', fetchImpl });
  const r = await ai.generate(p);
  assert.deepEqual(calls, ['personal_letter', 'personal_letter_voice_audit', 'personal_letter']); assert.ok(r.hook);
});
test('a rewrite that is still robotic is held, not published', async () => {
  const p = packet(); const bad = modern(); bad.hook = 'This does not establish anything. Nothing else.';
  const fetchImpl = async (url, opts) => { const name = JSON.parse(opts.body).text.format.name; const out = name === 'personal_letter_voice_audit' ? { pass: true, issues: [] } : bad;
    return { ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(out), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }) }; };
  await assert.rejects(createAI({ apiKey: 'k', model: 'm', fetchImpl }).generate(p), /voice_check_failed/);
});
const { unsupportedLevels } = require('./personal-letters');
test('scenario levels must come from the evidence', () => {
  const p = { ...packet(), snapshot: { current: 41.97, high: 42.1, low: 41.67, prev_close: 40.74, open: 45.84 }, bars: [{ date: 'd', close: 43.2 }] };
  const a = modern(); a.scenarios.bullish = 'Closes north of about 42.50 would turn this bullish.';
  assert.equal(unsupportedLevels(a, p).length, 1);
  a.scenarios.bullish = 'Holding above the $42 area and the session high near 42.1 keeps buyers in charge over the next 3 sessions or 5%.';
  a.scenarios.bearish = 'Losing the 41.67 low, or a slide back toward the 40.74 prior close, flips it.';
  assert.equal(unsupportedLevels(a, p).length, 0);
});
test('a rewrite that still invents levels is held', async () => {
  const p = { ...packet(), snapshot: { current: 100 } }; const bad = modern(); bad.scenarios.bullish = 'A close above 250 would confirm it.';
  const fetchImpl = async (u, o) => { const name = JSON.parse(o.body).text.format.name; const out = name === 'personal_letter_voice_audit' ? { pass: true, issues: [] } : bad;
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }) }; };
  await assert.rejects(createAI({ apiKey: 'k', model: 'm', fetchImpl }).generate(p), /unsupported_levels/);
});
test('any hint at how the piece was produced is caught', () => {
  for (const line of ['This is AI-assisted analysis.', 'It was generated by an AI model.', 'The language model saw a dip.', 'This letter was automatically generated.']) {
    const a = modern(); a.hook = line + ' Buyers showed up.'; assert.ok(roboticHits(a).length >= 1, line);
  }
  const ok = modern(); ok.hook = 'AI chip demand keeps pulling buyers into the tape. They have not left.'; assert.equal(roboticHits(ok).length, 0);
});
