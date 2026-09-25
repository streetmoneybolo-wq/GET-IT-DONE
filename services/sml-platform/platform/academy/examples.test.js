'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const examples = require('./examples');
const lessonPartsModule = require('./lesson-parts');
const { SEED_LESSONS } = require('./curriculum');
const { narrationFor } = require('../academy-voice');
const { partsFor, createAcademySlideDesigner } = require('../academy-slide-designer');
const TOTAL_LESSONS = 121 + require('./street-smarts').STREET_LESSONS.length; // the original 29 modules plus the Street Smarts track

const {
  evaluate, formatValue, validateExample, isValidExample, builders, E, B,
  autoExample, attachWorkedExamples, assertAuthoredExamples, BUILDER_DEFAULTS, LIMITS
} = examples;
const { lessonParts, lessonPartsInfo, exampleText, EXAMPLE_LEAD, narrationVersion, curriculumVersion } = lessonPartsModule;

const HEX12 = /^[0-9a-f]{12}$/;
const PAGE_BANNED = ['<iframe', 'location.assign', 'claude designed', 'playing grandmaster-obi', 'next lesson is preloading'];
const key = (lesson) => `${lesson.moduleId}.${lesson.lessonId}`;
const withoutExample = (lesson) => {
  const { example, exampleIndex, parts, narrationVersion: version, ...rest } = lesson;
  return rest;
};

function validSpec(overrides = {}) {
  return {
    given: { price: 50, strike: 45 },
    calc: { gap: 'price - strike' },
    say: ['The price is {price|usd}.', 'The strike is {strike|usd}.', 'The gap is {gap|usd}.'],
    frames: [{ cue: 0, items: [{ k: 'big', text: '{gap|usd}', label: 'Gap' }] }],
    ...overrides
  };
}

test('safe evaluator follows arithmetic precedence and supports the allowed functions', () => {
  assert.equal(evaluate('1 + 2 * 3'), 7);
  assert.equal(evaluate('(1 + 2) * 3'), 9);
  assert.equal(evaluate('10 - 4 - 3'), 3);
  assert.equal(evaluate('12 / 4 / 3'), 1);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('2^-1'), 0.5);
  assert.equal(evaluate('- -3'), 3);
  assert.equal(evaluate('.5 + 1.25'), 1.75);
  assert.equal(evaluate('max(1, 5, 3)'), 5);
  assert.equal(evaluate('min(4, 2)'), 2);
  assert.equal(evaluate('abs(-3)'), 3);
  assert.equal(evaluate('round(2.345, 2)'), 2.35);
  assert.equal(evaluate('round(1.005, 2)'), 1.01);
  assert.equal(evaluate('round(-2.5)'), -3);
  assert.equal(evaluate('sqrt(16)'), 4);
  assert.ok(Math.abs(evaluate('ln(exp(2))') - 2) < 1e-12);
  assert.equal(evaluate('pow(2, 10)'), 1024);
  assert.equal(evaluate('floor(0.3 / 0.1)'), 3);
  assert.equal(evaluate('ceil(2.1)'), 3);
  assert.equal(evaluate('premium * shares', { premium: 2, shares: 100 }), 200);
  assert.equal(evaluate('max(strike - low, 0)', { strike: 45, low: 55 }), 0);
  assert.equal(evaluate(7), 7);
});

test('safe evaluator rejects unknown names, bad syntax and anything that is not arithmetic', () => {
  const cases = [
    ['foo', /unknown name/], ['1 +', /end of expression/], ['2 3', /unexpected/], ['1 / 0', /division by zero/],
    ['sqrt(-1)', /negative/], ['ln(0)', /positive/], ['constructor', /unknown name/], ['__proto__', /unknown name/],
    ['toString', /unknown name/], ['process.exit()', /unexpected character/], ['alert(1)', /unknown function/],
    ['max()', /argument/], ['round(1, 2, 3)', /argument/], ['(1', /expected "\)"/], ['1e3', /unexpected/],
    ['a', /not a finite number/], ['"x"', /unexpected character/], ['10 ^ 1000', /finite/], ['', /non-empty/],
    ['round(1.5, 0.5)', /decimals/]
  ];
  for (const [expression, pattern] of cases) {
    assert.throws(() => evaluate(expression, { a: 'text' }), pattern, expression);
  }
  assert.throws(() => evaluate('x', Object.create({ x: 5 })), /unknown name/);
  const source = fs.readFileSync(path.join(__dirname, 'examples.js'), 'utf8');
  assert.doesNotMatch(source, /\beval\s*\(|new Function\s*\(/);
});

test('formatters produce the contract strings', () => {
  const cases = [
    [1234, 'usd', '$1,234'], [12.5, 'usd', '$12.50'], [-300, 'usd', '-$300'], [0.5, 'usd', '$0.50'],
    [-0.001, 'usd', '$0'], [1234567.891, 'usd', '$1,234,567.89'], [9.999, 'usd', '$10'],
    [12.5, 'usd0', '$13'], [-12.5, 'usd0', '-$13'], [1234.4, 'usd0', '$1,234'],
    [0.076, 'pct', '7.6%'], [0.1, 'pct', '10%'], [-0.01, 'pct', '-1%'], [0.428571, 'pct', '42.86%'], [12.5, 'pct', '1,250%'],
    [0.2, 'pts', '0.2'], [1234.5, 'pts', '1234.5'], [-1.456, 'pts', '-1.46'],
    [1234.5, 'num', '1,234.5'], [1000, 'num', '1,000'], [40, 'num', '40'],
    [1.1, 'x', '1.10x'], [3, 'x', '3x'], [2.5, 'x', '2.50x'],
    [300, 'susd', '+$300'], [-200, 'susd', '-$200'], [0, 'susd', '$0'], [0.05, 'spct', '+5%'], [-0.0125, 'spct', '-1.25%'], [4, 'snum', '+4']
  ];
  for (const [value, format, expected] of cases) assert.equal(formatValue(value, format), expected, `${value}|${format}`);
  assert.throws(() => formatValue(1, 'euro'), /unknown format/);
  assert.throws(() => formatValue(Number.NaN, 'usd'), /finite/);
});

test('E() resolves placeholders from computed facts and freezes a contract-shaped example', () => {
  const record = E('1.1', 'demo_family', validSpec({
    title: 'Gap of {gap|usd}',
    frames: [
      { cue: 0, items: [{ k: 'numberLine', marks: [{ at: 'strike', label: 'Strike {strike|usd}' }, { at: '{price}', label: 'Now' }], dot: { from: 'price', to: 'strike + 1' } }] },
      { cue: 2, items: [{ k: 'bars', items: [{ label: 'Gap', value: 'gap', text: '{gap|susd}', tone: 'good' }, { label: 'Zero', value: 0, text: '$0' }] }] }
    ]
  }));
  assert.deepEqual(record.errors, []);
  const example = record.example;
  assert.equal(example.source, 'authored');
  assert.equal(example.id, '1.1');
  assert.equal(example.title, 'Gap of $5');
  assert.deepEqual(example.say, ['The price is $50.', 'The strike is $45.', 'The gap is $5.']);
  assert.deepEqual(example.facts, { price: 50, strike: 45, gap: 5 });
  assert.deepEqual(example.frames[0].items[0].marks.map((mark) => mark.at), [45, 50]);
  assert.deepEqual(example.frames[0].items[0].dot, { from: 50, to: 46 });
  assert.equal(example.frames[1].items[0].items[0].value, 5);
  assert.equal(example.frames[1].items[0].items[0].text, '+$5');
  assert.ok(Object.isFrozen(example) && Object.isFrozen(example.frames[0].items[0].marks[0]));
  assert.deepEqual(Object.keys(example).sort(), ['facts', 'family', 'frames', 'id', 'say', 'source', 'title']);
  assert.deepEqual(JSON.parse(JSON.stringify(example)), example);
});

test('E() reports every authoring mistake instead of throwing', () => {
  const problems = (spec, id = '1.1', family = 'demo_family') => E(id, family, spec).errors.join(' | ');
  assert.match(problems(validSpec({ say: ['The price is {cost|usd}.', 'Two.', 'Three.'] })), /unknown placeholder \{cost\|usd\}/);
  assert.match(problems(validSpec({ say: ['The price is {price|euro}.', 'Two.', 'Three.'] })), /unknown format "euro"/);
  assert.match(problems(validSpec({ say: ['A price of {price.', 'Two.', 'Three.'] })), /unmatched/);
  assert.match(problems(validSpec({ calc: { gap: 'price -' } })), /calc\.gap/);
  assert.match(problems(validSpec({ calc: { gap: 'missing * 2' } })), /unknown name "missing"/);
  assert.match(problems(validSpec({ given: { price: '50' } })), /given\.price must be a finite number/);
  assert.match(problems(validSpec({ say: ['The strike is $45.', 'Two.', 'Three.'] })) || 'none', /none/, 'a formatted fact value is allowed');
  assert.match(problems(validSpec({ say: ['The strike is $46.', 'Two.', 'Three.'] })), /number 46 is not a computed fact/);
  assert.match(problems(validSpec({ say: ['About 3 paths and 12 steps.', 'Two.', 'Three.'] })) || 'none', /none/, 'small counts are allowed');
  assert.match(problems(validSpec({ say: ['In 2030 it pays.', 'Two.', 'Three.'] })), /2030/);
  assert.deepEqual(E('1.1', 'demo_family', validSpec({ literals: [2030], say: ['In 2030 it pays.', 'Two.', 'Three.'] })).errors, []);
  assert.match(problems(validSpec({ say: ['Price minus strike = gap.', 'Two.', 'Three.'] })), /cannot say "="/);
  assert.match(problems(validSpec({ say: ['Two × three.', 'Two.', 'Three.'] })), /cannot say "×"/);
  assert.match(problems(validSpec({ say: ['Leo makes -$5 here.', 'Two.', 'Three.'] })), /leading \+ or - sign/);
  assert.match(problems(validSpec({ say: ['That is 2 x 3 shares.', 'Two.', 'Three.'] })), /times/);
  assert.match(problems(validSpec({ say: ['No period', 'Two.', 'Three.'] })), /end the sentence/);
  assert.match(problems(validSpec({ say: ['One.', 'Two.'] })), /3 to 6 sentences/);
  assert.match(problems(validSpec({ say: ['Brian buys.', 'Two.', 'Three.'] })), /reserved name/);
  assert.match(problems(validSpec({ say: ['Dave and ClearValue buy.', 'Two.', 'Three.'] })), /reserved name/);
  assert.match(problems(validSpec({ say: ['Buster buys.', 'Two.', 'Three.'] })), /reserved name/);
  assert.match(problems(validSpec({ say: ['Buy $ABCD today.', 'Two.', 'Three.'] })), /cashtags/);
  assert.match(problems(validSpec({ say: ['This is a guaranteed profit.', 'Two.', 'Three.'] })), /advice or a guarantee/);
  assert.match(problems(validSpec({ say: ['A'.repeat(300) + '.', 'B'.repeat(300) + '.', 'Three.'] })), /limit is 520/);
  assert.match(problems(validSpec({ frames: [{ cue: 1, items: [{ k: 'big', text: 'x' }] }] })), /frames\[0\]\.cue must be 0/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'big', text: 'x' }] }, { cue: 0, items: [{ k: 'big', text: 'y' }] }] })), /greater than the previous/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'line', text: 'x', cue: 5 }] }] })), /cue must be from 0 to 2/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'line', text: 'x', cue: 1 }] }, { cue: 1, items: [{ k: 'big', text: 'y' }] }] })), /cue must be from 0 to 0/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'big', text: 'fifteen chars!!' }] }] })), /longer than 14/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'big', text: 'x', tone: 'purple' }] }] })), /tone must be/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'actors', left: { name: 'A', icon: 'dragon' }, right: { name: 'B', icon: 'person' }, flows: [] }] }] })), /icon must be/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'chart', text: 'x' }] }] })), /k must be one of/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'big', text: 'x', colour: 'red' }] }] })), /unknown field "colour"/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'numberLine', marks: [{ at: 50, label: 'A' }, { at: 45, label: 'B' }] }] }] })), /sorted/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'numberLine', marks: [{ at: 45, label: 'A' }, { at: 50, label: 'B' }], dot: { from: 45, to: 60 } }] }] })), /between the first and last mark/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'bars', items: [{ label: 'A', value: 0, text: 'a' }, { label: 'B', value: 0, text: 'b' }] }] }] })), /non-zero/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'steps', items: ['one'] }] }] })), /2 to 4 steps/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'compare', left: { title: 'A', lines: ['this line is far too long'], mark: 'check' }, right: { title: 'B', lines: [], mark: 'maybe' } }] }] })), /longer than 18[\s\S]*mark must be/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'candle', open: 10, high: 9, low: 8, close: 11 }] }] })), /high must be the top/);
  assert.match(problems(validSpec({ frames: [{ cue: 0, items: [{ k: 'stamp', text: '<iframe src=x>' }] }] })), /no < > \{ \} characters/);
  assert.match(problems(validSpec(), '9'), /id must be/);
  assert.match(problems(validSpec(), '1.1', 'Bad Family'), /family must be/);
  assert.match(problems(null), /spec must be an object/);
  assert.match(problems(validSpec({ extra: true })), /unknown field "extra"/);
});

test('validateExample checks hand-built objects too', () => {
  assert.deepEqual(validateExample(null), ['example must be an object']);
  const good = E('1.1', 'demo_family', validSpec()).example;
  assert.deepEqual(validateExample(good), []);
  assert.equal(isValidExample({ ...good, source: 'manual' }), false);
  assert.equal(isValidExample({ ...good, facts: { gap: 'five' } }), false);
  assert.equal(isValidExample({ ...good, say: [...good.say, 'The price is {price|usd}.'] }), false);
  assert.equal(isValidExample({ ...good, extra: 1 }), false);
  assert.equal(isValidExample({ ...good, title: 'Playing Grandmaster-Obi narration' }), false);
});

test('every builder returns a valid example for its defaults and for several parameter sets', () => {
  const cases = {
    optionPut: [{}, { stock: 30, strike: 28, premium: 1.5, low: 24, high: 33 }, { low: 44, premium: 2 }, { low: 43 }, { strike: 1250, stock: 1300, premium: 42.5, low: 1100, high: 1400, shares: 1000, buyer: 'Kofi', seller: 'Zoe', company: 'A Very Long Company Name That Goes On' }],
    optionCall: [{}, { stock: 20, strike: 22, premium: 1, high: 26, low: 18 }, { high: 56 }, { high: 57 }, { stock: 900, strike: 950, premium: 37.25, high: 1100, low: 800 }],
    positionSize: [{}, { account: 5000, riskPct: 0.005, entry: 25, stop: 24 }, { account: 10000, riskPct: 0.01, entry: 40, stop: 38.7 }, { account: 250000, riskPct: 0.02, entry: 312.4, stop: 301.15 }],
    percentChange: [{}, { before: 80, after: 60 }, { before: 1000, after: 1260, unit: 'num', thing: 'total output' }, { before: 0.5, after: 0.55 }],
    compound: [{}, { start: 1000, rate: 0.07, years: 10 }, { start: 100, returns: [0.1, -0.1] }, { start: 250, returns: [0.2, -0.25, 0.05] }, { years: 2 }],
    presentValue: [{}, { amount: 121, years: 2, compareRate: 0.05 }, { amount: 1000, rate: 0.075, years: 20, compareRate: null }, { amount: 5000000, rate: 0.03, years: 30, compareRate: 0.08 }],
    bidAsk: [{}, { bid: 20, ask: 20.1, shares: 500 }, { bid: 4.95, ask: 5.05, shares: 1000 }, { bid: 1999.5, ask: 2001, shares: 25000 }],
    expectedValue: [{}, { outcomes: [{ label: 'Win', p: 0.3, value: 100 }, { label: 'Loss', p: 0.7, value: -30 }] },
      { outcomes: [{ label: 'Big win', p: 0.2, value: 50 }, { label: 'Small win', p: 0.3, value: 10 }, { label: 'Loss', p: 0.5, value: -20 }] },
      { outcomes: [{ label: 'Up', p: 0.5, value: 10 }, { label: 'Down', p: 0.5, value: -10 }] }],
    ratio: [{}, { top: 100, bottom: 4, topLabel: 'price', bottomLabel: 'earnings', as: 'num', compare: { company: 'Crumb Co.', top: 50, bottom: 5 } },
      { top: 300, bottom: 100, topLabel: 'debt', bottomLabel: 'profit', as: 'x', compare: null }, { top: 95, bottom: 100, unit: 'num', compare: { company: 'Fizz Town', top: 40, bottom: 100 } }],
    drawdownRecovery: [{}, { start: 5000, drop: 0.5 }, { start: 2000, drop: 0.2 }, { start: 1000000, drop: 0.9 }],
    bondYield: [{}, { face: 1000, coupon: 40, yield: 0.05, newYield: 0.07 }, { face: 100, coupon: 3, price: 97, newYield: null }, { newYield: 0.08 }],
    twoChoices: [{}, ...examples.TWO_CHOICE_TEMPLATES.map((template) => template.params)],
    process: [{}, ...examples.PROCESS_TEMPLATES.map((template) => template.params), { steps: ['Plan', 'Act'], goal: 'try two steps', why: 'Short and simple.' }, { steps: ['Plan', 'Act', 'Review'], goal: 'try three steps', why: 'Still simple.' }],
    scenarioTree: [{}, { price: 20, branches: [{ label: 'Down', p: 0.3, value: 15 }, { label: 'Flat', p: 0.5, value: 20 }, { label: 'Up', p: 0.2, value: 30 }] },
      { price: 50, branches: [{ label: 'Miss', p: 0.4, value: 40 }, { label: 'Beat', p: 0.6, value: 60 }] }, { price: 10, branches: [{ label: 'A', p: 0.5, value: 8 }, { label: 'B', p: 0.5, value: 12 }] }],
    candle: [{}, { open: 20, high: 20.5, low: 18, close: 18.5, period: 'one week' }, { open: 5, high: 5.8, low: 4.9, close: 5.6 }, { open: 10, high: 11, low: 9, close: 10 }]
  };
  assert.deepEqual(Object.keys(cases).sort(), Object.keys(builders).sort());
  assert.ok(Object.keys(builders).length >= 14);
  for (const [name, list] of Object.entries(cases)) {
    for (const params of list) {
      const example = builders[name](params, { id: '4.2' });
      assert.deepEqual(validateExample(example), [], `${name} ${JSON.stringify(params)}`);
      assert.equal(example.source, 'auto');
      assert.equal(example.id, '4.2');
      assert.ok(Object.isFrozen(example));
      assert.ok(example.say.join(' ').length <= LIMITS.sayTotal);
    }
    assert.ok(BUILDER_DEFAULTS[name], `${name} has documented defaults`);
  }
  assert.equal(builders.optionPut({}, { id: '9.1', source: 'authored', family: 'custom_family' }).family, 'custom_family');
});

test('builders compute correct numbers and speak them without symbols', () => {
  const put = builders.optionPut();
  assert.equal(put.facts.cost, 200);
  assert.equal(put.facts.breakEven, 43);
  assert.equal(put.facts.netLow, 300);
  assert.equal(put.facts.netHigh, -200);
  assert.match(put.say.join(' '), /price floor for someone who also owns the shares/);
  const partial = builders.optionPut({ low: 44 });
  assert.equal(partial.facts.netLow, -100);
  assert.match(partial.say[2], /still loses \$100/);
  const call = builders.optionCall();
  assert.equal(call.facts.breakEven, 57);
  assert.equal(call.facts.netHigh, 300);
  const size = builders.positionSize();
  assert.deepEqual([size.facts.budget, size.facts.perShare, size.facts.shares, size.facts.position], [20, 0.5, 40, 400]);
  const odd = builders.positionSize({ account: 10000, riskPct: 0.01, entry: 40, stop: 38.7 });
  assert.equal(odd.facts.shares, 76);
  assert.match(odd.say[2], /rounds down to 76 shares/);
  const swing = builders.compound({ start: 100, returns: [0.1, -0.1] });
  assert.equal(swing.facts.final, 99);
  assert.match(swing.say.join(' '), /a loss of 1%/);
  const growth = builders.compound();
  assert.equal(growth.facts.final, 133.1);
  assert.ok(Math.abs(growth.facts.extra - 3.1) < 1e-9);
  const pv = builders.presentValue();
  assert.equal(pv.facts.pv, 100);
  assert.equal(pv.facts.pv2, 91.6666666667);
  assert.match(pv.say[1], /divided by 1\.1, which is \$100 today/);
  const spread = builders.bidAsk();
  assert.deepEqual([spread.facts.spread, spread.facts.mid, spread.facts.hurryTotal], [1, 9.5, 50]);
  const ev = builders.expectedValue();
  assert.equal(ev.facts.ev, 4);
  const drawdown = builders.drawdownRecovery();
  assert.equal(drawdown.facts.after, 700);
  // Speech rounds a long result ("about 43%"); the board keeps the exact figure.
  assert.match(drawdown.say[2], /a gain of about 43%/);
  assert.ok(drawdown.frames.some((frame) => frame.items.some((item) => item.k === 'line' && /42\.86%/.test(item.text))));
  const bond = builders.bondYield();
  assert.equal(bond.facts.price, 95.4545454545);
  assert.match(bond.say[1], /Leo pays about \$95 for it today/);
  assert.match(bond.say[2], /10% more than the \$95 paid/);
  assert.match(builders.presentValue().say[3], /worth about \$92 today/);
  assert.match(put.say[0], /pays Maya \$200, or \$2 a share, for one put/);
  const tree = builders.scenarioTree();
  assert.equal(tree.facts.weighted, 10.5);
  assert.match(tree.say[3], /5% above today's price/);
  const ratio = builders.ratio();
  assert.equal(ratio.facts.r, 0.1);
  assert.equal(ratio.facts.r2, 0.08);
  const candle = builders.candle();
  assert.deepEqual([candle.facts.body, candle.facts.upper, candle.facts.lower, candle.facts.range], [1, 1, 1, 3]);
});

test('builders reject impossible parameters with a clear error', () => {
  assert.throws(() => builders.optionPut({ premium: 50 }), /premium must be below the strike/);
  assert.throws(() => builders.optionPut({ high: 40 }), /high must end at or above the strike/);
  assert.throws(() => builders.optionCall({ high: 50 }), /high must end above the strike/);
  assert.throws(() => builders.positionSize({ stop: 11 }), /stop must be below the entry/);
  assert.throws(() => builders.positionSize({ account: 10, riskPct: 0.01, entry: 10, stop: 9 }), /at least one share/);
  assert.throws(() => builders.percentChange({ after: 40 }), /after must differ/);
  assert.throws(() => builders.expectedValue({ outcomes: [{ label: 'A', p: 0.5, value: 1 }, { label: 'B', p: 0.4, value: 2 }] }), /add up to 1/);
  assert.throws(() => builders.scenarioTree({ branches: [{ label: 'A', p: 1, value: 1 }] }), /2 or 3 paths/);
  assert.throws(() => builders.twoChoices({ situation: 'The strike is $77.' }), /77 is not a computed fact/);
  assert.throws(() => builders.process({ steps: ['One'] }), /2 to 4/);
  assert.throws(() => builders.candle({ high: 10.5 }), /wrap open and close/);
});

test('B() builds authored records from a builder and never throws', () => {
  const record = B('9.3', 'option_call_payoff', 'optionCall', { strike: 60, stock: 58, high: 66, low: 55 });
  assert.deepEqual(record.errors, []);
  assert.equal(record.example.source, 'authored');
  assert.equal(record.example.id, '9.3');
  const broken = B('9.3', 'option_call_payoff', 'optionCall', { high: 1 });
  assert.equal(broken.example, null);
  assert.match(broken.errors.join(' '), /high must end above the strike/);
  assert.match(B('9.3', null, 'noSuchBuilder', {}).errors.join(' '), /unknown builder/);
});

test('autoExample returns a valid auto example for every lesson with its authored example removed', () => {
  for (const lesson of SEED_LESSONS) {
    const example = autoExample(withoutExample(lesson));
    assert.ok(example, key(lesson));
    assert.deepEqual(validateExample(example), [], key(lesson));
    assert.equal(example.source, 'auto');
    assert.equal(example.id, key(lesson));
  }
});

test('autoExample handles future lessons and malformed input without throwing', () => {
  const future = [
    { moduleId: 29, lessonId: 1, title: 'Protective Puts for Shareholders', description: 'Use a put option to cap downside on shares you own.', level: 'Intermediate',
      steps: ['A protective put pairs owned shares with a put. Worked example: the stock is $80 and one $75-strike put costs $3.', 'If the stock finishes at $60 the put pays; if it finishes at $90 it expires.', 'Options lab: compare the insured and uninsured paths.'],
      question: { prompt: 'What does the put protect?' } },
    { moduleId: 29, lessonId: 2, title: 'Risk Budgets and Position Sizing', description: 'Size positions so a stop-out costs a fixed slice of the account.', level: 'Foundation',
      steps: ['Pick the maximum loss before you enter.', 'Divide the risk budget by the risk per share.', 'Risk lab: size three trades with different stops.'], question: { prompt: 'Size follows what?' } },
    { moduleId: 30, lessonId: 1, title: 'Inflation, CPI, and Real Returns', description: 'Separate nominal growth from real growth.', level: 'Intermediate',
      steps: ['CPI tracks the price of a basket.', 'Real return is nominal return minus inflation, roughly.', 'Macro lab: deflate a price series.'], question: { prompt: 'What does CPI measure?' } },
    { moduleId: 31, lessonId: 1, title: 'Insider Trading Rules for New Traders', description: 'Why material nonpublic information is off limits.', level: 'Foundation',
      steps: ['Material nonpublic information cannot be traded on.', 'Tipping others is also prohibited.', 'Law lab: classify five scenarios.'], question: { prompt: 'Which trade is prohibited?' } },
    { moduleId: 32, lessonId: 4, title: 'Probability, Expected Value, and Sampling Error', description: 'Estimate the average outcome and its uncertainty.', level: 'Advanced',
      steps: ['Expected value weights outcomes by probability.', 'Small samples produce noisy estimates.', 'Statistics lab: simulate a coin-flip strategy.'], question: { prompt: 'What does expected value average?' } }
  ];
  const families = [];
  for (const lesson of future) {
    const example = autoExample(lesson);
    assert.deepEqual(validateExample(example), [], lesson.title);
    assert.equal(example.id, key(lesson));
    families.push(example.family);
  }
  assert.equal(families[0], 'option_put_payoff');
  const protective = autoExample(future[0]);
  assert.equal(protective.facts.strike, 75);
  assert.equal(protective.facts.premium, 3);
  assert.equal(protective.facts.low, 60);
  assert.equal(protective.facts.high, 90);
  assert.equal(families[1], 'position_sizing');
  assert.equal(families[3], 'law_insider');
  assert.equal(families[4], 'expected_value');
  for (const odd of [null, undefined, {}, { title: 42 }, { moduleId: 'x', steps: 'nope', question: null }, { moduleId: 1, lessonId: 1, steps: [null, 7] }]) {
    const example = autoExample(odd);
    assert.deepEqual(validateExample(example), []);
    assert.equal(example.source, 'auto');
  }
  const blank = autoExample({ moduleId: 40, lessonId: 1, title: 'Something New', description: 'A topic with no known keywords.', steps: ['Alpha.', 'Beta.', 'Gamma.'] });
  assert.equal(blank.family, 'decision_compare');
});

test('authored examples are strictly valid and reference.js holds the canonical 1.1, 7.1 and 9.1', () => {
  assert.ok(assertAuthoredExamples({ lessons: SEED_LESSONS }) >= 3);
  const data = require('./examples-data');
  assert.deepEqual(data.LOAD_ERRORS, []);
  assert.deepEqual(data.DUPLICATES, []);
  const reference = require('./examples-data/reference');
  assert.deepEqual(reference.map((record) => record.id), ['1.1', '7.1', '9.1']);
  for (const record of reference) assert.equal(data.AUTHORED.get(record.id), record);

  const put = SEED_LESSONS.find((lesson) => key(lesson) === '9.1').example;
  assert.equal(put.source, 'authored');
  assert.equal(put.family, 'option_put_payoff');
  assert.equal(put.facts.stock, 50);
  assert.equal(put.facts.strike, 45);
  assert.equal(put.facts.premium, 2);
  assert.equal(put.facts.cost, 200);
  assert.equal(put.facts.breakEven, 43);
  assert.equal(put.facts.netLow, 300);
  assert.equal(put.facts.netHigh, -200);
  const putSay = put.say.join(' ');
  assert.match(putSay, /Leo pays Maya \$200/);
  assert.match(putSay, /\$43/);
  assert.match(putSay, /\$300/);
  assert.match(putSay, /price floor for someone who also owns the shares/);
  assert.match(putSay, /Pebblestone Phones/);

  const box = SEED_LESSONS.find((lesson) => key(lesson) === '7.1').example;
  // Expectancy uses 50% at 1.5R vs 50% at 1R, not the knowledge check's 40% at 2R vs 60% at 1R.
  assert.deepEqual([box.facts.account, box.facts.budget, box.facts.perShare, box.facts.shares, box.facts.position, box.facts.average, box.facts.averageR],
    [2000, 20, 0.5, 40, 400, 5, 0.25]);
  assert.deepEqual([box.facts.winRate, box.facts.winR, box.facts.winAmount], [0.5, 1.5, 30]);

  const auction = SEED_LESSONS.find((lesson) => key(lesson) === '1.1').example;
  assert.deepEqual([auction.facts.spread, auction.facts.mid, auction.facts.hurry, auction.facts.hurryTotal], [1, 9.5, 0.5, 50]);
  assert.match(auction.say.join(' '), /receipt/);
});

test('attachWorkedExamples falls back to auto for invalid or mismatched authored data', () => {
  const lesson = withoutExample(SEED_LESSONS.find((entry) => key(entry) === '9.1'));
  const invalid = E('9.1', 'option_put_payoff', validSpec({ say: ['The strike is $99.', 'Two.', 'Three.'] }));
  assert.equal(invalid.example, null);
  assert.throws(() => assertAuthoredExamples({ data: { RECORDS: [invalid], AUTHORED: new Map([['9.1', invalid]]), DUPLICATES: ['9.1'], LOAD_ERRORS: [{ module: './m01-13', message: 'SyntaxError' }] } }),
    /9\.1: [\s\S]*authored more than once[\s\S]*cannot load \.\/m01-13|cannot load \.\/m01-13[\s\S]*9\.1/);
  const [fallback] = attachWorkedExamples([lesson], { authored: new Map([['9.1', invalid]]) });
  assert.equal(fallback.example.source, 'auto');
  assert.deepEqual(validateExample(fallback.example), []);
  const elsewhere = E('1.1', 'demo_family', validSpec());
  const [mismatched] = attachWorkedExamples([lesson], { authored: new Map([['9.1', elsewhere]]) });
  assert.equal(mismatched.example.source, 'auto');
  const [authored] = attachWorkedExamples([lesson]);
  assert.equal(authored.example.source, 'authored');
  assert.equal(lesson.example, undefined, 'input lessons are not mutated');
  assert.deepEqual(attachWorkedExamples([lesson]), attachWorkedExamples([lesson]), 'deterministic');
});

test('every SEED lesson gets one example part and identical voice, designer and client parts', () => {
  assert.equal(SEED_LESSONS.length, TOTAL_LESSONS);
  let longest = 0;
  for (const lesson of SEED_LESSONS) {
    const id = key(lesson);
    assert.deepEqual(validateExample(lesson.example), [], id);
    assert.equal(lesson.example.id, id);
    assert.equal(lesson.exampleIndex, 1, id);
    assert.equal(lesson.steps.length, 3, id);
    const parts = lessonParts(lesson);
    assert.equal(parts.length, 6, id);
    assert.deepEqual(lesson.parts, parts, id);
    assert.ok(Object.isFrozen(lesson.parts));
    assert.equal(parts[0], lesson.title);
    assert.equal(parts[1], exampleText(lesson.example));
    assert.equal(parts[1], `${EXAMPLE_LEAD} ${lesson.example.say.join(' ')}`);
    assert.deepEqual(parts.slice(2, 5), lesson.steps);
    assert.equal(parts[5], `Knowledge check. ${lesson.question.prompt}`);
    for (const step of lesson.steps) assert.equal(step.includes(EXAMPLE_LEAD), false, `${id} example must not leak into steps`);
    const voice = narrationFor(lesson);
    assert.equal(voice, parts.join('\n\n'), id);
    assert.equal(voice, partsFor(lesson).join('\n\n'), id);
    assert.deepEqual(partsFor(lesson), lesson.parts, id);
    assert.match(lesson.narrationVersion, HEX12);
    assert.equal(lesson.narrationVersion, narrationVersion(lesson));
    assert.deepEqual(lessonPartsInfo(lesson).exampleIndex, 1);
    const json = JSON.stringify(lesson.example).toLowerCase();
    for (const banned of PAGE_BANNED) assert.equal(json.includes(banned), false, `${id} contains ${banned}`);
    assert.doesNotMatch(json, /\b(?:brian|dave|buster|clear\s?value)\b/);
    longest = Math.max(longest, voice.length);
  }
  assert.ok(longest <= 5000, `longest narration is ${longest} characters`);
});

test('narration versions are stable and change only when narration changes', () => {
  const again = attachWorkedExamples(SEED_LESSONS.map(withoutExample));
  assert.deepEqual(again.map((lesson) => lesson.narrationVersion), SEED_LESSONS.map((lesson) => lesson.narrationVersion));
  const version = curriculumVersion(SEED_LESSONS);
  assert.match(version, HEX12);
  assert.equal(curriculumVersion(again), version);
  const changed = SEED_LESSONS.map((lesson, index) => (index === 0 ? { ...lesson, title: `${lesson.title}!` } : lesson));
  assert.notEqual(curriculumVersion(changed), version);
  assert.notEqual(narrationVersion(changed[0]), SEED_LESSONS[0].narrationVersion);
  assert.equal(new Set(SEED_LESSONS.map((lesson) => lesson.narrationVersion)).size, TOTAL_LESSONS);
});

test('lessonParts keeps the old part list for plain lessons and ignores invalid examples', () => {
  const plain = { title: 'Price Discovery', steps: ['Buyers bid.', 'Sellers offer.'], question: { prompt: 'What is the last price?' } };
  const legacy = [plain.title, ...plain.steps, `Knowledge check. ${plain.question.prompt}`];
  assert.deepEqual(lessonParts(plain), legacy);
  assert.equal(lessonPartsInfo(plain).exampleIndex, -1);
  assert.deepEqual(lessonParts({ ...plain, example: { id: '1.1', say: ['Not a real example.'] } }), legacy);
  assert.deepEqual(lessonParts({ title: 'Only a title' }), ['Only a title']);
  assert.deepEqual(lessonParts(null), []);
  const example = builders.bidAsk({}, { id: '1.1' });
  const parts = lessonParts({ ...plain, example });
  assert.equal(parts.length, 5);
  assert.equal(parts[1], `Here is the simple version. ${example.say.join(' ')}`);
  assert.equal(parts[parts.length - 1], `Knowledge check. ${plain.question.prompt}`);
  assert.equal(lessonParts({ title: 'No check', example, steps: ['One.'] }).length, 3);
  assert.equal(exampleText(null), '');
  // Without a title the example never becomes part 0: the lesson keeps its
  // legacy parts, so voice, designer and client agree (the client only shows
  // an example at an index above 0).
  const untitled = { steps: plain.steps, question: plain.question, example };
  assert.deepEqual(lessonPartsInfo(untitled), { parts: [...plain.steps, `Knowledge check. ${plain.question.prompt}`], exampleIndex: -1, example: null });
  assert.deepEqual(lessonPartsInfo({ ...untitled, title: '' }).exampleIndex, -1);
  assert.equal(lessonPartsInfo({ ...untitled, title: 'Titled' }).exampleIndex, 1);
  const [attached] = attachWorkedExamples([{ moduleId: 9, lessonId: 1, steps: plain.steps, question: plain.question }]);
  assert.equal(attached.example, null);
  assert.equal(attached.exampleIndex, -1);
  assert.equal(attached.parts.some((part) => part.startsWith(EXAMPLE_LEAD)), false);
});

test('the slide designer sends the shared parts and the example sentences with a bigger budget', async () => {
  const lesson = SEED_LESSONS.find((entry) => key(entry) === '9.1');
  const calls = [];
  const slides = lesson.parts.map((text, index) => ({ heading: `Slide ${index + 1}`, visual: 'Whiteboard doodle', callout: 'Verified lesson point.', visualKind: 'options' }));
  const designer = createAcademySlideDesigner({
    apiKey: 'key',
    lessons: SEED_LESSONS,
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ slides }) }] }) };
    }
  });
  const result = await designer.getLessonDesign({ moduleId: 9, lessonId: 1, userId: 'member' });
  assert.equal(result.design.slides.length, 6);
  assert.equal(calls[0].max_tokens, 4000);
  const source = JSON.parse(calls[0].messages[0].content);
  assert.deepEqual(source.narrationParts, lesson.parts);
  assert.deepEqual(source.workedExample, { partIndex: 1, title: lesson.example.title, say: lesson.example.say });
});

test('the validator keeps spoken numbers speakable, sentences short and abbreviations spelled out', () => {
  const spec = (say) => ({
    given: { a: 100, b: 105 },
    calc: { pv: 'a / 1.05', share: 'a / b' },
    say,
    frames: [{ cue: 0, items: [{ k: 'line', text: 'Exact on the board: {pv|usd}' }] }]
  });
  const errors = (say) => E('1.1', 'demo_family', spec(say)).errors.join(' ');
  // A two-decimal rounding of a longer result is for the board, not the voice.
  assert.match(errors(['It is worth {pv|usd} today.', 'Two.', 'Three.']), /95\.24 is a silently rounded result/);
  assert.match(errors(['That is {share|pct} of it.', 'Two.', 'Three.']), /95\.24 is a silently rounded result/);
  assert.equal(errors(['It is worth about {pv|usdr} today.', 'That is about {share|pctr} of it.', 'Three.']), '');
  assert.equal(E('1.1', 'demo_family', spec(['It is worth about {pv|usdr} today.', 'Two.', 'Three.'])).example.say[0], 'It is worth about $95 today.');
  assert.equal(formatValue(0.428571, 'pctr'), '43%');
  assert.equal(formatValue(0.0954, 'pctr'), '9.5%');
  assert.equal(formatValue(4.5454, 'usdr'), '$4.50');
  // Sentences the ear can follow, and no "Co." that sounds like a full stop.
  const long = `${Array.from({ length: 26 }, (_, index) => `w${index}`).join(' ')}.`;
  assert.match(errors([long, 'Two.', 'Three.']), /26 words is hard to follow by ear/);
  assert.match(errors(['Zoe lends to Shaky Shoe Co. at a high rate.', 'Two.', 'Three.']), /spell out "Co\."/);
  assert.equal(LIMITS.sayWords, 25);
});

test('the validator rejects labels the whiteboard would shrink or overlap on a 270px deck', () => {
  const base = { given: { a: 100 }, say: ['One.', 'Two.', 'Three.'] };
  const actor = E('1.1', 'demo_family', { ...base, frames: [{ cue: 0, items: [
    { k: 'actors', left: { name: 'Parking and sales', icon: 'shop' }, right: { name: 'Leo', icon: 'person' }, flows: [] }
  ] }] });
  assert.match(actor.errors.join(' '), /"Parking and sales" drops to 10 on a 270px deck; shorten it/);
  const crowded = E('1.1', 'demo_family', { ...base, given: { a: 100, b: 101, c: 102, d: 150 }, frames: [{ cue: 0, items: [
    { k: 'numberLine', marks: [{ at: 'a', label: 'Maya {a|usd}' }, { at: 'b', label: 'Leo {b|usd}' }, { at: 'c', label: 'Zoe {c|usd}' }, { at: 'd', label: 'End {d|usd}' }] }
  ] }] });
  assert.match(crowded.errors.join(' '), /number line labels .* overlap/);
  // Builders pick a shorter label instead of failing.
  const big = builders.optionPut({ strike: 1250, stock: 1300, premium: 42.5, low: 1100, high: 1400, shares: 1000, buyer: 'Kofi', seller: 'Zoe' });
  const bars = big.frames.flatMap((frame) => frame.items).find((item) => item.k === 'bars');
  assert.deepEqual(bars.items.map((bar) => bar.text), ['+$107,500', '-$42,500']);
  const close = builders.optionPut({ low: 44 });
  const marks = close.frames.flatMap((frame) => frame.items).find((item) => item.k === 'numberLine').marks;
  assert.equal(marks.some((mark) => /Break-even/.test(mark.label)), false, 'bunched marks drop the break-even label (it is on its own line)');
});

test('authored examples use one distinct fictional cast', () => {
  const { PEOPLE } = examples;
  // Common first names (including every one the examples used before the cast
  // was unified): any of them in an authored example must be a cast member.
  const COMMON = ['Aaron', 'Adam', 'Alex', 'Ali', 'Amir', 'Ana', 'Anna', 'Ava', 'Ben', 'Carlos', 'Chen', 'Chloe', 'Dan', 'Dana', 'David', 'Diego', 'Ella', 'Elena', 'Emma', 'Eric', 'Ethan', 'Grace', 'Hana', 'Hugo', 'Ian', 'Iris', 'Isla', 'Jack', 'Jade', 'Jake', 'James', 'Jay', 'Jin', 'Jon', 'Kai', 'Kate', 'Kim', 'Kofi', 'Lena', 'Leo', 'Liam', 'Lily', 'Lina', 'Lucas', 'Luis', 'Luna', 'Maria', 'Maya', 'Mia', 'Mila', 'Milo', 'Nia', 'Nina', 'Noah', 'Nora', 'Omar', 'Owen', 'Pia', 'Priya', 'Rae', 'Ravi', 'Rex', 'Ria', 'Rosa', 'Ruby', 'Sam', 'Sara', 'Sofia', 'Tara', 'Theo', 'Tom', 'Uma', 'Yara', 'Zara', 'Zoe'];
  const cast = new Set(PEOPLE);
  const strings = (value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings)
    : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
  const check = (where, value) => {
    for (const text of strings(value)) {
      for (const [word] of text.matchAll(/\b[A-Z][a-z]+\b/g)) {
        if (COMMON.includes(word)) assert.ok(cast.has(word), `${where} uses "${word}", which is not in the cast`);
      }
    }
  };
  for (const lesson of SEED_LESSONS) check(key(lesson), [lesson.example.title, lesson.example.say, lesson.example.frames]);
  for (const template of [...examples.TWO_CHOICE_TEMPLATES, ...examples.PROCESS_TEMPLATES]) check(template.id, template.params);
  // Cast names do not collide by ear: no two share both a first and a last letter.
  const shapes = PEOPLE.map((name) => `${name[0]}${name.at(-1)}`);
  assert.equal(new Set(shapes).size, PEOPLE.length);
});

test('autoExample only uses a specific builder when the lesson title names its topic', () => {
  const byId = (id) => withoutExample(SEED_LESSONS.find((lesson) => key(lesson) === id));
  for (const id of ['14.3', '16.1', '16.2', '16.3', '16.5', '17.5', '20.2', '21.1', '21.3', '22.4', '22.5', '24.3', '28.3']) {
    assert.equal(autoExample(byId(id)).family, 'decision_compare', `${id} gets the neutral fallback, not an off-topic example`);
  }
  assert.equal(autoExample(byId('12.2')).family, 'game_theory');
  assert.equal(autoExample(byId('9.1')).family, 'option_put_payoff');
  assert.equal(autoExample(byId('16.4')).family, 'rates_transmission');
  assert.equal(autoExample(byId('23.1')).family, 'forward_contract');
  // A strong word that only appears in a step is not enough.
  const stepOnly = { moduleId: 41, lessonId: 1, title: 'Reading Charts Calmly', description: 'Patience first.', steps: ['A $45-strike put costs $2.', 'Wait.', 'Review.'] };
  assert.equal(autoExample(stepOnly).family, 'decision_compare');
});

test('reviewed examples keep their corrected numbers and wording', () => {
  const ex = (id) => SEED_LESSONS.find((lesson) => key(lesson) === id).example;
  const said = (id) => ex(id).say.join(' ');
  const items = (id) => ex(id).frames.flatMap((frame) => frame.items);
  // 21.3: a capital call moves cash into the locked part; only scholarships leave.
  assert.deepEqual([ex('21.3').facts.locked1, ex('21.3').facts.total1, ex('21.3').facts.share1R], [70, 85, 0.18]);
  // "$15 million", so the voice never reads "$15" as fifteen dollars.
  assert.match(said('21.3'), /only \$15 million of \$85 million, about 18%/);
  assert.doesNotMatch(JSON.stringify(ex('21.3')), /\$75M/);
  // 26.4: the owners' average counts the bonus they pay.
  assert.deepEqual([ex('26.4').facts.riskyAvg, ex('26.4').facts.ownersRisky], [4, 3.5]);
  assert.match(said('26.4'), /\$3\.5 million for the owners/);
  // 9.2: one consistent option (gamma 0.05); the high-gamma case is a different option.
  assert.deepEqual([ex('9.2').facts.gamma, ex('9.2').facts.newDelta, ex('9.2').facts.nearDelta, ex('9.2').facts.nearGain], [0.05, 0.55, 0.8, 0.65]);
  assert.match(said('9.2'), /implied volatility, the market's guess of future swings/);
  assert.doesNotMatch(JSON.stringify(ex('9.2')), /Gamma 0\.3|vega \+\$20/);
  // 9.2: vega has a direction, and the averaging step behind $0.65 is spoken.
  assert.match(said('9.2'), /vega adds \$0\.10 per one-point rise in implied volatility, .*and a drop removes it/);
  assert.match(said('9.2'), /delta climbs from 0\.5 to 0\.8 during the rise, averaging about 0\.65, a gain near \$0\.65/);
  // 17.x: the 1% is the standard deviation, and a strong t is not "almost surely not luck".
  assert.match(said('17.1'), /standard deviation, of 1% a day/);
  assert.match(said('17.2'), /standard deviation, of 5%/);
  assert.match(said('17.3'), /standard wiggle of \$5/);
  assert.doesNotMatch(JSON.stringify(ex('17.3')), /not luck/);
  assert.match(said('17.3'), /very rare if the rule had no real edge/);
  // 3.1: no loss before an entry; 10.2: strength leads to a possible entry, not an exit.
  assert.deepEqual(items('3.1').find((item) => item.k === 'tree').branches.map((branch) => branch.text), ['Buy, exit below $19', 'Idea wrong: stay out']);
  assert.match(ex('10.2').say[4], /he could buy there with a \$14\.70 exit/);
  // 12.1: the stock dips (stopping Maya out) before it pops.
  assert.ok(said('12.1').indexOf('dips to $9.50') < said('12.1').indexOf('pops to $10.40'));
  // 28.1: a fill above $21 risks more than $0.50 a share.
  assert.match(said('28.1'), /risking at least 100 times \$0\.50/);
  // 20.3: the forever shortfall is spoken, not only drawn.
  assert.match(said('20.3'), /\$20 divided by 10%, or \$200/);
  // 15.2: cups sold and money in, never an ambiguous "sales".
  assert.doesNotMatch(said('15.2'), /\bsales\b/);
  // 20.1: Pillow Mills appears when it is first spoken.
  const pillow = ex('20.1').frames.find((frame) => frame.items.some((item) => /Pillow/.test(item.text || '')));
  assert.equal(pillow.cue, ex('20.1').say.findIndex((sentence) => /Pillow/.test(sentence)));
  // 9.1: the per-share premium is spoken before it is used.
  assert.match(ex('9.1').say[1], /^That premium is \$2 a share/);
  // 1.1: Maya bids $9, then pays the $10 ask because she is in a hurry.
  assert.doesNotMatch(said('1.1'), /up to/);
  assert.match(said('1.1'), /at \$9, her bid, .* at \$10, his ask\. .*in a hurry, so she pays Leo's \$10 ask/);
  // 10.1: buyers lift (take) the offer; sellers would hit the bid.
  assert.doesNotMatch(said('10.1'), /\bhit\b/);
  assert.match(said('10.1'), /Buyers lift that offer, paying \$10/);
  // 2.2: "spread" is the bid-ask gap; volatility is how far returns swing.
  assert.doesNotMatch(JSON.stringify([ex('2.2').say, ex('2.2').frames]), /spread/i);
  // 3.2: the story ends inside the volume example; it does not restate the
  // knowledge check's RSI lookback explanation.
  assert.doesNotMatch(JSON.stringify([ex('3.2').say, ex('3.2').frames]), /RSI|lookback|nois/i);
  assert.match(said('3.2'), /did price stay above the line, and was volume above normal\?/);
  // 8.2: a true walk-forward test refits, tests the next unseen year, and rolls.
  assert.match(said('8.2'), /years one to three, then tests it on unseen year four/);
  assert.match(said('8.2'), /walks forward: pick again on years two to four, test on year five, and repeat/);
  // 5.2: Crumb's P/E doubles because its earnings halve; Rise Up's falls on growth.
  assert.match(said('5.2'), /Crumb's doubles because its earnings halve, and Rise Up's falls because its earnings grow 25%/);
  assert.deepEqual([ex('5.2').facts.peA, ex('5.2').facts.fwdA, ex('5.2').facts.peB, ex('5.2').facts.fwdB], [10, 20, 25, 20]);
  // 14.3: the carts' $10 average needs rain and sun to be equally likely.
  assert.match(said('14.3'), /still averages \$10 if rain and sun are equally likely/);
  // 17.3: costs are taken out of Leo's edge; nothing flows back to him.
  const fees = items('17.3').find((item) => item.k === 'actors');
  assert.deepEqual(fees.flows.map((flow) => flow.dir), ['right']);
  assert.ok(items('17.3').some((item) => item.k === 'line' && item.text === 'Edge $0.20 − costs $0.50 = -$0.30'));
  // 18.4: rent counted as debt is added back to earnings (lease-adjusted leverage).
  assert.deepEqual([ex('18.4').facts.claims, ex('18.4').facts.beforeRent, ex('18.4').facts.lev2], [300, 120, 2.5]);
  assert.match(said('18.4'), /add the \$20 rent back to earnings: \$300 divided by \$120 is 2\.5 years/);
  // 18.5: operating cash flow was negative this year, not "fell by".
  assert.match(said('18.5'), /operating cash flow was minus \$100, a gap of \$600/);
  assert.doesNotMatch(said('18.5'), /fell by/);
  // 21.1: no unexplained optimizer constant or mixed %/decimal math on the board.
  assert.doesNotMatch(JSON.stringify(ex('21.1').frames), /0\.02|0\.5 \+|÷ 0\./);
  assert.ok(items('21.1').some((item) => item.k === 'line' && item.text === 'Fund A: 50% → 100% of the pot'));
  // 23.1: a storable good, and the $7 gap IS the basis.
  assert.doesNotMatch(JSON.stringify(ex('23.1')), /berr|crate|part of what/i);
  assert.match(said('23.1'), /wheat/);
  assert.match(said('23.1'), /That \$7 gap between the futures price and today's price is the basis/);
  // 2.2: the worked case is up 20%, down 20%, not the knowledge check's 10% and 10%.
  assert.deepEqual([ex('2.2').facts.after1, ex('2.2').facts.after2, ex('2.2').facts.total], [120, 96, -0.04]);
  assert.doesNotMatch(said('2.2'), /\b10%/);
  // 3.1: the exit fills after a close below the stop, so the risk is at least $2.
  assert.match(said('3.1'), /risks at least \$2 a share/);
  assert.doesNotMatch(JSON.stringify(ex('3.1')), /assume a bounce|Wait for evidence/i);
  // 10.1: below $9.90 it is the buy idea that is dropped; 6,000 is 6x what showed.
  assert.match(said('10.1'), /he drops the buy idea below \$9\.90/);
  assert.doesNotMatch(JSON.stringify(ex('10.1').frames), /refilled/);
  // 11.1: the check's own words (filed prospectus, repost) are left for the learner.
  assert.doesNotMatch(JSON.stringify(ex('11.1')), /prospectus|repost/i);
  // 15.1: the frost cuts supply by 40 at every price; at $4 growers bring only 20.
  assert.equal(ex('15.1').facts.qs0, 20);
  assert.match(said('15.1'), /At \$4, growers now bring only 20/);
  assert.doesNotMatch(JSON.stringify(ex('15.1')), /All prices change|wipes out/);
  // 15.5: a signal is credible because fakers find it costlier, not because it costs.
  assert.doesNotMatch(JSON.stringify(ex('15.5')), /Costly signals get believed/);
  // 17.2: the 95% range is two errors either side, and that is spoken.
  assert.match(said('17.2'), /about two errors either side of 1%: minus 1% to 3%/);
  // 19.2 and 19.5: the tax rate and the forever condition are spoken.
  assert.match(said('19.2'), /with a 20% tax rate/);
  assert.match(said('19.5'), /if the cafe earns \$10 every year forever/);
  // 20.5: a steady $100 a year, not "flat" (today's $50).
  assert.doesNotMatch(JSON.stringify(ex('20.5')), /flat forever/i);
  // 22.2: each bond moves by its own duration, then the half-and-half average.
  assert.deepEqual([ex('22.2').facts.shortMove, ex('22.2').facts.longMove, ex('22.2').facts.twistB], [-0.01, 0.09, 0.04]);
  assert.match(said('22.2'), /short half drops 1% and its long half gains 9%/);
  // 22.5: why a $14 gap forces a $70 sale is spoken.
  assert.match(said('22.5'), /cuts his borrowing limit by \$0\.80, closing only \$0\.20 of the gap/);
  // 28.3: buyers take the offer, and "Up 0¢" appears with the sentence that reveals it.
  assert.doesNotMatch(said('28.3'), /\bhit/);
  assert.equal(ex('28.3').frames.find((frame) => frame.items.some((item) => item.k === 'bars')).cue, 2);
});

/* The example plays just before the knowledge check, so it must teach the
 * idea without handing over the correct option's wording. Content words of
 * the correct option (4 or more of them; shorter options are concept names
 * the example has to use) may not reappear together in one sentence or one
 * board item. */
const CHECK_STOP = new Set(('a an the and or but of to in on at for by with from is are was were be been it its this that these those as not no than then so if when can may might will would should do does did has have had he she they his her their who what which there here into out up down about over only just also very more most less least one two').split(' '));
const checkWords = (text) => new Set((String(text).toLowerCase().match(/[a-z][a-z'-]*/g) || [])
  .map((word) => word.replace(/'s$/, '')).filter((word) => word.length > 2 && !CHECK_STOP.has(word))
  .map((word) => word.replace(/(ing|ed|es|s)$/, '')));
const answerEcho = (text, answer) => {
  const want = checkWords(answer);
  const have = checkWords(text);
  return want.size ? [...want].filter((word) => have.has(word)).length / want.size : 0;
};
function exampleStrings(example) {
  const out = [...example.say];
  for (const frame of example.frames) {
    for (const item of frame.items) {
      if (item.k === 'line') out.push(item.text);
      else out.push(itemTexts(item).join(' '));
    }
  }
  return out;
}

test('no example repeats its knowledge-check answer nearly word for word (every lesson)', () => {
  assert.equal(SEED_LESSONS.length, TOTAL_LESSONS);
  for (const lesson of SEED_LESSONS) {
    const answer = lesson.question.options[lesson.question.correct];
    if (checkWords(answer).size < 4) continue;
    for (const text of exampleStrings(lesson.example)) {
      assert.ok(answerEcho(text, answer) < 0.75, `${key(lesson)}: "${text}" nearly repeats the knowledge-check answer "${answer}"`);
    }
  }
  // The check catches the earlier closings that copied the answer.
  assert.ok(answerEcho('A red flag is a reason to investigate, not a verdict.', 'A red flag is a reason to investigate, not a verdict.') >= 0.75);
  assert.ok(answerEcho('A stop order cannot promise a fill price through a gap or a halt.', 'A stop order cannot guarantee a fill price through a gap or halt.') >= 0.75);
});

/* Every number a non-line item (actors, big, numberLine, bars, tree, compare,
 * steps, stamp) shows, paired with the first sentence that says it. Non-line
 * items appear with their frame, so a number said only in a later sentence is
 * revealed early. A spoken "about 9.5%" or "about $95" counts as saying a
 * board's 9.54% or $95.24; units must match ($, % or a plain number). */
const SPOKEN_NUMBER = /(\b(?:about|roughly|nearly|almost|around)\s+)?(\$?\d[\d,]*(?:\.\d+)?%?)/gi;
function numbersIn(text) {
  return [...String(text).matchAll(SPOKEN_NUMBER)].map((match) => {
    const token = match[2].replace(/[.,]$/, '');
    const unit = token.startsWith('$') ? '$' : token.endsWith('%') ? '%' : '';
    return { token, unit, approx: Boolean(match[1]), value: Number(token.replace(/[$,%]/g, '')) };
  });
}
function itemTexts(item) {
  switch (item.k) {
    case 'actors': return [item.left.name, item.right.name, ...item.flows.map((flow) => flow.text)];
    case 'big': return [item.text, item.label || ''];
    case 'numberLine': return item.marks.map((mark) => mark.label);
    case 'bars': return item.items.flatMap((bar) => [bar.label, bar.text]);
    case 'tree': return [item.root, ...item.branches.flatMap((branch) => [branch.label, branch.text])];
    case 'compare': return [item.left.title, ...item.left.lines, item.right.title, ...item.right.lines];
    case 'steps': return item.items;
    case 'stamp': return [item.text];
    default: return [];
  }
}
function earlyReveals(example) {
  const said = example.say.map(numbersIn);
  const firstSaid = (shown) => said.findIndex((sentence) => sentence.some((spoken) => spoken.unit === shown.unit &&
    (spoken.value === shown.value || (spoken.approx && [examples.roundTo(shown.value, 0), examples.roundTo(shown.value, 1)].includes(spoken.value)))));
  const problems = [];
  for (const frame of example.frames) {
    for (const item of frame.items) {
      if (item.k === 'line') continue;
      for (const shown of itemTexts(item).flatMap(numbersIn)) {
        const first = firstSaid(shown);
        if (first > frame.cue) problems.push(`${example.id}: ${item.k} shows ${shown.token} at sentence ${frame.cue}, but it is first said in sentence ${first}`);
      }
    }
  }
  return problems;
}

test('non-line whiteboard items never show a number before the voice says it (every lesson)', () => {
  assert.equal(SEED_LESSONS.length, TOTAL_LESSONS);
  for (const lesson of SEED_LESSONS) assert.deepEqual(earlyReveals(lesson.example), [], key(lesson));
  // The check itself catches a big, bars, compare or tree value shown a
  // sentence early, including one the voice only says rounded ("about 9.5%").
  const early = E('14.1', 'demo_family', {
    given: { total: 1.44, years: 4, a: 20, b: 44 },
    calc: { rate: 'total ^ (1 / years) - 1' },
    say: ['Leo has two numbers.', 'They are {a|usd} and {b|usd}.', 'That is about {rate|pctr} a year.'],
    frames: [{ cue: 0, items: [
      { k: 'big', text: '{rate|pct}', label: 'Per year' },
      { k: 'bars', items: [{ label: 'A', value: 'a', text: '{a|usd}' }, { label: 'B', value: 'b', text: '{b|usd}' }] },
      { k: 'compare', left: { title: 'A', lines: ['{a|usd}'] }, right: { title: 'B', lines: ['{b|usd}'] } },
      { k: 'tree', root: 'Paths', branches: [{ label: 'Up', text: '{b|usd}' }, { label: 'Down', text: '{a|usd}' }] }
    ] }]
  }).example;
  const found = earlyReveals(early).join(' | ');
  for (const kind of ['big shows 9.54%', 'bars shows $20', 'compare shows $44', 'tree shows $44']) assert.match(found, new RegExp(kind.replace(/[$.]/g, '\\$&')));
  // Lines keep their own cue; a line cued to its sentence is never flagged.
  const cued = { ...early, frames: [{ cue: 0, items: [{ k: 'line', text: 'Rate: 9.54%', cue: 2 }] }] };
  assert.deepEqual(earlyReveals(cued), []);
});
