'use strict';

/* Making Easy Money Academy: whiteboard "simple version" worked examples.
 *
 * Original Academy material. Every person and company is fictional, every
 * number is computed here in code, and every display string is pre-formatted
 * here so the Activity client never does math. Educational only: no advice,
 * no guarantees, no real tickers and no real market events.
 *
 * Pieces:
 *   evaluate()            safe arithmetic (no eval / new Function)
 *   FORMATS / formatValue placeholder formatters ({name|usd} ...)
 *   E() / B()             authored data (spec or builder params) -> record
 *   validateExample()     the contract validator (limits, symbols, numbers)
 *   builders.*            14 generators that turn small params into examples
 *   autoExample()         picks a builder + params for ANY lesson; never throws
 *   attachWorkedExamples  lesson.example / exampleIndex / parts / narrationVersion
 */

const { lessonPartsInfo, partsVersion } = require('./lesson-parts');

/* ------------------------------------------------------------------ */
/* Contract constants                                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_TITLE = 'The simple version';
const ICONS = Object.freeze(['person', 'person2', 'company', 'bank', 'shop', 'robot', 'city', 'crowd', 'judge', 'coin', 'chart', 'house']);
const TONES = Object.freeze(['good', 'bad', 'key', 'note']);
const ITEM_KINDS = Object.freeze(['actors', 'big', 'line', 'numberLine', 'bars', 'tree', 'steps', 'compare', 'candle', 'stamp']);
const LIMITS = Object.freeze({
  title: 40,
  text: 34,
  big: 14,
  markLabel: 16,
  barLabel: 12,
  stepText: 14,
  compareLine: 18,
  stamp: 30,
  sayMin: 3,
  sayMax: 6,
  sayTotal: 520,
  sayWords: 25,
  framesMin: 1,
  framesMax: 3,
  itemsPerFrame: 5,
  smallNumber: 12,
  facts: 60,
  json: 8000
});
const RECORD_KIND = 'sml-academy-authored-example';

const FORBIDDEN_NAMES = /\b(?:brian|dave|buster|clear\s?value)\b/i;
const FORBIDDEN_PAGE_STRINGS = Object.freeze(['<iframe', 'location.assign', 'claude designed', 'playing grandmaster-obi', 'next lesson is preloading']);
const ADVICE_PHRASES = [
  /\byou should (?:buy|sell|short)\b/i,
  /\b(?:buy|sell) (?:it )?now\b/i,
  /\bcan(?:'|no)?t lose\b/i,
  /\bsure thing\b/i,
  /\brisk[- ]free (?:profit|money|return)s?\b/i,
  /\bfree money\b/i,
  /(?<!\bnot )(?<!\bnever )(?<!\bno )\bguaranteed? (?:profit|return|income|gain|win)s?\b/i
];
const CASHTAG = /\$[A-Za-z]{1,5}\b/;
/* Symbols the voice would read badly or literally. Frames may use them. */
const SAY_SYMBOLS = /[−–—×÷→←=*^<>≈±/\\|{}[\]#@~_`]/;
const SAY_SIGNED_NUMBER = /(?:^|[\s(])[+\-]\s?\$?\d/;
const SAY_TIMES_X = /\d\s*x\s*\d|\d(?:\.\d+)?x\b/i;
/* "Shoe Co. at 12%": the voice may hear a sentence end after the period. */
const SAY_ABBREVIATION = /\b(?:Co|Inc|Corp|Ltd|Mr|Mrs|Ms|Dr|St|vs|etc)\.(?=\s|$)/;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Numbers and the safe evaluator                                      */
/* ------------------------------------------------------------------ */

function snap(value) {
  return Number(Number(value).toPrecision(12));
}

/* Round half away from zero to d decimals, tolerant of binary noise
 * (1.005 -> 1.01, 0.1 + 0.2 -> 0.3). */
function roundTo(value, decimals = 0) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) throw new Error('round() decimals must be an integer from 0 to 10');
  if (!Number.isFinite(value)) throw new Error('round() needs a finite number');
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  const result = Math.sign(value) * Math.round(scaled) / factor;
  return Object.is(result, -0) ? 0 : result;
}

const FUNCTIONS = Object.freeze({
  max: [1, 32, (...args) => Math.max(...args)],
  min: [1, 32, (...args) => Math.min(...args)],
  abs: [1, 1, (x) => Math.abs(x)],
  round: [1, 2, (x, d = 0) => roundTo(x, d)],
  floor: [1, 1, (x) => Math.floor(snap(x))],
  ceil: [1, 1, (x) => Math.ceil(snap(x))],
  sqrt: [1, 1, (x) => {
    if (x < 0) throw new Error('sqrt() of a negative number');
    return Math.sqrt(x);
  }],
  ln: [1, 1, (x) => {
    if (!(x > 0)) throw new Error('ln() needs a positive number');
    return Math.log(x);
  }],
  exp: [1, 1, (x) => Math.exp(x)],
  pow: [2, 2, (x, y) => Math.pow(x, y)]
});

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    const rest = source.slice(index);
    let match = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(rest);
    if (match) {
      tokens.push({ type: 'num', text: match[0], value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (match) {
      tokens.push({ type: 'id', text: match[0] });
      index += match[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(char)) {
      tokens.push({ type: 'op', text: char });
      index += 1;
      continue;
    }
    throw new Error(`unexpected character "${char}"`);
  }
  return tokens;
}

/* Grammar (usual precedence, ^ right-associative and tighter than unary minus):
 *   expr  := term (('+'|'-') term)*
 *   term  := unary (('*'|'/') unary)*
 *   unary := ('-'|'+') unary | power
 *   power := primary ('^' unary)?
 *   primary := number | name | fn '(' expr (',' expr)* ')' | '(' expr ')'   */
function evaluate(expression, scope = {}) {
  if (typeof expression === 'number') {
    if (!Number.isFinite(expression)) throw new Error('number is not finite');
    return expression;
  }
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('expression must be a non-empty string');
  if (expression.length > 300) throw new Error('expression is longer than 300 characters');
  const values = scope && typeof scope === 'object' ? scope : {};
  const tokens = tokenize(expression);
  let position = 0;
  let depth = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isOp = (token, text) => Boolean(token) && token.type === 'op' && token.text === text;
  const finite = (value) => {
    if (!Number.isFinite(value)) throw new Error('result is not a finite number');
    return value;
  };
  const enter = () => {
    depth += 1;
    if (depth > 64) throw new Error('expression is nested too deeply');
  };
  const leave = () => { depth -= 1; };
  const expect = (text) => {
    const token = next();
    if (!isOp(token, text)) throw new Error(`expected "${text}"${token ? ` but found "${token.text}"` : ' at the end'}`);
  };

  function parseExpr() {
    enter();
    let value = parseTerm();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = next().text;
      const right = parseTerm();
      value = finite(op === '+' ? value + right : value - right);
    }
    leave();
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = next().text;
      const right = parseUnary();
      if (op === '/' && right === 0) throw new Error('division by zero');
      value = finite(op === '*' ? value * right : value / right);
    }
    return value;
  }

  function parseUnary() {
    if (isOp(peek(), '-') || isOp(peek(), '+')) {
      const op = next().text;
      enter();
      const value = parseUnary();
      leave();
      return op === '-' ? -value : value;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (isOp(peek(), '^')) {
      next();
      enter();
      const exponent = parseUnary();
      leave();
      return finite(Math.pow(base, exponent));
    }
    return base;
  }

  function parsePrimary() {
    const token = next();
    if (!token) throw new Error('unexpected end of expression');
    if (token.type === 'num') return token.value;
    if (isOp(token, '(')) {
      const value = parseExpr();
      expect(')');
      return value;
    }
    if (token.type === 'id') {
      if (isOp(peek(), '(')) {
        if (!hasOwn(FUNCTIONS, token.text)) throw new Error(`unknown function "${token.text}"`);
        next();
        const args = [];
        if (isOp(peek(), ')')) {
          next();
        } else {
          args.push(parseExpr());
          while (isOp(peek(), ',')) {
            next();
            args.push(parseExpr());
          }
          expect(')');
        }
        const [minArgs, maxArgs, fn] = FUNCTIONS[token.text];
        if (args.length < minArgs || args.length > maxArgs) throw new Error(`${token.text}() takes ${minArgs === maxArgs ? minArgs : `${minArgs} to ${maxArgs}`} argument(s)`);
        return finite(fn(...args));
      }
      if (!hasOwn(values, token.text)) throw new Error(`unknown name "${token.text}"`);
      const value = values[token.text];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${token.text}" is not a finite number`);
      return value;
    }
    throw new Error(`unexpected "${token.text}"`);
  }

  const result = parseExpr();
  if (position < tokens.length) throw new Error(`unexpected "${tokens[position].text}"`);
  return finite(result);
}

/* ------------------------------------------------------------------ */
/* Formatters                                                           */
/* ------------------------------------------------------------------ */

function groupDigits(integerText) {
  return integerText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function plain(absValue, decimals, grouped) {
  let text = absValue.toFixed(decimals);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (!grouped) return text;
  const [whole, fraction] = text.split('.');
  return groupDigits(whole) + (fraction ? `.${fraction}` : '');
}

function signOf(rounded, signed) {
  if (rounded < 0) return '-';
  return signed && rounded > 0 ? '+' : '';
}

function money(value, mode, signed = false) {
  const rounded = roundTo(value, mode === 'whole' ? 0 : 2);
  const abs = Math.abs(rounded);
  const body = Number.isInteger(abs) ? groupDigits(abs.toFixed(0)) : (() => {
    const [whole, fraction] = abs.toFixed(2).split('.');
    return `${groupDigits(whole)}.${fraction}`;
  })();
  return `${signOf(rounded, signed)}$${body}`;
}

function percent(value, signed = false) {
  const rounded = roundTo(value * 100, 2);
  return `${signOf(rounded, signed)}${plain(Math.abs(rounded), 2, true)}%`;
}

function number(value, grouped, signed = false) {
  const rounded = roundTo(value, 2);
  return `${signOf(rounded, signed)}${plain(Math.abs(rounded), 2, grouped)}`;
}

/* Speech rounding: whole units from 10 up, one decimal below that
 * ($95.24 -> "$95", 42.86% -> "43%", 9.54% -> "9.5%", $4.55 -> "$4.50"). */
function spokenRound(value) {
  return Math.abs(value) >= 10 ? roundTo(value, 0) : roundTo(value, 1);
}

function times(value) {
  const rounded = roundTo(value, 2);
  const abs = Math.abs(rounded);
  const body = Number.isInteger(abs) ? groupDigits(abs.toFixed(0)) : abs.toFixed(2);
  return `${signOf(rounded, false)}${body}x`;
}

/* Contract formats: usd, usd0, pct, pts, num, x. Extras: susd, spct, snum
 * (signed: "+$300", "+5%", "+12") and the spoken roundings usdr, pctr, numr
 * ("about {pv|usdr}" -> "about $95"). A bare {name} means {name|num}. */
const FORMATS = Object.freeze({
  usd: (value) => money(value, 'auto'),
  usd0: (value) => money(value, 'whole'),
  pct: (value) => percent(value),
  pts: (value) => number(value, false),
  num: (value) => number(value, true),
  x: (value) => times(value),
  susd: (value) => money(value, 'auto', true),
  spct: (value) => percent(value, true),
  snum: (value) => number(value, true, true),
  usdr: (value) => money(spokenRound(value), 'auto'),
  pctr: (value) => percent(spokenRound(value * 100) / 100),
  numr: (value) => number(spokenRound(value), true)
});

/* Would formatting this value silently round it? ("$95.24" for 95.238...) */
function formatRounds(value, format) {
  if (typeof value !== 'number' || !Number.isFinite(value) || format === 'usd0' || /r$/.test(format)) return false;
  const scaled = format === 'pct' || format === 'spct' ? value * 100 : value;
  return Math.abs(roundTo(scaled, 2) - scaled) > 1e-9;
}
const SPOKEN_FORMAT = Object.freeze({ usd: 'usdr', pct: 'pctr', pts: 'numr', num: 'numr' });

function formatValue(value, format = 'num') {
  if (!hasOwn(FORMATS, format)) throw new Error(`unknown format "${format}"`);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('formatValue needs a finite number');
  return FORMATS[format](value);
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)(?:\|([A-Za-z0-9]+))?\}/g;

function resolveText(text, facts, where, errors) {
  if (typeof text !== 'string') {
    errors.push(`${where}: expected text`);
    return '';
  }
  let failed = false;
  const output = text.replace(PLACEHOLDER, (match, name, format = 'num') => {
    if (!hasOwn(facts, name)) {
      failed = true;
      errors.push(`${where}: unknown placeholder ${match}`);
      return match;
    }
    if (!hasOwn(FORMATS, format)) {
      failed = true;
      errors.push(`${where}: unknown format "${format}" in ${match}`);
      return match;
    }
    return FORMATS[format](facts[name]);
  });
  if (!failed && /[{}]/.test(output)) errors.push(`${where}: unmatched "{" or "}"`);
  return output;
}

/* Fills placeholders in builder templates; throws on any problem. */
function filler(facts) {
  return (template) => {
    const errors = [];
    const output = resolveText(template, facts, 'template', errors);
    if (errors.length) throw new Error(errors.join('; '));
    return output;
  };
}

/* Like filler(), for sentences the voice reads: a value the format would
 * silently round ($95.238 -> "$95.24") is spoken rounded instead, with
 * "about" in front ("about $95"). The board keeps the exact figure. */
function spokenFiller(facts) {
  const T = filler(facts);
  return (template) => T(String(template).replace(PLACEHOLDER, (match, name, format, offset, whole) => {
    const kind = format || 'num';
    if (!hasOwn(facts, name) || !hasOwn(SPOKEN_FORMAT, kind) || !formatRounds(facts[name], kind)) return match;
    /* "about $95", but never "the about $95" or "the extra about $267". */
    const about = /\b(?:about|roughly|nearly|almost|the|a|an|extra)\s$/i.test(whole.slice(0, offset)) ? '' : 'about ';
    return `${about}{${name}|${SPOKEN_FORMAT[kind]}}`;
  }));
}

/* ------------------------------------------------------------------ */
/* Facts (given + calc) and spec resolution                             */
/* ------------------------------------------------------------------ */

const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']);
const validFactName = (name) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) &&
  !RESERVED_NAMES.has(name) && !hasOwn(FUNCTIONS, name);

function computeFacts(given, calc, literals, errors) {
  const facts = {};
  const scope = Object.create(null);
  const add = (name, value) => {
    scope[name] = value;
    facts[name] = snap(value);
  };
  if (given !== undefined && !isPlainObject(given)) errors.push('given must be an object of numbers');
  for (const [name, value] of Object.entries(isPlainObject(given) ? given : {})) {
    if (!validFactName(name)) {
      errors.push(`given: bad name "${name}"`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`given.${name} must be a finite number`);
      continue;
    }
    add(name, value);
  }
  if (calc !== undefined && !isPlainObject(calc)) errors.push('calc must be an object of expressions');
  for (const [name, expression] of Object.entries(isPlainObject(calc) ? calc : {})) {
    if (!validFactName(name)) {
      errors.push(`calc: bad name "${name}"`);
      continue;
    }
    if (name in scope) {
      errors.push(`calc.${name} repeats an earlier name`);
      continue;
    }
    try {
      add(name, evaluate(expression, scope));
    } catch (error) {
      errors.push(`calc.${name}: ${error.message}`);
    }
  }
  if (literals !== undefined) {
    if (!Array.isArray(literals)) {
      errors.push('literals must be an array of numbers');
    } else {
      literals.forEach((value, index) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`literals[${index}] must be a finite number`);
        else add(`literal_${index + 1}`, value);
      });
    }
  }
  if (Object.keys(facts).length > LIMITS.facts) errors.push(`more than ${LIMITS.facts} facts`);
  return facts;
}

const NUMERIC_KEYS = new Set(['at', 'from', 'to', 'value', 'open', 'high', 'low', 'close']);
const RAW_KEYS = new Set(['k', 'icon', 'tone', 'dir', 'mark', 'cue']);

function resolveNumber(value, facts, where, errors) {
  const braced = /^\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/.exec(value);
  try {
    return snap(evaluate(braced ? braced[1] : value, Object.assign(Object.create(null), facts)));
  } catch (error) {
    errors.push(`${where}: ${error.message}`);
    return NaN;
  }
}

function resolveValue(value, facts, where, errors, key) {
  if (typeof value === 'string') {
    if (key && NUMERIC_KEYS.has(key)) return resolveNumber(value, facts, where, errors);
    if (key && RAW_KEYS.has(key)) return value;
    return resolveText(value, facts, where, errors);
  }
  if (Array.isArray(value)) return value.map((entry, index) => resolveValue(entry, facts, `${where}[${index}]`, errors, key));
  if (isPlainObject(value)) {
    const output = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (RESERVED_NAMES.has(childKey)) {
        errors.push(`${where}: bad key "${childKey}"`);
        continue;
      }
      output[childKey] = resolveValue(child, facts, `${where}.${childKey}`, errors, childKey);
    }
    return output;
  }
  if (typeof value === 'number' && key && NUMERIC_KEYS.has(key) && Number.isFinite(value)) return snap(value);
  return value;
}

function buildExample(id, family, spec, source) {
  const errors = [];
  if (!isPlainObject(spec)) return { example: null, errors: ['spec must be an object'] };
  for (const key of Object.keys(spec)) {
    if (!['given', 'calc', 'literals', 'title', 'say', 'frames'].includes(key)) errors.push(`spec: unknown field "${key}"`);
  }
  const facts = computeFacts(spec.given, spec.calc, spec.literals, errors);
  const title = resolveText(spec.title === undefined ? DEFAULT_TITLE : spec.title, facts, 'title', errors);
  let say = [];
  if (Array.isArray(spec.say)) say = spec.say.map((sentence, index) => resolveText(sentence, facts, `say[${index}]`, errors));
  else errors.push('say must be an array of sentences');
  let frames = [];
  if (Array.isArray(spec.frames)) frames = spec.frames.map((frame, index) => resolveValue(frame, facts, `frames[${index}]`, errors, null));
  else errors.push('frames must be an array');
  const example = { id, source, family, title, say, frames, facts };
  if (!errors.length) errors.push(...validateExample(example));
  return errors.length ? { example: null, errors } : { example: deepFreeze(example), errors: [] };
}

/* ------------------------------------------------------------------ */
/* Validator                                                            */
/* ------------------------------------------------------------------ */

function allowedNumberKeys(facts) {
  const keys = new Set();
  for (const value of Object.values(facts || {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    for (const candidate of [roundTo(value, 2), roundTo(value, 1), roundTo(value, 0), roundTo(value * 100, 2), roundTo(value * 100, 1), roundTo(value * 100, 0)]) {
      keys.add(Math.round(Math.abs(candidate) * 100));
    }
  }
  return keys;
}

/* Numbers the voice may read: a fact exactly (to the cent / 0.01%), or a fact
 * rounded for speech to a whole number or one decimal ("about $95", "43%").
 * A two-decimal rounding of a longer value ($95.24, 42.86%) is not allowed. */
function spokenNumberKeys(facts) {
  const keys = new Set();
  for (const value of Object.values(facts || {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    for (const scaled of [value, value * 100]) {
      const abs = Math.abs(scaled);
      if (Math.abs(roundTo(abs, 2) - abs) < 1e-9) keys.add(Math.round(roundTo(abs, 2) * 100));
      keys.add(Math.round(roundTo(abs, 0) * 100));
      keys.add(Math.round(roundTo(abs, 1) * 100));
    }
  }
  return keys;
}

function numbersIn(text) {
  return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || [])
    .map((token) => Number(token.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

/* The renderer's own measurements (same glyph widths, same slots), loaded
 * lazily; null if the renderer module is unavailable. */
let boardFit;
function whiteboardFit() {
  if (boardFit === undefined) {
    try {
      boardFit = require('../academy-cartoon-visuals').whiteboardFit;
    } catch (_) {
      boardFit = null;
    }
  }
  return boardFit;
}

function validateExample(example) {
  const errors = [];
  const fail = (message) => {
    if (errors.length < 60) errors.push(message);
  };
  if (!isPlainObject(example)) return ['example must be an object'];
  for (const key of Object.keys(example)) {
    if (!['id', 'source', 'family', 'title', 'say', 'frames', 'facts'].includes(key)) fail(`unknown field "${key}"`);
  }
  if (typeof example.id !== 'string' || !/^\d{1,3}\.\d{1,3}$/.test(example.id)) fail('id must look like "9.1"');
  if (example.source !== 'authored' && example.source !== 'auto') fail('source must be "authored" or "auto"');
  if (typeof example.family !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(example.family)) fail('family must be a lowercase id like option_put_payoff');

  const texts = [];
  const text = (value, where, max) => {
    if (typeof value !== 'string' || !value.trim()) {
      fail(`${where}: expected non-empty text`);
      return;
    }
    if (value.length > max) fail(`${where}: "${value}" is longer than ${max} characters`);
    if (/[\r\n]/.test(value)) fail(`${where}: no line breaks`);
    texts.push([where, value]);
  };
  const tone = (value, where) => {
    if (value !== undefined && !TONES.includes(value)) fail(`${where}: tone must be one of ${TONES.join(', ')}`);
  };
  const keysOnly = (object, allowed, where) => {
    if (!isPlainObject(object)) {
      fail(`${where}: expected an object`);
      return false;
    }
    for (const key of Object.keys(object)) if (!allowed.includes(key)) fail(`${where}: unknown field "${key}"`);
    return true;
  };
  const finiteNumber = (value, where) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`${where}: expected a finite number`);
      return false;
    }
    return true;
  };

  text(example.title, 'title', LIMITS.title);

  const facts = example.facts;
  if (!isPlainObject(facts)) {
    fail('facts must be an object of numbers');
  } else {
    const names = Object.keys(facts);
    if (names.length > LIMITS.facts) fail(`more than ${LIMITS.facts} facts`);
    for (const name of names) {
      if (!validFactName(name)) fail(`facts: bad name "${name}"`);
      else if (typeof facts[name] !== 'number' || !Number.isFinite(facts[name])) fail(`facts.${name} must be a finite number`);
    }
  }

  const say = example.say;
  if (!Array.isArray(say) || say.length < LIMITS.sayMin || say.length > LIMITS.sayMax) {
    fail(`say must have ${LIMITS.sayMin} to ${LIMITS.sayMax} sentences`);
  }
  const sentences = Array.isArray(say) ? say : [];
  sentences.forEach((sentence, index) => {
    const where = `say[${index}]`;
    if (typeof sentence !== 'string' || !sentence.trim()) {
      fail(`${where}: expected a sentence`);
      return;
    }
    texts.push([where, sentence]);
    if (sentence !== sentence.trim() || /\s{2,}|[\r\n]/.test(sentence)) fail(`${where}: use single spaces and no line breaks`);
    if (!/[.!?]$/.test(sentence)) fail(`${where}: end the sentence with . ! or ?`);
    const symbol = SAY_SYMBOLS.exec(sentence);
    if (symbol) fail(`${where}: the voice cannot say "${symbol[0]}"; use words (minus, times, divided by, equals, percent)`);
    if (SAY_SIGNED_NUMBER.test(sentence)) fail(`${where}: say "gain of" / "loss of" instead of a leading + or - sign`);
    if (SAY_TIMES_X.test(sentence)) fail(`${where}: say "times" instead of x`);
    const abbreviation = SAY_ABBREVIATION.exec(sentence);
    if (abbreviation) fail(`${where}: spell out "${abbreviation[0]}"; the voice may hear its period as the end of the sentence`);
    const wordCount = (sentence.match(/\S+/g) || []).length;
    if (wordCount > LIMITS.sayWords) fail(`${where}: ${wordCount} words is hard to follow by ear; split or shorten it to ${LIMITS.sayWords} words or fewer`);
  });
  if (sentences.every((sentence) => typeof sentence === 'string') && sentences.join(' ').length > LIMITS.sayTotal) {
    fail(`say is ${sentences.join(' ').length} characters; the limit is ${LIMITS.sayTotal}`);
  }

  const frames = example.frames;
  if (!Array.isArray(frames) || frames.length < LIMITS.framesMin || frames.length > LIMITS.framesMax) {
    fail(`frames must have ${LIMITS.framesMin} to ${LIMITS.framesMax} entries`);
  }
  const frameList = Array.isArray(frames) ? frames : [];
  frameList.forEach((frame, frameIndex) => {
    const where = `frames[${frameIndex}]`;
    if (!keysOnly(frame, ['cue', 'items'], where)) return;
    const cue = frame.cue;
    if (!Number.isInteger(cue) || cue < 0 || cue >= sentences.length) fail(`${where}.cue must be a say index`);
    if (frameIndex === 0 && cue !== 0) fail('frames[0].cue must be 0');
    const previous = frameList[frameIndex - 1];
    if (frameIndex > 0 && previous && Number.isInteger(previous.cue) && !(cue > previous.cue)) fail(`${where}.cue must be greater than the previous frame's cue`);
    const nextFrame = frameList[frameIndex + 1];
    const cueLimit = nextFrame && Number.isInteger(nextFrame.cue) ? nextFrame.cue : sentences.length;
    if (!Array.isArray(frame.items) || frame.items.length < 1 || frame.items.length > LIMITS.itemsPerFrame) {
      fail(`${where}.items must have 1 to ${LIMITS.itemsPerFrame} items`);
      return;
    }
    frame.items.forEach((item, itemIndex) => validateItem(item, `${where}.items[${itemIndex}]`, cue, cueLimit));
  });

  function validateItem(item, where, frameCue, cueLimit) {
    if (!isPlainObject(item) || !ITEM_KINDS.includes(item.k)) {
      fail(`${where}: k must be one of ${ITEM_KINDS.join(', ')}`);
      return;
    }
    switch (item.k) {
      case 'actors': {
        if (!keysOnly(item, ['k', 'left', 'right', 'flows'], where)) return;
        for (const side of ['left', 'right']) {
          const actor = item[side];
          if (!keysOnly(actor, ['name', 'icon', 'tone'], `${where}.${side}`)) continue;
          text(actor.name, `${where}.${side}.name`, LIMITS.text);
          if (!ICONS.includes(actor.icon)) fail(`${where}.${side}.icon must be one of ${ICONS.join(', ')}`);
          tone(actor.tone, `${where}.${side}`);
        }
        if (!Array.isArray(item.flows) || item.flows.length > 2) {
          fail(`${where}.flows must be an array of up to 2 arrows`);
          return;
        }
        item.flows.forEach((flow, index) => {
          if (!keysOnly(flow, ['dir', 'text'], `${where}.flows[${index}]`)) return;
          if (flow.dir !== 'right' && flow.dir !== 'left') fail(`${where}.flows[${index}].dir must be right or left`);
          text(flow.text, `${where}.flows[${index}].text`, LIMITS.text);
        });
        return;
      }
      case 'big':
        if (!keysOnly(item, ['k', 'text', 'label', 'tone'], where)) return;
        text(item.text, `${where}.text`, LIMITS.big);
        if (item.label !== undefined) text(item.label, `${where}.label`, LIMITS.text);
        tone(item.tone, where);
        return;
      case 'line':
        if (!keysOnly(item, ['k', 'text', 'tone', 'cue'], where)) return;
        text(item.text, `${where}.text`, LIMITS.text);
        tone(item.tone, where);
        if (item.cue !== undefined && (!Number.isInteger(item.cue) || item.cue < frameCue || item.cue >= cueLimit)) {
          fail(`${where}.cue must be from ${frameCue} to ${cueLimit - 1}`);
        }
        return;
      case 'numberLine': {
        if (!keysOnly(item, ['k', 'marks', 'dot'], where)) return;
        if (!Array.isArray(item.marks) || item.marks.length < 2 || item.marks.length > 4) {
          fail(`${where}.marks must have 2 to 4 marks`);
          return;
        }
        let previousAt = -Infinity;
        item.marks.forEach((mark, index) => {
          if (!keysOnly(mark, ['at', 'label', 'tone'], `${where}.marks[${index}]`)) return;
          if (finiteNumber(mark.at, `${where}.marks[${index}].at`)) {
            if (!(mark.at > previousAt)) fail(`${where}.marks must be sorted by at with no repeats`);
            previousAt = mark.at;
          }
          text(mark.label, `${where}.marks[${index}].label`, LIMITS.markLabel);
          tone(mark.tone, `${where}.marks[${index}]`);
        });
        if (item.dot !== undefined) {
          if (!keysOnly(item.dot, ['from', 'to'], `${where}.dot`)) return;
          const ats = item.marks.map((mark) => mark && mark.at).filter((at) => Number.isFinite(at));
          const low = Math.min(...ats);
          const high = Math.max(...ats);
          for (const end of ['from', 'to']) {
            if (finiteNumber(item.dot[end], `${where}.dot.${end}`) && (item.dot[end] < low - 1e-9 || item.dot[end] > high + 1e-9)) {
              fail(`${where}.dot.${end} must sit between the first and last mark`);
            }
          }
        }
        return;
      }
      case 'bars': {
        if (!keysOnly(item, ['k', 'items'], where)) return;
        if (!Array.isArray(item.items) || item.items.length < 2 || item.items.length > 4) {
          fail(`${where}.items must have 2 to 4 bars`);
          return;
        }
        let nonZero = false;
        item.items.forEach((bar, index) => {
          if (!keysOnly(bar, ['label', 'value', 'text', 'tone'], `${where}.items[${index}]`)) return;
          text(bar.label, `${where}.items[${index}].label`, LIMITS.barLabel);
          if (finiteNumber(bar.value, `${where}.items[${index}].value`) && bar.value !== 0) nonZero = true;
          text(bar.text, `${where}.items[${index}].text`, LIMITS.text);
          tone(bar.tone, `${where}.items[${index}]`);
        });
        if (!nonZero) fail(`${where}: at least one bar needs a non-zero value`);
        return;
      }
      case 'tree':
        if (!keysOnly(item, ['k', 'root', 'branches'], where)) return;
        text(item.root, `${where}.root`, LIMITS.text);
        if (!Array.isArray(item.branches) || item.branches.length < 2 || item.branches.length > 3) {
          fail(`${where}.branches must have 2 or 3 branches`);
          return;
        }
        item.branches.forEach((branch, index) => {
          if (!keysOnly(branch, ['label', 'text', 'tone'], `${where}.branches[${index}]`)) return;
          text(branch.label, `${where}.branches[${index}].label`, LIMITS.text);
          text(branch.text, `${where}.branches[${index}].text`, LIMITS.text);
          tone(branch.tone, `${where}.branches[${index}]`);
        });
        return;
      case 'steps':
        if (!keysOnly(item, ['k', 'items'], where)) return;
        if (!Array.isArray(item.items) || item.items.length < 2 || item.items.length > 4) {
          fail(`${where}.items must have 2 to 4 steps`);
          return;
        }
        item.items.forEach((step, index) => text(step, `${where}.items[${index}]`, LIMITS.stepText));
        return;
      case 'compare':
        if (!keysOnly(item, ['k', 'left', 'right'], where)) return;
        for (const side of ['left', 'right']) {
          const column = item[side];
          if (!keysOnly(column, ['title', 'lines', 'mark'], `${where}.${side}`)) continue;
          text(column.title, `${where}.${side}.title`, LIMITS.text);
          if (!Array.isArray(column.lines) || column.lines.length > 3) fail(`${where}.${side}.lines must have up to 3 lines`);
          else column.lines.forEach((line, index) => text(line, `${where}.${side}.lines[${index}]`, LIMITS.compareLine));
          if (column.mark !== undefined && column.mark !== null && column.mark !== 'check' && column.mark !== 'cross') {
            fail(`${where}.${side}.mark must be check, cross or null`);
          }
        }
        return;
      case 'candle': {
        if (!keysOnly(item, ['k', 'open', 'high', 'low', 'close'], where)) return;
        const ok = ['open', 'high', 'low', 'close'].every((key) => finiteNumber(item[key], `${where}.${key}`));
        if (ok && !(item.high >= Math.max(item.open, item.close) && item.low <= Math.min(item.open, item.close) && item.high > item.low)) {
          fail(`${where}: high must be the top and low the bottom of the candle`);
        }
        return;
      }
      case 'stamp':
        if (!keysOnly(item, ['k', 'text', 'tone'], where)) return;
        text(item.text, `${where}.text`, LIMITS.stamp);
        tone(item.tone, where);
        return;
      default:
    }
  }

  const allowed = allowedNumberKeys(isPlainObject(facts) ? facts : {});
  const spoken = spokenNumberKeys(isPlainObject(facts) ? facts : {});
  for (const [where, value] of texts) {
    if (FORBIDDEN_NAMES.test(value)) fail(`${where}: uses a reserved name; pick a fictional one`);
    if (/[<>{}]/.test(value)) fail(`${where}: no < > { } characters`);
    if (CASHTAG.test(value)) fail(`${where}: no tickers or cashtags`);
    for (const phrase of ADVICE_PHRASES) if (phrase.test(value)) fail(`${where}: sounds like advice or a guarantee`);
    const isSay = where.startsWith('say[');
    for (const found of numbersIn(value)) {
      const key = Math.round(Math.abs(roundTo(found, 2)) * 100);
      if (Math.abs(found) > LIMITS.smallNumber && !allowed.has(key)) {
        fail(`${where}: the number ${found} is not a computed fact; add it to given/calc (or literals) and use a placeholder`);
      } else if (isSay && !(Number.isInteger(found) && found <= LIMITS.smallNumber) && allowed.has(key) && !spoken.has(key)) {
        fail(`${where}: ${found} is a silently rounded result; say it rounded (for example "about {name|usdr}" or "{name|pctr}") and keep the exact figure on the board`);
      }
    }
  }
  let json = '';
  try {
    json = JSON.stringify(example);
  } catch (_) {
    fail('example must be JSON-serializable');
  }
  if (json.length > LIMITS.json) fail(`example JSON is ${json.length} characters; the limit is ${LIMITS.json}`);
  const lower = json.toLowerCase();
  for (const banned of FORBIDDEN_PAGE_STRINGS) if (lower.includes(banned)) fail(`example contains the reserved text "${banned}"`);
  /* Slot capacity: measured by the renderer itself, so a label that would be
   * shrunk below a readable size (or overlap) on a 270px deck is rejected. */
  const measure = errors.length ? null : whiteboardFit();
  if (measure) {
    let problems = [];
    try {
      problems = measure(example);
    } catch (error) {
      problems = [`the whiteboard could not be drawn (${error && error.message})`];
    }
    for (const problem of problems) fail(`frames: ${problem} on a 270px deck; shorten it`);
  }
  return errors;
}

function isValidExample(example) {
  try {
    return validateExample(example).length === 0;
  } catch (_) {
    return false;
  }
}

function assertValidExample(example) {
  const errors = validateExample(example);
  if (errors.length) throw new Error(`Invalid Academy example ${example && example.id}: ${errors.join('; ')}`);
  return example;
}

/* ------------------------------------------------------------------ */
/* Builder helpers                                                      */
/* ------------------------------------------------------------------ */

function merged(defaults, params) {
  const output = { ...defaults };
  if (isPlainObject(params)) {
    for (const [key, value] of Object.entries(params)) if (value !== undefined) output[key] = value;
  }
  return output;
}

function need(condition, message) {
  if (!condition) throw new Error(message);
}

function numberParam(value, name, { min = -Infinity, max = Infinity, integer = false, positive = false } = {}) {
  const parsed = typeof value === 'string' && value.trim() ? Number(value.replace(/[$,\s]/g, '')) : value;
  need(typeof parsed === 'number' && Number.isFinite(parsed), `${name} must be a number`);
  need(!positive || parsed > 0, `${name} must be above zero`);
  need(parsed >= min && parsed <= max, `${name} must be from ${min} to ${max}`);
  need(!integer || Number.isInteger(parsed), `${name} must be a whole number`);
  return parsed;
}

function cleanWords(value, fallback, max, pattern = /[^A-Za-z .'&-]/g) {
  let text = typeof value === 'string' ? value.replace(pattern, '').replace(/\s+/g, ' ').trim() : '';
  if (!text || FORBIDDEN_NAMES.test(text)) text = fallback;
  if (text.length > max) text = text.slice(0, max).replace(/\s+\S*$/, '').trim() || text.slice(0, max).trim();
  return text;
}

const nameText = (value, fallback) => cleanWords(value, fallback, 12);
/* Company names are spoken mid-sentence, so a trailing 'Co.' or 'Inc.' is dropped. */
const companyText = (value, fallback) => cleanWords(typeof value === 'string' ? value.replace(/[,\s]+(?:Co|Inc|Corp|Ltd)\.?\s*$/i, '') : value, fallback, 20);
const phraseText = (value, fallback, max = 28) => cleanWords(value, fallback, max, /[^A-Za-z0-9 .,'&-]/g);
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
const SMALL_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const countWord = (count) => SMALL_WORDS[count] || String(count);
/* "two years" for small counts; a placeholder (always a fact) otherwise. */
const yearsWords = (years, placeholder) => (years <= 12 ? `${countWord(years)} year${years === 1 ? '' : 's'}` : `${placeholder} years`);

function fit(T, templates, max) {
  for (const template of templates) {
    const output = T(template);
    if (output.length <= max) return output;
  }
  throw new Error(`nothing fits in ${max} characters: ${templates[templates.length - 1]}`);
}

function sortedMarks(list) {
  const unique = [];
  for (const mark of list) {
    if (!unique.some((entry) => Math.abs(entry.at - mark.at) < 1e-9)) unique.push(mark);
  }
  return unique.slice(0, 4).sort((left, right) => left.at - right.at);
}

/* First item whose labels the renderer can draw readably (marks bunched close
 * together can collide); falls back to the last, simplest option. */
function firstFitting(items) {
  const measure = whiteboardFit();
  if (!measure) return items[0];
  for (const item of items) {
    try {
      if (!measure({ say: ['One.'], frames: [{ cue: 0, items: [item] }] }).length) return item;
    } catch (_) {
      /* try the next option */
    }
  }
  return items[items.length - 1];
}

/* A bars item whose bar texts are template lists, longest first: uses the
 * first level at which every bar label fits its slot ("Kofi +$107,500" ->
 * "+$107,500", "$2,059,933.80" -> "$2,059,934"). */
function fittingBars(T, bars) {
  const depth = Math.max(...bars.map((bar) => bar.texts.length));
  const levels = [];
  for (let level = 0; level < depth; level += 1) {
    levels.push({ k: 'bars', items: bars.map(({ texts, ...bar }) => ({ ...bar, text: T(texts[Math.min(level, texts.length - 1)]) })) });
  }
  return firstFitting(levels);
}

const outcomeTone = (value) => (value > 1e-9 ? 'good' : value < -1e-9 ? 'bad' : 'note');
const isZero = (value) => Math.abs(value) < 1e-9;

/* ------------------------------------------------------------------ */
/* The 14 builders                                                      */
/* ------------------------------------------------------------------ */

const BUILDER_FAMILY = Object.freeze({
  optionPut: 'option_put_payoff',
  optionCall: 'option_call_payoff',
  positionSize: 'position_sizing',
  percentChange: 'percent_change',
  compound: 'compounding',
  presentValue: 'present_value',
  bidAsk: 'bid_ask_spread',
  expectedValue: 'expected_value',
  ratio: 'ratio_analysis',
  drawdownRecovery: 'drawdown_recovery',
  bondYield: 'bond_price_yield',
  twoChoices: 'decision_compare',
  process: 'process_steps',
  scenarioTree: 'scenario_tree',
  candle: 'candle_ohlc'
});

const GENERIC_CHOICE = Object.freeze({
  person: 'Sam',
  headline: 'Hunch or evidence?',
  situation: 'Sam has a strong feeling about a trade but has not checked a single fact.',
  wrongSay: 'Acting on the feeling alone leaves no way to learn whether it was right for the right reason.',
  rightSay: 'Writing down the reason and checking it first turns a guess into an idea that can be tested.',
  lesson: 'A good process means every decision can be explained, checked, and reviewed later.',
  wrong: { title: 'Act on the hunch', lines: ['Feels certain', 'Nothing to check'] },
  right: { title: 'Check the evidence', lines: ['Write the reason', 'Test it first'] },
  stamp: 'Evidence before action'
});

const GENERIC_PROCESS = Object.freeze({
  actor: 'Maya',
  goal: 'make one careful market decision',
  headline: 'Same steps, every time',
  steps: [
    { label: 'Question', say: 'write down the exact question' },
    { label: 'Evidence', say: 'collect evidence that could prove it wrong' },
    { label: 'Decide', say: 'decide with a size and an exit already set' },
    { label: 'Review', say: 'review the process, not just the result' }
  ],
  why: 'Following the same order makes mistakes easy to spot and fix.',
  stamp: 'Process over luck'
});

const BUILDER_DEFAULTS = Object.freeze({
  optionPut: Object.freeze({ buyer: 'Leo', seller: 'Maya', company: 'Pebblestone Phones', stock: 50, strike: 45, premium: 2, shares: 100, low: 40, high: 55 }),
  optionCall: Object.freeze({ buyer: 'Maya', seller: 'Leo', company: 'Comet Cafe', stock: 50, strike: 55, premium: 2, shares: 100, high: 60, low: 45 }),
  positionSize: Object.freeze({ trader: 'Leo', account: 2000, riskPct: 0.01, entry: 10, stop: 9.5 }),
  percentChange: Object.freeze({ holder: 'Maya', thing: 'Fizz Town shares', before: 40, after: 50, unit: 'usd' }),
  compound: Object.freeze({ saver: 'Maya', start: 100, rate: 0.1, years: 3, returns: null }),
  presentValue: Object.freeze({ receiver: 'Leo', amount: 110, rate: 0.1, years: 1, compareRate: 0.2 }),
  bidAsk: Object.freeze({ buyer: 'Maya', seller: 'Leo', company: 'Pixel Pops', bid: 9, ask: 10, shares: 100 }),
  expectedValue: Object.freeze({ person: 'Maya', what: 'one trade setup', outcomes: Object.freeze([
    Object.freeze({ label: 'Win', p: 0.4, value: 40 }), Object.freeze({ label: 'Loss', p: 0.6, value: -20 })
  ]) }),
  ratio: Object.freeze({ company: 'Lagoon Lane', top: 100, bottom: 1000, topLabel: 'profit', bottomLabel: 'sales', unit: 'usd', as: 'pct',
    compare: Object.freeze({ company: 'Fizz Town', top: 40, bottom: 500 }), insight: null }),
  drawdownRecovery: Object.freeze({ holder: 'Maya', start: 1000, drop: 0.3 }),
  bondYield: Object.freeze({ buyer: 'Leo', issuer: 'Harbor Town', face: 100, coupon: 5, yield: 0.1, price: null, newYield: 0.12 }),
  twoChoices: GENERIC_CHOICE,
  process: GENERIC_PROCESS,
  scenarioTree: Object.freeze({ planner: 'Maya', company: 'Maple Mill', price: 10, branches: Object.freeze([
    Object.freeze({ label: 'Bear', p: 0.25, value: 6 }), Object.freeze({ label: 'Base', p: 0.5, value: 10 }), Object.freeze({ label: 'Bull', p: 0.25, value: 16 })
  ]) }),
  candle: Object.freeze({ company: 'Tidewater Toys', period: 'one day', open: 10, high: 12, low: 9, close: 11 })
});

const SPECS = {
  optionPut(params) {
    const p = merged(BUILDER_DEFAULTS.optionPut, params);
    const buyer = nameText(p.buyer, 'Leo');
    const seller = nameText(p.seller, buyer === 'Maya' ? 'Leo' : 'Maya');
    const company = companyText(p.company, 'Pebblestone Phones');
    need(buyer !== seller, 'buyer and seller need different names');
    const f = {
      stock: numberParam(p.stock, 'stock', { positive: true }),
      strike: numberParam(p.strike, 'strike', { positive: true }),
      premium: numberParam(p.premium, 'premium', { positive: true }),
      shares: numberParam(p.shares, 'shares', { integer: true, min: 1, max: 100000 }),
      low: numberParam(p.low, 'low', { min: 0 }),
      high: numberParam(p.high, 'high', { positive: true })
    };
    need(f.premium < f.strike, 'premium must be below the strike');
    need(f.low < f.strike, 'low must end below the strike');
    need(f.high >= f.strike, 'high must end at or above the strike');
    f.cost = f.premium * f.shares;
    f.breakEven = f.strike - f.premium;
    f.intrinsic = f.strike - f.low;
    f.netShare = f.intrinsic - f.premium;
    f.netShareAbs = Math.abs(f.netShare);
    f.netLow = f.netShare * f.shares;
    f.netLowAbs = Math.abs(f.netLow);
    f.netHigh = -f.cost;
    f.sellerLow = -f.netLow;
    f.sellerHigh = f.cost;
    const T = filler(f);
    const S = spokenFiller(f);
    const lowSentence = f.netLow > 1e-9
      ? S(`If the stock ends at {low|usd}, the put is worth {intrinsic|usd} a share, so ${buyer} nets {netShare|usd} a share, or {netLow|usd}.`)
      : isZero(f.netLow)
        ? S(`If the stock ends at {low|usd}, the put is worth exactly the {premium|usd} premium, so ${buyer} only breaks even.`)
        : S(`If the stock ends at {low|usd}, the put is worth only {intrinsic|usd} a share, so ${buyer} still loses {netLowAbs|usd}.`);
    const strikeMark = { at: f.strike, label: fit(T, ['Strike {strike|usd}', 'Strike'], LIMITS.markLabel), tone: 'key' };
    const breakEvenMark = { at: f.breakEven, label: fit(T, ['Break-even {breakEven|usd}', 'Break-even'], LIMITS.markLabel), tone: 'note' };
    const endMark = { at: f.low, label: fit(T, ['Ends {low|usd}', 'Low ending'], LIMITS.markLabel), tone: outcomeTone(f.netLow) };
    const todayMark = { at: f.stock, label: fit(T, ['Today {stock|usd}', 'Today'], LIMITS.markLabel) };
    return {
      title: 'One put, two endings',
      given: f,
      say: [
        S(`${buyer} pays ${seller} {cost|usd}, or {premium|usd} a share, for one put on ${company}: the right to sell {shares|num} shares at {strike|usd}.`),
        S('The stock is at {stock|usd} today, and the break-even is {strike|usd} minus {premium|usd}, or {breakEven|usd}.'),
        lowSentence,
        S(`If it ends at {high|usd}, the put expires worthless, ${buyer} loses the {cost|usd}, and ${seller} keeps it.`),
        'The strike only acts like a price floor for someone who also owns the shares.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'actors', left: { name: buyer, icon: 'person' }, right: { name: seller, icon: 'person2' }, flows: [
            { dir: 'right', text: fit(T, ['{cost|usd} premium', 'Premium'], LIMITS.text) },
            { dir: 'left', text: fit(T, ['Right to sell at {strike|usd}', 'Right to sell'], LIMITS.text) }
          ] },
          { k: 'line', text: fit(T, ['{premium|usd} × {shares|num} shares = {cost|usd}', 'Premium × shares = {cost|usd}', 'Premium × shares = cost'], LIMITS.text), tone: 'key' }
        ] },
        { cue: 1, items: [
          firstFitting([
            [strikeMark, breakEvenMark, endMark, todayMark],
            [strikeMark, endMark, todayMark],
            [strikeMark, endMark]
          ].map((marks) => ({ k: 'numberLine', marks: sortedMarks(marks), dot: { from: f.stock, to: f.low } }))),
          { k: 'line', text: fit(T, ['{strike|usd} − {premium|usd} = {breakEven|usd}', 'Strike − premium = break-even'], LIMITS.text), tone: 'key' }
        ] },
        { cue: 2, items: [
          fittingBars(T, [
            { label: fit(T, ['Ends {low|usd}', 'Low ending'], LIMITS.barLabel), value: f.netLow, texts: [`${buyer} {netLow|susd}`, '{netLow|susd}', '{netLow|usd0}'], tone: outcomeTone(f.netLow) },
            { label: fit(T, ['Ends {high|usd}', 'High ending'], LIMITS.barLabel), value: f.netHigh, texts: [`${buyer} {netHigh|susd}`, '{netHigh|susd}', '{netHigh|usd0}'], tone: 'bad' }
          ]),
          { k: 'line', text: fit(T, [`${seller}: {sellerLow|susd} or {sellerHigh|susd}`, 'Seller: {sellerLow|susd} or {sellerHigh|susd}', 'Seller gets the other side'], LIMITS.text), tone: 'note', cue: 3 },
          { k: 'line', text: 'Floor only if you own shares', tone: 'key', cue: 4 }
        ] }
      ]
    };
  },

  optionCall(params) {
    const p = merged(BUILDER_DEFAULTS.optionCall, params);
    const buyer = nameText(p.buyer, 'Maya');
    const seller = nameText(p.seller, buyer === 'Leo' ? 'Maya' : 'Leo');
    const company = companyText(p.company, 'Comet Cafe');
    need(buyer !== seller, 'buyer and seller need different names');
    const f = {
      stock: numberParam(p.stock, 'stock', { positive: true }),
      strike: numberParam(p.strike, 'strike', { positive: true }),
      premium: numberParam(p.premium, 'premium', { positive: true }),
      shares: numberParam(p.shares, 'shares', { integer: true, min: 1, max: 100000 }),
      high: numberParam(p.high, 'high', { positive: true }),
      low: numberParam(p.low, 'low', { min: 0 })
    };
    need(f.high > f.strike, 'high must end above the strike');
    need(f.low <= f.strike, 'low must end at or below the strike');
    f.cost = f.premium * f.shares;
    f.breakEven = f.strike + f.premium;
    f.intrinsic = f.high - f.strike;
    f.netShare = f.intrinsic - f.premium;
    f.netHigh = f.netShare * f.shares;
    f.netHighAbs = Math.abs(f.netHigh);
    f.netLow = -f.cost;
    f.sellerHigh = -f.netHigh;
    f.sellerLow = f.cost;
    const T = filler(f);
    const S = spokenFiller(f);
    const highSentence = f.netHigh > 1e-9
      ? S(`If the stock ends at {high|usd}, the call is worth {intrinsic|usd} a share, so ${buyer} nets {netShare|usd} a share, or {netHigh|usd}.`)
      : isZero(f.netHigh)
        ? S(`If the stock ends at {high|usd}, the call is worth exactly the {premium|usd} premium, so ${buyer} only breaks even.`)
        : S(`If the stock ends at {high|usd}, the call is worth only {intrinsic|usd} a share, so ${buyer} still loses {netHighAbs|usd}.`);
    const strikeMark = { at: f.strike, label: fit(T, ['Strike {strike|usd}', 'Strike'], LIMITS.markLabel), tone: 'key' };
    const breakEvenMark = { at: f.breakEven, label: fit(T, ['Break-even {breakEven|usd}', 'Break-even'], LIMITS.markLabel), tone: 'note' };
    const endMark = { at: f.high, label: fit(T, ['Ends {high|usd}', 'High ending'], LIMITS.markLabel), tone: outcomeTone(f.netHigh) };
    const todayMark = { at: f.stock, label: fit(T, ['Today {stock|usd}', 'Today'], LIMITS.markLabel) };
    return {
      title: 'One call, two endings',
      given: f,
      say: [
        S(`${buyer} pays ${seller} {cost|usd}, or {premium|usd} a share, for one call on ${company}: the right to buy {shares|num} shares at {strike|usd}.`),
        S('The stock is at {stock|usd} today, and the break-even is {strike|usd} plus {premium|usd}, or {breakEven|usd}.'),
        highSentence,
        S(`If it ends at {low|usd}, the call expires worthless, ${buyer} loses the {cost|usd}, and ${seller} keeps it.`),
        'A call buyer can lose only the premium, but an uncovered call seller can lose more and more as the price climbs.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'actors', left: { name: buyer, icon: 'person' }, right: { name: seller, icon: 'person2' }, flows: [
            { dir: 'right', text: fit(T, ['{cost|usd} premium', 'Premium'], LIMITS.text) },
            { dir: 'left', text: fit(T, ['Right to buy at {strike|usd}', 'Right to buy'], LIMITS.text) }
          ] },
          { k: 'line', text: fit(T, ['{premium|usd} × {shares|num} shares = {cost|usd}', 'Premium × shares = {cost|usd}', 'Premium × shares = cost'], LIMITS.text), tone: 'key' }
        ] },
        { cue: 1, items: [
          firstFitting([
            [strikeMark, breakEvenMark, endMark, todayMark],
            [strikeMark, endMark, todayMark],
            [strikeMark, endMark]
          ].map((marks) => ({ k: 'numberLine', marks: sortedMarks(marks), dot: { from: f.stock, to: f.high } }))),
          { k: 'line', text: fit(T, ['{strike|usd} + {premium|usd} = {breakEven|usd}', 'Strike + premium = break-even'], LIMITS.text), tone: 'key' }
        ] },
        { cue: 2, items: [
          fittingBars(T, [
            { label: fit(T, ['Ends {high|usd}', 'High ending'], LIMITS.barLabel), value: f.netHigh, texts: [`${buyer} {netHigh|susd}`, '{netHigh|susd}', '{netHigh|usd0}'], tone: outcomeTone(f.netHigh) },
            { label: fit(T, ['Ends {low|usd}', 'Low ending'], LIMITS.barLabel), value: f.netLow, texts: [`${buyer} {netLow|susd}`, '{netLow|susd}', '{netLow|usd0}'], tone: 'bad' }
          ]),
          { k: 'line', text: fit(T, [`${seller}: {sellerHigh|susd} or {sellerLow|susd}`, 'Seller: {sellerHigh|susd} or {sellerLow|susd}', 'Seller gets the other side'], LIMITS.text), tone: 'note', cue: 3 },
          { k: 'line', text: 'Buyer risk: the premium only', tone: 'key', cue: 4 }
        ] }
      ]
    };
  },

  positionSize(params) {
    const p = merged(BUILDER_DEFAULTS.positionSize, params);
    const trader = nameText(p.trader, 'Leo');
    const f = {
      account: numberParam(p.account, 'account', { positive: true, max: 1e9 }),
      riskPct: numberParam(p.riskPct, 'riskPct', { positive: true, max: 0.1 }),
      entry: numberParam(p.entry, 'entry', { positive: true }),
      stop: numberParam(p.stop, 'stop', { min: 0 })
    };
    need(f.stop < f.entry, 'stop must be below the entry');
    f.budget = f.account * f.riskPct;
    f.perShare = f.entry - f.stop;
    f.shares = Math.floor(snap(f.budget / f.perShare));
    need(f.shares >= 1, 'the budget must cover at least one share');
    f.position = f.shares * f.entry;
    f.actualRisk = f.shares * f.perShare;
    const exact = isZero(f.actualRisk - f.budget);
    const T = filler(f);
    const S = spokenFiller(f);
    return {
      title: 'Size the trade from the stop',
      given: f,
      say: [
        S(`${trader} has a {account|usd} account and will risk only {riskPct|pct} of it on one trade, which is {budget|usd}.`),
        S(`${trader} plans to buy at {entry|usd} and admits the idea is wrong at {stop|usd}, so each share risks {perShare|usd}.`),
        exact
          ? S('{budget|usd} divided by {perShare|usd} is {shares|num} shares, or {position|usd} of stock.')
          : S('{budget|usd} divided by {perShare|usd} rounds down to {shares|num} shares, or {position|usd} of stock.'),
        S('If the stop fills as planned, the loss is about {actualRisk|usd}, but a price gap can skip past the stop.'),
        'The size comes from the stop and the budget, not from how sure the trade feels.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'line', text: fit(T, ['Account {account|usd} × {riskPct|pct}', 'Account × risk percent'], LIMITS.text), tone: 'note' },
          { k: 'big', text: fit(T, ['{budget|usd}', '{budget|usd0}'], LIMITS.big), label: 'Most to lose on this trade', tone: 'bad' }
        ] },
        { cue: 1, items: [
          { k: 'numberLine', marks: sortedMarks([
            { at: f.entry, label: fit(T, ['Entry {entry|usd}', 'Entry'], LIMITS.markLabel), tone: 'key' },
            { at: f.stop, label: fit(T, ['Wrong at {stop|usd}', 'Stop {stop|usd}', 'Stop'], LIMITS.markLabel), tone: 'bad' }
          ]), dot: { from: f.entry, to: f.stop } },
          { k: 'line', text: fit(T, ['Risk per share: {perShare|usd}', 'Risk a share: {perShare|usd}'], LIMITS.text) },
          { k: 'line', text: fit(T, ['{budget|usd} ÷ {perShare|usd} = {shares|num} shares', '{budget|usd} ÷ {perShare|usd} = {shares|num}', 'Budget ÷ risk = {shares|num} shares'], LIMITS.text), tone: 'key', cue: 2 },
          { k: 'line', text: fit(T, ['{shares|num} × {entry|usd} = {position|usd}', 'Position: {position|usd}'], LIMITS.text), tone: 'note', cue: 2 }
        ] },
        { cue: 3, items: [
          { k: 'line', text: fit(T, ['Planned loss: {actualRisk|usd}', 'Planned loss: {actualRisk|usd0}'], LIMITS.text), tone: 'note' },
          { k: 'line', text: 'A gap can skip the stop', tone: 'bad' },
          { k: 'stamp', text: 'Size comes from the stop', tone: 'key' }
        ] }
      ]
    };
  },

  percentChange(params) {
    const p = merged(BUILDER_DEFAULTS.percentChange, params);
    const holder = nameText(p.holder, 'Maya');
    const thing = phraseText(p.thing, 'Fizz Town shares', 28);
    const unit = p.unit === 'num' ? 'num' : 'usd';
    const F = unit;
    const SF = unit === 'usd' ? 'susd' : 'snum';
    const f = {
      before: numberParam(p.before, 'before', { positive: true }),
      after: numberParam(p.after, 'after', { positive: true })
    };
    need(!isZero(f.after - f.before), 'after must differ from before');
    f.change = f.after - f.before;
    f.changeAbs = Math.abs(f.change);
    f.pct = f.change / f.before;
    f.pctAbs = Math.abs(f.pct);
    f.back = (f.before - f.after) / f.after;
    f.backAbs = Math.abs(f.back);
    const up = f.change > 0;
    const T = filler(f);
    const S = spokenFiller(f);
    return {
      title: 'Percent change, step by step',
      given: f,
      say: [
        S(`${holder} watches ${thing} go from {before|${F}} to {after|${F}}.`),
        up
          ? S(`That is a rise of {changeAbs|${F}}, found by taking {after|${F}} minus {before|${F}}.`)
          : S(`That is a drop of {changeAbs|${F}}, found by taking {before|${F}} minus {after|${F}}.`),
        S(`Divide by where it started: {changeAbs|${F}} divided by {before|${F}} is {pctAbs|pct}.`),
        up
          ? S(`Going back down to {before|${F}} would be a drop of only {backAbs|pct}, because the starting point changed.`)
          : S(`Climbing back to {before|${F}} would need a rise of {backAbs|pct}, because the starting point is now lower.`),
        'Percent change always divides by the starting value.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'numberLine', marks: sortedMarks([
            { at: f.before, label: fit(T, [`Start {before|${F}}`, 'Start'], LIMITS.markLabel), tone: 'note' },
            { at: f.after, label: fit(T, [`End {after|${F}}`, 'End'], LIMITS.markLabel), tone: up ? 'good' : 'bad' }
          ]), dot: { from: f.before, to: f.after } },
          { k: 'line', text: fit(T, [`{after|${F}} − {before|${F}} = {change|${SF}}`, `Change: {change|${SF}}`], LIMITS.text), tone: 'key', cue: 1 }
        ] },
        { cue: 2, items: [
          { k: 'line', text: fit(T, [`{changeAbs|${F}} ÷ {before|${F}} = {pctAbs|pct}`, 'Change ÷ start = {pctAbs|pct}'], LIMITS.text), tone: 'key' },
          { k: 'big', text: T('{pct|spct}'), label: 'Change from the start', tone: up ? 'good' : 'bad' },
          { k: 'line', text: fit(T, [`Back to {before|${F}}: {back|spct}`, 'Back to start: {back|spct}'], LIMITS.text), tone: 'note', cue: 3 },
          { k: 'line', text: 'Always divide by the start', tone: 'key', cue: 4 }
        ] }
      ]
    };
  },

  compound(params) {
    const p = merged(BUILDER_DEFAULTS.compound, params);
    const saver = nameText(p.saver, 'Maya');
    const start = numberParam(p.start, 'start', { positive: true, max: 1e9 });
    if (Array.isArray(p.returns) && p.returns.length) {
      need(p.returns.length >= 2 && p.returns.length <= 3, 'returns needs 2 or 3 moves');
      const f = { start };
      let value = start;
      const moves = [];
      p.returns.forEach((raw, index) => {
        const move = numberParam(raw, `returns[${index}]`, { min: -0.9, max: 5 });
        need(!isZero(move), 'each move must be non-zero');
        value *= 1 + move;
        const n = index + 1;
        f[`move${n}`] = move;
        f[`move${n}Abs`] = Math.abs(move);
        f[`value${n}`] = value;
        moves.push({ n, move });
      });
      f.final = value;
      f.total = value / start - 1;
      f.totalAbs = Math.abs(f.total);
      f.average = p.returns.reduce((sum, move) => sum + Number(move), 0) / p.returns.length;
      f.averageAbs = Math.abs(f.average);
      const T = filler(f);
      const S = spokenFiller(f);
      const path = moves.map(({ n, move }, index) => `${index === 0 ? 'It' : 'then'} ${move > 0 ? 'gains' : 'loses'} {move${n}Abs|pct} to {value${n}|usd}`).join(', ');
      const result = f.total > 1e-9 ? 'a gain of {totalAbs|pct}' : f.total < -1e-9 ? 'a loss of {totalAbs|pct}' : 'no change at all';
      const average = isZero(f.average)
        ? `The moves average out to zero, yet the money ends at {final|usd}, ${result}.`
        : `The moves average {averageAbs|pct} ${f.average > 0 ? 'up' : 'down'}, yet the money ends at {final|usd}, ${result}.`;
      return {
        title: 'Moves stack on new amounts',
        given: f,
        say: [
          S(`${saver} starts with {start|usd}.`),
          S(`${path}.`),
          S(average),
          'Each move applies to the new amount, so gains and losses do not simply cancel out.'
        ],
        frames: [
          { cue: 0, items: [
            { k: 'big', text: fit(T, ['{start|usd}', '{start|usd0}'], LIMITS.big), label: 'Starting amount', tone: 'note' }
          ] },
          { cue: 1, items: [
            fittingBars(T, [
              { label: 'Start', value: start, texts: ['{start|usd}', '{start|usd0}'], tone: 'note' },
              ...moves.map(({ n, move }) => ({
                label: fit(T, [`After {move${n}|spct}`, `Move ${n}`], LIMITS.barLabel),
                value: f[`value${n}`],
                texts: [`{value${n}|usd}`, `{value${n}|usd0}`],
                tone: move > 0 ? 'good' : 'bad'
              }))
            ])
          ] },
          { cue: 2, items: [
            { k: 'line', text: fit(T, ['{final|usd} ÷ {start|usd} − 1 = {total|spct}', 'Total change: {total|spct}'], LIMITS.text), tone: 'key' },
            { k: 'big', text: T('{total|spct}'), label: 'Total change', tone: outcomeTone(f.total) },
            { k: 'line', text: 'Moves apply to new amounts', tone: 'note', cue: 3 }
          ] }
        ]
      };
    }
    const f = {
      start,
      rate: numberParam(p.rate, 'rate', { positive: true, max: 1 }),
      years: numberParam(p.years, 'years', { integer: true, min: 2, max: 40 })
    };
    const shown = [...new Set([1, 2, f.years])].filter((year) => year <= f.years);
    for (const year of shown) f[`year${year}`] = start * (1 + f.rate) ** year;
    f.final = f[`year${f.years}`];
    f.gain = f.final - start;
    f.simpleGain = start * f.rate * f.years;
    f.extra = f.gain - f.simpleGain;
    const T = filler(f);
    const S = spokenFiller(f);
    return {
      title: 'Growth on top of growth',
      given: f,
      say: [
        S(`${saver} puts {start|usd} to work at {rate|pct} a year and leaves every gain in place.`),
        S('After one year it is {year1|usd}, and the next year earns {rate|pct} on {year1|usd}, not just on {start|usd}.'),
        S(`After ${yearsWords(f.years, '{years|num}')} it is {final|usd}, a gain of {gain|usd}.`),
        S('Simple interest would pay only {simpleGain|usd}, so the extra {extra|usd} is growth earned on earlier growth.'),
        'Small differences in rate or time turn into big differences at the end.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'line', text: fit(T, ['Start: {start|usd}', 'Start: {start|usd0}'], LIMITS.text), tone: 'note' },
          { k: 'line', text: fit(T, ['Growth: {rate|pct} a year'], LIMITS.text), tone: 'key' }
        ] },
        { cue: 1, items: [
          fittingBars(T, [
            { label: 'Start', value: start, texts: ['{start|usd}', '{start|usd0}'], tone: 'note' },
            ...shown.map((year) => ({
              label: `Year ${year}`,
              value: f[`year${year}`],
              texts: [`{year${year}|usd}`, `{year${year}|usd0}`],
              tone: year === f.years ? 'good' : 'note'
            }))
          ])
        ] },
        { cue: 3, items: [
          { k: 'line', text: fit(T, ['Simple {simpleGain|usd} vs compound {gain|usd}', 'Compound beats simple'], LIMITS.text), tone: 'note' },
          { k: 'big', text: fit(T, ['{extra|usd}', '{extra|usd0}'], LIMITS.big), label: 'Growth earned on growth', tone: 'key' }
        ] }
      ]
    };
  },

  presentValue(params) {
    const p = merged(BUILDER_DEFAULTS.presentValue, params);
    const receiver = nameText(p.receiver, 'Leo');
    const f = {
      amount: numberParam(p.amount, 'amount', { positive: true, max: 1e9 }),
      rate: numberParam(p.rate, 'rate', { positive: true, max: 1 }),
      years: numberParam(p.years, 'years', { integer: true, min: 1, max: 30 })
    };
    f.factor = (1 + f.rate) ** f.years;
    f.pv = f.amount / f.factor;
    f.discount = f.amount - f.pv;
    const compare = p.compareRate !== null && p.compareRate !== undefined;
    if (compare) {
      f.compareRate = numberParam(p.compareRate, 'compareRate', { positive: true, max: 1 });
      need(!isZero(f.compareRate - f.rate), 'compareRate must differ from rate');
      f.pv2 = f.amount / (1 + f.compareRate) ** f.years;
    }
    const T = filler(f);
    const S = spokenFiller(f);
    const span = yearsWords(f.years, '{years|num}');
    /* Only say "divided by 1.21" when that divisor is exact to two decimals;
     * otherwise show the exact formula instead of a rounded divisor. */
    const exactFactor = isZero(roundTo(f.factor, 2) - f.factor);
    const growth = f.years === 1 ? '(1 + {rate|pct})' : '(1 + {rate|pct})^{years|num}';
    const say = [
      S(`${receiver} is promised {amount|usd}, to be paid ${span} from now.`),
      exactFactor
        ? S('If money can earn {rate|pct} a year, that promise is worth {amount|usd} divided by {factor|pts}, which is {pv|usd} today.')
        : S('If money can earn {rate|pct} a year, that promise is worth only {pv|usd} today.'),
      S(`Check it: {pv|usd} growing at {rate|pct} for ${span} becomes {amount|usd} again.`)
    ];
    if (compare) say.push(S(`At {compareRate|pct}, the same promise is worth {pv2|usd} today, so ${f.compareRate > f.rate ? 'a higher rate shrinks' : 'a lower rate raises'} its value now.`));
    say.push('Money later is worth less than money now, because money now can start earning.');
    const frames = [
      { cue: 0, items: [
        { k: 'actors', left: { name: receiver, icon: 'person' }, right: { name: 'Payer', icon: 'bank' }, flows: [
          { dir: 'left', text: fit(T, [`{amount|usd} in ${span}`, '{amount|usd} later', 'Money later'], LIMITS.text) }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'line', text: fit(T, exactFactor
          ? ['{amount|usd} ÷ {factor|pts} = {pv|usd}', 'Later ÷ growth = {pv|usd}']
          : [`{amount|usd} ÷ ${growth}`, 'Later ÷ growth = {pv|usd}'], LIMITS.text), tone: 'key' },
        { k: 'big', text: fit(T, ['{pv|usd}', '{pv|usd0}'], LIMITS.big), label: 'Worth today', tone: 'good' },
        { k: 'line', text: fit(T, exactFactor
          ? ['{pv|usd} × {factor|pts} = {amount|usd}', 'Grows back to {amount|usd}']
          : [`{pv|usd} × ${growth} = {amount|usd}`, 'Grows back to {amount|usd}'], LIMITS.text), tone: 'note', cue: 2 }
      ] }
    ];
    if (compare) {
      frames.push({ cue: 3, items: [
        fittingBars(T, [
          { label: fit(T, ['At {rate|pct}', 'Base rate'], LIMITS.barLabel), value: f.pv, texts: ['{pv|usd}', '{pv|usd0}'], tone: 'good' },
          { label: fit(T, ['At {compareRate|pct}', 'Other rate'], LIMITS.barLabel), value: f.pv2, texts: ['{pv2|usd}', '{pv2|usd0}'], tone: f.pv2 < f.pv ? 'bad' : 'good' }
        ]),
        { k: 'line', text: 'Later money is worth less today', tone: 'note', cue: 4 }
      ] });
    } else {
      frames.push({ cue: 3, items: [{ k: 'stamp', text: 'Money now can earn', tone: 'key' }] });
    }
    return { title: 'A promise, valued today', given: f, say, frames };
  },

  bidAsk(params) {
    const p = merged(BUILDER_DEFAULTS.bidAsk, params);
    const buyer = nameText(p.buyer, 'Maya');
    const seller = nameText(p.seller, buyer === 'Leo' ? 'Maya' : 'Leo');
    const company = companyText(p.company, 'Pixel Pops');
    need(buyer !== seller, 'buyer and seller need different names');
    const f = {
      bid: numberParam(p.bid, 'bid', { positive: true }),
      ask: numberParam(p.ask, 'ask', { positive: true }),
      shares: numberParam(p.shares, 'shares', { integer: true, min: 1, max: 1000000 })
    };
    need(f.ask > f.bid, 'ask must be above the bid');
    f.spread = f.ask - f.bid;
    f.mid = (f.bid + f.ask) / 2;
    f.hurry = f.ask - f.mid;
    f.hurryTotal = f.hurry * f.shares;
    const T = filler(f);
    const S = spokenFiller(f);
    return {
      title: 'Bid, ask, and the last price',
      given: f,
      say: [
        S(`${buyer} offers to buy ${company} shares at {bid|usd}, the bid, and ${seller} offers to sell at {ask|usd}, the ask.`),
        S('The gap between those two prices, {spread|usd}, is the spread.'),
        S(`Not wanting to wait, ${buyer} pays the {ask|usd} ask, and the last price on the screen becomes {ask|usd}.`),
        'That last price is a receipt for one finished trade, not a promise about the next one.',
        S('The middle was {mid|usd}, so not waiting cost {hurry|usd} a share, or {hurryTotal|usd} on {shares|num} shares.')
      ],
      frames: [
        { cue: 0, items: [
          { k: 'actors', left: { name: buyer, icon: 'person', tone: 'good' }, right: { name: seller, icon: 'person2', tone: 'bad' }, flows: [
            { dir: 'right', text: fit(T, ['Bid: I\'d buy at {bid|usd}', 'Bid'], LIMITS.text) },
            { dir: 'left', text: fit(T, ['Ask: I\'d sell at {ask|usd}', 'Ask'], LIMITS.text) }
          ] },
          { k: 'line', text: fit(T, ['{ask|usd} − {bid|usd} = {spread|usd} spread', 'Spread: {spread|usd}'], LIMITS.text), tone: 'key', cue: 1 }
        ] },
        { cue: 2, items: [
          { k: 'stamp', text: fit(T, ['Last price: {ask|usd}', 'Last price = the ask'], LIMITS.stamp), tone: 'key' },
          { k: 'line', text: 'A receipt, not a promise', tone: 'note', cue: 3 }
        ] },
        { cue: 4, items: [
          { k: 'numberLine', marks: sortedMarks([
            { at: f.bid, label: fit(T, ['Bid {bid|usd}', 'Bid'], LIMITS.markLabel), tone: 'good' },
            { at: f.mid, label: fit(T, ['Middle {mid|usd}', 'Middle'], LIMITS.markLabel), tone: 'note' },
            { at: f.ask, label: fit(T, ['Paid {ask|usd}', 'Paid'], LIMITS.markLabel), tone: 'bad' }
          ]), dot: { from: f.mid, to: f.ask } },
          { k: 'line', text: fit(T, ['{ask|usd} − {mid|usd} = {hurry|usd} a share', 'Hurry cost: {hurry|usd} a share'], LIMITS.text) },
          { k: 'line', text: fit(T, ['× {shares|num} shares = {hurryTotal|usd}', 'Total: {hurryTotal|usd}'], LIMITS.text), tone: 'key' }
        ] }
      ]
    };
  },

  expectedValue(params) {
    const p = merged(BUILDER_DEFAULTS.expectedValue, params);
    const person = nameText(p.person, 'Maya');
    const what = phraseText(p.what, 'one trade setup', 28);
    need(Array.isArray(p.outcomes) && p.outcomes.length >= 2 && p.outcomes.length <= 3, 'outcomes needs 2 or 3 entries');
    const f = {};
    const outcomes = p.outcomes.map((outcome, index) => {
      need(isPlainObject(outcome), `outcomes[${index}] must be an object`);
      const n = index + 1;
      const chance = numberParam(outcome.p, `outcomes[${index}].p`, { positive: true, max: 1 });
      const value = numberParam(outcome.value, `outcomes[${index}].value`);
      f[`p${n}`] = chance;
      f[`v${n}`] = value;
      f[`v${n}Abs`] = Math.abs(value);
      f[`c${n}`] = chance * value;
      return { n, label: cleanWords(outcome.label, `Result ${countWord(n)}`, 10), value };
    });
    f.pTotal = outcomes.reduce((sum, outcome) => sum + f[`p${outcome.n}`], 0);
    need(Math.abs(f.pTotal - 1) < 1e-6, 'chances must add up to 1');
    f.ev = outcomes.reduce((sum, outcome) => sum + f[`c${outcome.n}`], 0);
    f.evAbs = Math.abs(f.ev);
    const T = filler(f);
    const S = spokenFiller(f);
    const verdict = f.ev > 1e-9
      ? 'Weighting each result by its chance gives an average gain of {evAbs|usd} per try, before costs.'
      : f.ev < -1e-9
        ? 'Weighting each result by its chance gives an average loss of {evAbs|usd} per try, before costs.'
        : 'Weighting each result by its chance gives an average of zero per try, before costs.';
    return {
      title: 'The average of many tries',
      given: f,
      say: [
        `${person} studies ${what} and lists ${countWord(outcomes.length)} possible results.`,
        ...outcomes.map((outcome) => S(`${outcome.label}: {p${outcome.n}|pct} of the time, ${outcome.value < 0 ? 'a loss of' : 'a gain of'} {v${outcome.n}Abs|usd}.`)),
        S(verdict),
        'An average only shows up over many tries, and any single try can still lose.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'tree', root: capital(what), branches: outcomes.map((outcome) => ({
            label: fit(T, [`${outcome.label} {p${outcome.n}|pct}`, outcome.label], LIMITS.text),
            text: fit(T, [`{v${outcome.n}|susd}`], LIMITS.text),
            tone: outcomeTone(outcome.value)
          })) }
        ] },
        { cue: outcomes.length + 1, items: [
          ...outcomes.map((outcome) => ({
            k: 'line',
            text: fit(T, [`{p${outcome.n}|pct} × {v${outcome.n}|susd} = {c${outcome.n}|susd}`, `${outcome.label}: {c${outcome.n}|susd}`], LIMITS.text),
            tone: outcomeTone(outcome.value)
          })),
          { k: 'big', text: fit(T, ['{ev|susd}', '{ev|usd0}'], LIMITS.big), label: 'Average per try', tone: outcomeTone(f.ev) }
        ] },
        { cue: outcomes.length + 2, items: [{ k: 'stamp', text: 'Average, not a promise', tone: 'note' }] }
      ]
    };
  },

  ratio(params) {
    const p = merged(BUILDER_DEFAULTS.ratio, params);
    const company = companyText(p.company, 'Lagoon Lane');
    const topLabel = lowerFirst(phraseText(p.topLabel, 'profit', 16));
    const bottomLabel = lowerFirst(phraseText(p.bottomLabel, 'sales', 16));
    const unit = p.unit === 'num' ? 'num' : 'usd';
    const as = ['pct', 'x', 'num'].includes(p.as) ? p.as : 'pct';
    const f = {
      top: numberParam(p.top, 'top'),
      bottom: numberParam(p.bottom, 'bottom', { positive: true })
    };
    f.r = f.top / f.bottom;
    const compare = isPlainObject(p.compare);
    let company2 = '';
    if (compare) {
      company2 = companyText(p.compare.company, 'Fizz Town');
      need(company2 !== company, 'compare needs a different company');
      f.top2 = numberParam(p.compare.top, 'compare.top');
      f.bottom2 = numberParam(p.compare.bottom, 'compare.bottom', { positive: true });
      f.r2 = f.top2 / f.bottom2;
    }
    const spoken = (name) => (as === 'pct' ? `{${name}|pct}` : as === 'x' ? `{${name}|pts} times` : `{${name}|num}`);
    const shown = (name) => (as === 'pct' ? `{${name}|pct}` : as === 'x' ? `{${name}|x}` : `{${name}|num}`);
    const T = filler(f);
    const S = spokenFiller(f);
    const shortName = (name) => (name.length <= LIMITS.barLabel ? name : name.split(' ')[0].slice(0, LIMITS.barLabel));
    const insight = typeof p.insight === 'string' && p.insight.trim() ? S(p.insight.trim()) : null;
    const say = [
      S(`${company} has {top|${unit}} of ${topLabel} on {bottom|${unit}} of ${bottomLabel}.`),
      S(`The ratio is {top|${unit}} divided by {bottom|${unit}}, which is ${spoken('r')}.`)
    ];
    if (compare) say.push(S(`${company2} has {top2|${unit}} of ${topLabel} on {bottom2|${unit}} of ${bottomLabel}, which is ${spoken('r2')}.`));
    say.push(insight || (compare
      ? 'Dividing turns companies of different sizes into one fair comparison.'
      : 'Dividing puts companies of any size on the same scale.'));
    const frames = [
      { cue: 0, items: [
        { k: 'line', text: fit(T, [`${capital(topLabel)}: {top|${unit}}`, 'Top: {top|num}'], LIMITS.text), tone: 'note' },
        { k: 'line', text: fit(T, [`${capital(bottomLabel)}: {bottom|${unit}}`, 'Bottom: {bottom|num}'], LIMITS.text), tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: fit(T, [`{top|${unit}} ÷ {bottom|${unit}} = ${shown('r')}`, `Ratio = ${shown('r')}`], LIMITS.text), tone: 'key' },
        { k: 'big', text: fit(T, [shown('r')], LIMITS.big), label: fit(T, [`${capital(topLabel)} ÷ ${bottomLabel}`, 'The ratio'], LIMITS.text), tone: 'key' }
      ] }
    ];
    if (compare) {
      frames.push({ cue: 2, items: [
        { k: 'bars', items: [
          { label: shortName(company), value: isZero(f.r) && isZero(f.r2) ? 1 : f.r, text: fit(T, [shown('r')], LIMITS.text), tone: 'key' },
          { label: shortName(company2) === shortName(company) ? 'Other' : shortName(company2), value: f.r2, text: fit(T, [shown('r2')], LIMITS.text), tone: 'note' }
        ] },
        { k: 'line', text: 'Same scale, fair comparison', tone: 'note', cue: 3 }
      ] });
    } else {
      frames.push({ cue: 2, items: [{ k: 'stamp', text: 'Same scale for every size', tone: 'key' }] });
    }
    return { title: 'One ratio, one fair scale', given: f, say, frames };
  },

  drawdownRecovery(params) {
    const p = merged(BUILDER_DEFAULTS.drawdownRecovery, params);
    const holder = nameText(p.holder, 'Maya');
    const f = {
      start: numberParam(p.start, 'start', { positive: true, max: 1e9 }),
      drop: numberParam(p.drop, 'drop', { positive: true, max: 0.95 })
    };
    f.after = f.start * (1 - f.drop);
    f.lost = f.start - f.after;
    f.needed = f.start / f.after - 1;
    const T = filler(f);
    const S = spokenFiller(f);
    return {
      title: 'Down is faster than back up',
      given: f,
      say: [
        S(`${holder}'s account falls {drop|pct}, from {start|usd} to {after|usd}.`),
        S('To get back to {start|usd}, the account has to earn the missing {lost|usd}.'),
        S('But it now starts from {after|usd}, and {lost|usd} divided by {after|usd} is a gain of {needed|pct}.'),
        'The deeper the fall, the steeper the climb back, which is why limiting losses comes first.'
      ],
      frames: [
        { cue: 0, items: [
          fittingBars(T, [
            { label: 'Start', value: f.start, texts: ['{start|usd}', '{start|usd0}'], tone: 'note' },
            { label: 'After drop', value: f.after, texts: ['{after|usd}', '{after|usd0}'], tone: 'bad' }
          ]),
          { k: 'line', text: T('Down {drop|pct}'), tone: 'bad' },
          { k: 'line', text: fit(T, ['Missing: {lost|usd}', 'Missing: {lost|usd0}'], LIMITS.text), tone: 'note', cue: 1 }
        ] },
        { cue: 2, items: [
          { k: 'line', text: fit(T, ['{lost|usd} ÷ {after|usd} = {needed|pct}', 'Missing ÷ what is left = {needed|pct}'], LIMITS.text), tone: 'key' },
          { k: 'big', text: T('{needed|spct}'), label: 'Gain needed to get back', tone: 'key' },
          { k: 'line', text: 'Deeper fall, steeper climb', tone: 'bad', cue: 3 }
        ] }
      ]
    };
  },

  bondYield(params) {
    const p = merged(BUILDER_DEFAULTS.bondYield, params);
    const buyer = nameText(p.buyer, 'Leo');
    const issuer = companyText(p.issuer, 'Harbor Town');
    const f = {
      face: numberParam(p.face, 'face', { positive: true, max: 1e7 }),
      coupon: numberParam(p.coupon, 'coupon', { min: 0 })
    };
    f.total = f.face + f.coupon;
    if (p.price !== null && p.price !== undefined) {
      f.price = numberParam(p.price, 'price', { positive: true });
    } else {
      f.yieldGiven = numberParam(p.yield, 'yield', { min: -0.5, max: 1 });
      f.price = f.total / (1 + f.yieldGiven);
    }
    f.ytm = f.total / f.price - 1;
    need(f.ytm > 0 && f.ytm < 1, 'price must make a positive yield below 100 percent');
    const rateMove = p.newYield !== null && p.newYield !== undefined;
    if (rateMove) {
      f.newYield = numberParam(p.newYield, 'newYield', { min: -0.5, max: 1 });
      need(!isZero(f.newYield - f.ytm), 'newYield must differ from the current yield');
      f.newPrice = f.total / (1 + f.newYield);
    }
    const T = filler(f);
    const S = spokenFiller(f);
    const say = [
      S(`${issuer} sells a one-year bond that pays {coupon|usd} of interest plus the {face|usd} back at the end.`),
      S(`${buyer} pays {price|usd} for it today.`),
      S(`In one year ${buyer} gets {total|usd}, which is {ytm|pct} more than the {price|usd} paid, and that is the yield.`)
    ];
    if (rateMove) say.push(S(`If new bonds start yielding {newYield|pct}, buyers will pay {newPrice|usd} for this one instead.`));
    say.push('Same promise, different price: bond prices and yields move in opposite directions.');
    const frames = [
      { cue: 0, items: [
        { k: 'actors', left: { name: buyer, icon: 'person' }, right: { name: issuer, icon: /town|city|county|state/i.test(issuer) ? 'city' : 'company' }, flows: [
          { dir: 'right', text: fit(T, ['{price|usd} today', 'Price today'], LIMITS.text) },
          { dir: 'left', text: fit(T, ['{total|usd} in one year', 'Paid back in one year'], LIMITS.text) }
        ] }
      ] },
      { cue: 2, items: [
        { k: 'line', text: fit(T, ['{total|usd} ÷ {price|usd} − 1 = {ytm|pct}', 'Yield = {ytm|pct}'], LIMITS.text), tone: 'key' },
        { k: 'big', text: T('{ytm|pct}'), label: 'Yield for the year', tone: 'key' }
      ] }
    ];
    if (rateMove) {
      frames.push({ cue: 3, items: [
        fittingBars(T, [
          { label: 'Now', value: f.price, texts: ['{price|usd}', '{price|usd0}'], tone: 'note' },
          { label: fit(T, ['At {newYield|pct}', 'New yield'], LIMITS.barLabel), value: f.newPrice, texts: ['{newPrice|usd}', '{newPrice|usd0}'], tone: f.newPrice < f.price ? 'bad' : 'good' }
        ]),
        { k: 'line', text: f.newPrice < f.price ? 'Yield up, price down' : 'Yield down, price up', tone: 'note', cue: 4 }
      ] });
    }
    return { title: 'Price and yield on a seesaw', given: f, say, frames };
  },

  twoChoices(params) {
    const p = merged(BUILDER_DEFAULTS.twoChoices, params);
    const errors = [];
    const facts = computeFacts(p.given, p.calc, undefined, errors);
    need(!errors.length, errors.join('; '));
    const T = filler(facts);
    const S = spokenFiller(facts);
    const sentence = (value, name) => {
      need(typeof value === 'string' && value.trim(), `${name} must be a sentence`);
      return T(value.trim());
    };
    const column = (value, name) => {
      need(isPlainObject(value), `${name} must be { title, lines }`);
      const lines = Array.isArray(value.lines) ? value.lines : [];
      need(lines.length <= 3, `${name}.lines has more than 3 lines`);
      return { title: sentence(value.title, `${name}.title`), lines: lines.map((line, index) => sentence(line, `${name}.lines[${index}]`)) };
    };
    const wrong = column(p.wrong, 'wrong');
    const right = column(p.right, 'right');
    const spokenSentence = (value, name) => {
      need(typeof value === 'string' && value.trim(), `${name} must be a sentence`);
      return S(value.trim());
    };
    const say = [spokenSentence(p.situation, 'situation'), spokenSentence(p.wrongSay, 'wrongSay'), spokenSentence(p.rightSay, 'rightSay'), spokenSentence(p.lesson, 'lesson')];
    if (typeof p.extra === 'string' && p.extra.trim()) say.push(S(p.extra.trim()));
    const opening = [];
    if (isPlainObject(p.actors)) opening.push({ k: 'actors', ...p.actors });
    opening.push({ k: 'line', text: sentence(p.headline, 'headline'), tone: 'key' });
    if (isPlainObject(p.big)) opening.push({ k: 'big', text: T(String(p.big.text || '')), ...(p.big.label ? { label: T(String(p.big.label)) } : {}), ...(p.big.tone ? { tone: p.big.tone } : {}) });
    return {
      family: typeof p.family === 'string' ? p.family : null,
      title: typeof p.title === 'string' ? p.title : 'Two choices, one better',
      given: facts,
      say,
      frames: [
        { cue: 0, items: opening },
        { cue: 1, items: [{ k: 'compare', left: { ...wrong, mark: 'cross' }, right: { ...right, mark: 'check' } }] },
        { cue: 3, items: [{ k: 'stamp', text: sentence(p.stamp, 'stamp'), tone: 'key' }] }
      ]
    };
  },

  process(params) {
    const p = merged(BUILDER_DEFAULTS.process, params);
    const errors = [];
    const facts = computeFacts(p.given, p.calc, undefined, errors);
    need(!errors.length, errors.join('; '));
    const T = filler(facts);
    const S = spokenFiller(facts);
    const actor = nameText(p.actor, 'Maya');
    need(Array.isArray(p.steps) && p.steps.length >= 2 && p.steps.length <= 4, 'steps needs 2 to 4 entries');
    const steps = p.steps.map((step, index) => {
      const label = typeof step === 'string' ? step : step && step.label;
      const spoken = typeof step === 'string' ? step.toLowerCase() : step && (step.say || String(step.label || '').toLowerCase());
      need(typeof label === 'string' && label.trim(), `steps[${index}] needs a label`);
      need(typeof spoken === 'string' && spoken.trim(), `steps[${index}] needs words to say`);
      return { label: T(label.trim()), say: T(spoken.trim().replace(/[.!?]+$/, '')) };
    });
    need(typeof p.goal === 'string' && p.goal.trim(), 'goal must be a phrase');
    need(typeof p.why === 'string' && p.why.trim(), 'why must be a sentence');
    const s = steps.map((step) => step.say);
    const middle = steps.length === 2
      ? [`First, ${s[0]}, and then ${s[1]}.`]
      : steps.length === 3
        ? [`First, ${s[0]}.`, `Then, ${s[1]}, and last, ${s[2]}.`]
        : [`First, ${s[0]}, then ${s[1]}.`, `Next, ${s[2]}, and last, ${s[3]}.`];
    const say = [S(`${actor} wants to ${p.goal.trim().replace(/[.!?]+$/, '')}.`), ...middle, S(p.why.trim())];
    return {
      family: typeof p.family === 'string' ? p.family : null,
      title: typeof p.title === 'string' ? p.title : 'Same steps, same order',
      given: facts,
      say,
      frames: [
        { cue: 0, items: [{ k: 'line', text: T(String(p.headline || 'Same steps, every time')), tone: 'key' }] },
        { cue: 1, items: [{ k: 'steps', items: steps.map((step) => step.label) }] },
        { cue: say.length - 1, items: [{ k: 'stamp', text: T(String(p.stamp || 'Same order, every time')), tone: 'key' }] }
      ]
    };
  },

  scenarioTree(params) {
    const p = merged(BUILDER_DEFAULTS.scenarioTree, params);
    const planner = nameText(p.planner, 'Maya');
    const company = companyText(p.company, 'Maple Mill');
    need(Array.isArray(p.branches) && p.branches.length >= 2 && p.branches.length <= 3, 'branches needs 2 or 3 paths');
    const f = { price: numberParam(p.price, 'price', { positive: true }) };
    const branches = p.branches.map((branch, index) => {
      need(isPlainObject(branch), `branches[${index}] must be an object`);
      const n = index + 1;
      f[`p${n}`] = numberParam(branch.p, `branches[${index}].p`, { positive: true, max: 1 });
      f[`v${n}`] = numberParam(branch.value, `branches[${index}].value`, { min: 0 });
      f[`c${n}`] = f[`p${n}`] * f[`v${n}`];
      return { n, label: cleanWords(branch.label, `Path ${countWord(n)}`, 10) };
    });
    f.pTotal = branches.reduce((sum, branch) => sum + f[`p${branch.n}`], 0);
    need(Math.abs(f.pTotal - 1) < 1e-6, 'branch chances must add up to 1');
    f.weighted = branches.reduce((sum, branch) => sum + f[`c${branch.n}`], 0);
    f.change = f.weighted / f.price - 1;
    f.changeAbs = Math.abs(f.change);
    const T = filler(f);
    const S = spokenFiller(f);
    const list = branches.map((branch) => `${lowerFirst(branch.label)}, a {p${branch.n}|pct} chance of {v${branch.n}|usd}`);
    const position = f.change > 1e-9 ? '{changeAbs|pct} above' : f.change < -1e-9 ? '{changeAbs|pct} below' : 'right at';
    return {
      title: 'Paths, chances, one plan',
      given: f,
      say: [
        S(`${planner} writes ${countWord(branches.length)} possible paths for ${company}, which trades at {price|usd}.`),
        S(`The paths are ${list.join('; ')}.`),
        S('The chances add up to {pTotal|pct}, which is the first thing to check.'),
        S(`Weighting each path by its chance gives {weighted|usd}, ${position} today's price.`),
        'The tree is a plan for every path, not a prediction of one.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'tree', root: fit(T, ['Today: {price|usd}', 'Today'], LIMITS.text), branches: branches.map((branch) => ({
            label: fit(T, [`${branch.label} {p${branch.n}|pct}`, branch.label], LIMITS.text),
            text: fit(T, [`{v${branch.n}|usd}`], LIMITS.text),
            tone: f[`v${branch.n}`] > f.price + 1e-9 ? 'good' : f[`v${branch.n}`] < f.price - 1e-9 ? 'bad' : 'note'
          })) }
        ] },
        { cue: 2, items: [
          { k: 'line', text: fit(T, [`${branches.map((branch) => `{p${branch.n}|pct}`).join(' + ')} = {pTotal|pct}`, 'Chances total {pTotal|pct}'], LIMITS.text), tone: 'key' }
        ] },
        { cue: 3, items: [
          ...branches.map((branch) => ({ k: 'line', text: fit(T, [`{p${branch.n}|pct} × {v${branch.n}|usd} = {c${branch.n}|usd}`, `${branch.label}: {c${branch.n}|usd}`], LIMITS.text) })),
          { k: 'big', text: fit(T, ['{weighted|usd}', '{weighted|usd0}'], LIMITS.big), label: 'Probability-weighted value', tone: 'key' },
          { k: 'line', text: 'A plan, not a prediction', tone: 'note', cue: 4 }
        ] }
      ]
    };
  },

  candle(params) {
    const p = merged(BUILDER_DEFAULTS.candle, params);
    const company = companyText(p.company, 'Tidewater Toys');
    const period = phraseText(p.period, 'one day', 20).toLowerCase();
    const f = {
      open: numberParam(p.open, 'open', { positive: true }),
      high: numberParam(p.high, 'high', { positive: true }),
      low: numberParam(p.low, 'low', { positive: true }),
      close: numberParam(p.close, 'close', { positive: true })
    };
    need(f.high >= Math.max(f.open, f.close) && f.low <= Math.min(f.open, f.close) && f.high > f.low, 'high and low must wrap open and close');
    f.body = f.close - f.open;
    f.bodyAbs = Math.abs(f.body);
    f.upper = f.high - Math.max(f.open, f.close);
    f.lower = Math.min(f.open, f.close) - f.low;
    f.range = f.high - f.low;
    const T = filler(f);
    const S = spokenFiller(f);
    const up = f.body > 1e-9;
    const flat = isZero(f.body);
    return {
      title: 'One candle, four prices',
      given: f,
      say: [
        `One candle sums up ${period} of trading in ${company} shares.`,
        flat
          ? S('It opened and closed at {open|usd}, so the body is only a thin line.')
          : S(`It opened at {open|usd} and closed at {close|usd}, so the body is {bodyAbs|usd} tall and colored ${up ? 'green for a rise' : 'red for a fall'}.`),
        S('The highest trade was {high|usd} and the lowest was {low|usd}, a range of {range|usd}.'),
        S('The thin wicks show prices that traded but did not hold: {upper|usd} above the body and {lower|usd} below it.'),
        'A candle records what happened, not what happens next.'
      ],
      frames: [
        { cue: 0, items: [
          { k: 'candle', open: f.open, high: f.high, low: f.low, close: f.close },
          { k: 'line', text: fit(T, ['Open {open|usd}, close {close|usd}', 'Open and close'], LIMITS.text), tone: 'note' }
        ] },
        { cue: 1, items: [
          { k: 'line', text: fit(T, ['Body: {close|usd} − {open|usd} = {body|susd}', 'Body: {body|susd}'], LIMITS.text), tone: up ? 'good' : flat ? 'note' : 'bad' },
          { k: 'line', text: fit(T, ['Range: {high|usd} − {low|usd} = {range|usd}', 'Range: {range|usd}'], LIMITS.text), tone: 'key', cue: 2 },
          { k: 'line', text: fit(T, ['Wicks: {upper|usd} up, {lower|usd} down', 'Wicks: prices that faded'], LIMITS.text), tone: 'note', cue: 3 }
        ] },
        { cue: 4, items: [{ k: 'stamp', text: 'What happened, not what next', tone: 'key' }] }
      ]
    };
  }
};

function runBuilder(name, params = {}, meta = {}) {
  if (!hasOwn(SPECS, name)) throw new Error(`unknown builder "${name}"`);
  const built = SPECS[name](isPlainObject(params) ? params : {});
  const { family: builtFamily, ...spec } = built;
  if (isPlainObject(params) && typeof params.title === 'string' && params.title.trim()) spec.title = params.title.trim();
  const id = typeof meta.id === 'string' ? meta.id : '0.0';
  const family = typeof meta.family === 'string' && meta.family ? meta.family : builtFamily || BUILDER_FAMILY[name];
  const source = meta.source === 'authored' ? 'authored' : 'auto';
  const { example, errors } = buildExample(id, family, spec, source);
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
  return example;
}

/* builders.optionPut(params?, { id?, family?, source? }) -> valid frozen example (throws on bad params) */
const builders = Object.freeze(Object.fromEntries(Object.keys(SPECS).map((name) => [name, (params, meta) => runBuilder(name, params, meta)])));

/* ------------------------------------------------------------------ */
/* Authored data: E() and B()                                           */
/* ------------------------------------------------------------------ */

function authoredRecord(id, family, via, example, errors) {
  return Object.freeze({
    kind: RECORD_KIND,
    id: String(id),
    family: family ? String(family) : '',
    via,
    example: errors.length ? null : example,
    errors: Object.freeze(errors.slice())
  });
}

function idErrors(id) {
  return typeof id === 'string' && /^\d{1,3}\.\d{1,3}$/.test(id) ? [] : [`id must be a string like "9.1" (got ${JSON.stringify(id)})`];
}

/* E(id, family, spec): authored example from { given, calc, literals?, title?, say, frames }.
 * Never throws; problems are listed in record.errors (tests fail on them, runtime falls back to auto). */
function E(id, family, spec) {
  const problems = idErrors(id);
  let result = { example: null, errors: [] };
  try {
    result = buildExample(String(id), family, spec, 'authored');
  } catch (error) {
    result = { example: null, errors: [error.message] };
  }
  return authoredRecord(id, family, 'spec', result.example, [...problems, ...result.errors]);
}

/* B(id, family, builderName, params): authored example produced by a builder. */
function B(id, family, builderName, params) {
  const problems = idErrors(id);
  let example = null;
  try {
    example = runBuilder(builderName, params, { id: String(id), family: family || undefined, source: 'authored' });
  } catch (error) {
    problems.push(error.message);
  }
  return authoredRecord(id, family || (example && example.family) || BUILDER_FAMILY[builderName] || '', `builder:${builderName}`, example, problems);
}

function isAuthoredRecord(value) {
  return Boolean(value) && value.kind === RECORD_KIND;
}

/* ------------------------------------------------------------------ */
/* autoExample: classify any lesson and pick builder params             */
/* ------------------------------------------------------------------ */

/* The one fictional cast for every example, authored or generated. The names
 * sound clearly different when spoken (no Maya/Mia, Ava/Ana pairs), and
 * examples.test.js fails if an authored example uses a name outside it. */
const PEOPLE = Object.freeze(['Maya', 'Leo', 'Ava', 'Kofi', 'Zoe', 'Ravi', 'Nia', 'Omar', 'Lena', 'Theo', 'Iris', 'Sam']);
const COMPANIES = Object.freeze(['Pebblestone Phones', 'Pixel Pops', 'Lagoon Lane', 'Fizz Town', 'Maple Mill', 'Comet Cafe', 'Tidewater Toys', 'Bright Kettle', 'Orbit Oats', 'Harbor Bikes']);

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lessonKey(lesson) {
  const moduleId = Number(lesson && lesson.moduleId);
  const lessonId = Number(lesson && lesson.lessonId);
  return Number.isInteger(moduleId) && Number.isInteger(lessonId) && moduleId >= 0 && lessonId >= 0 && moduleId < 1000 && lessonId < 1000
    ? `${moduleId}.${lessonId}` : '0.0';
}

function lessonTexts(lesson) {
  const source = lesson && typeof lesson === 'object' ? lesson : {};
  const str = (value) => (typeof value === 'string' ? value : '');
  const steps = (Array.isArray(source.steps) ? source.steps : []).map((step) => str(step).split(/\s+Indicator lab:/i)[0]);
  return {
    title: str(source.title),
    description: str(source.description),
    steps: steps.join(' \n '),
    prompt: str(source.question && source.question.prompt)
  };
}

const TWO_CHOICE_TEMPLATES = Object.freeze([
  { id: 'law_insider', title: 'A tip nobody else has', patterns: [[/insider/, 8], [/nonpublic|non-public|\bmnpi\b/, 8], [/\btip(?:s|pee)?\b/, 2]], params: {
    person: 'Ava', headline: 'A secret tip before the news',
    situation: 'Ava hears at a dinner that a company will be bought tomorrow, before any public announcement.',
    wrongSay: 'One choice is to buy right away, using news that nobody else has.',
    rightSay: 'The fair choice is to do nothing until the news is public for everyone.',
    lesson: 'If news is secret and could move the price, trading on it is off limits.',
    wrong: { title: 'Trade on the tip', lines: ['Secret news', 'Not public yet', 'Breaks the rules'] },
    right: { title: 'Wait for the news', lines: ['Public for all', 'Same facts', 'Fair trade'] },
    stamp: 'Secret news is off limits' } },
  { id: 'law_manipulation', title: 'Real orders, fair prices', patterns: [[/manipulat/, 8], [/spoof/, 8], [/wash trad|pump and dump|market integrity/, 6]], params: {
    person: 'Kofi', headline: 'Fake orders or real orders?',
    situation: 'Kofi could flash big buy orders he never plans to fill, just to push the price up.',
    wrongSay: 'Placing orders you plan to cancel, to fool other traders, is called spoofing.',
    rightSay: 'Honest orders are ones you would be happy to have filled.',
    lesson: 'Prices only mean something when the orders behind them are real.',
    wrong: { title: 'Fake orders', lines: ['Not meant to fill', 'Tricks others', 'Illegal'] },
    right: { title: 'Real orders', lines: ['Meant to trade', 'Honest signal', 'Fair market'] },
    stamp: 'Real orders only' } },
  { id: 'fiduciary_conflict', title: 'Whose interest comes first?', patterns: [[/fiduciar/, 8], [/conflicts? of interest|\bconflicts?\b/, 4], [/suitab|best interest/, 6]], params: {
    person: 'Nia', headline: 'Two funds, two fees',
    situation: 'An adviser can put Nia\'s {amount|usd} in a fund costing {lowFee|pct} a year or in one costing {highFee|pct}.',
    wrongSay: 'The pricier fund pays the adviser more, but it costs Nia {diff|usd} more every year.',
    rightSay: 'A fiduciary must put the client first, even when that pays the adviser less.',
    lesson: 'Knowing how an adviser gets paid helps you spot a conflict of interest.',
    wrong: { title: 'Higher-fee fund', lines: ['Adviser paid more', 'Costs {highFee|pct}'] },
    right: { title: 'Client-first fund', lines: ['Lower cost', 'Costs {lowFee|pct}'] },
    stamp: 'Client first',
    given: { amount: 10000, lowFee: 0.002, highFee: 0.012 },
    calc: { diff: 'amount * (highFee - lowFee)' },
    big: { text: '{diff|usd}', label: 'Extra cost every year', tone: 'bad' } } },
  { id: 'bias_anchoring', title: 'Stuck on the price you paid', patterns: [[/\bbias(?:es)?\b/, 4], [/anchor/, 6], [/loss aversion|prospect theory/, 6], [/herd|bubble|reflexiv/, 5], [/recency|availability|overconfiden/, 5], [/behavio(?:u)?ral|emotion|narrative/, 3]], params: {
    person: 'Leo', headline: 'Old price or today\'s facts?',
    situation: 'Leo bought at {paid|usd}, the price is now {now|usd}, and he wants to wait until he gets back to even.',
    wrongSay: 'His purchase price feels important, but the market does not know or care what he paid.',
    rightSay: 'A better question is whether he would buy it today at {now|usd}, knowing what he knows now.',
    lesson: 'Decisions work better on today\'s evidence than on a number stuck in your head.',
    wrong: { title: 'Wait to get even', lines: ['Anchored to cost', 'Ignores new facts'] },
    right: { title: 'Judge it fresh', lines: ['Would I buy today?', 'Facts, not hope'] },
    stamp: 'The market ignores your cost',
    given: { paid: 80, now: 40 } } },
  { id: 'data_leakage', title: 'No peeking at the future', patterns: [[/leak/, 7], [/look-ahead|lookahead/, 7], [/overfit/, 6], [/backtest/, 4], [/survivor/, 5], [/point-in-time/, 5], [/cross-validat|machine learning/, 4], [/data snoop|p-hack/, 6]], params: {
    person: 'Zoe', headline: 'Past data only',
    situation: 'Zoe tests a trading rule and accidentally lets it peek at numbers that were only published later.',
    wrongSay: 'The test looks amazing, because the rule already knew what was coming.',
    rightSay: 'An honest test only uses data that was really available on each day.',
    lesson: 'If a result looks too good, first check it for data from the future.',
    wrong: { title: 'Peek at the future', lines: ['Great on paper', 'Impossible live'] },
    right: { title: 'Use past data only', lines: ['Point-in-time', 'Honest test'] },
    stamp: 'No peeking at tomorrow' } },
  { id: 'catalyst_evidence', title: 'Rumor or filing?', patterns: [[/filings?\b/, 5], [/disclos/, 5], [/catalyst/, 4], [/evidence/, 3], [/rumou?r/, 6], [/primary source/, 5]], params: {
    person: 'Omar', headline: 'Rumor or filing?',
    situation: 'Omar sees a chat post saying a company will announce huge news, with no link and no source.',
    wrongSay: 'The rumor is exciting, but nobody can check who wrote it or why.',
    rightSay: 'An official filing is dated, public, and someone is legally responsible for it.',
    lesson: 'Rank evidence by how easy it is to check, not by how exciting it sounds.',
    wrong: { title: 'Chat-room rumor', lines: ['No source', 'Cannot check', 'Could be a trap'] },
    right: { title: 'Official filing', lines: ['Signed and dated', 'Anyone can read', 'Can be checked'] },
    stamp: 'Check the source first' } },
  { id: 'forensic_red_flag', title: 'When profit and cash disagree', patterns: [[/fraud/, 7], [/forensic/, 7], [/red flags?/, 5], [/earnings quality|restat/, 4]], params: {
    person: 'Iris', headline: 'Profit up, cash down',
    situation: 'A company reports {profit|usd} of profit, but the cash from its business went down by {cashDrop|usd}.',
    wrongSay: 'Reading only the profit line would make this look like a great year.',
    rightSay: 'Iris asks why {gap|usd} of reported profit never showed up as cash.',
    lesson: 'When profit and cash tell different stories, the cash usually deserves more trust.',
    wrong: { title: 'Trust the headline', lines: ['Profit looks great', 'Cash ignored'] },
    right: { title: 'Follow the cash', lines: ['Where\'s the cash?', 'Check receivables'] },
    stamp: 'Cash is harder to fake',
    given: { profit: 500, cashDrop: 100 },
    calc: { gap: 'profit + cashDrop' } } },
  { id: 'governance_agency', title: 'Follow the incentives', patterns: [[/governance/, 7], [/agency/, 5], [/incentive/, 4], [/executive|compensation|\bboard\b/, 3]], params: {
    person: 'Theo', headline: 'Whose interest wins?',
    situation: 'A manager gets a big bonus only if a risky project pays off, but the owners carry the losses.',
    wrongSay: 'With that deal, the manager is paid to gamble with money that is not theirs.',
    rightSay: 'Better pay plans make managers share the downside as well as the upside.',
    lesson: 'To predict a decision, look at how the decision maker gets paid.',
    wrong: { title: 'Chase the bonus', lines: ['Manager wins big', 'Owners take loss'] },
    right: { title: 'Owner-first choice', lines: ['Shared upside', 'Shared downside'] },
    stamp: 'Follow the incentives' } },
  { id: 'causality', title: 'Linked is not the same as caused', patterns: [[/causal/, 7], [/omitted variables?|confound/, 8], [/regression/, 4], [/correlation (?:is not|isn't|versus|vs\.?) caus/, 8]], params: {
    person: 'Lena', headline: 'Linked or caused?',
    situation: 'Lena notices that towns with more parking spots also have bigger store sales.',
    wrongSay: 'Adding parking spots may not create a single shopper, because bigger towns simply have more of both.',
    rightSay: 'Comparing towns of the same size shows whether parking itself makes any difference.',
    lesson: 'Before trusting a pattern, look for a hidden third factor that drives both.',
    wrong: { title: 'Parking causes sales', lines: ['Looks linked', 'Ignores town size'] },
    right: { title: 'Hidden factor', lines: ['Compare like towns', 'Then judge'] },
    stamp: 'Look for the third factor' } },
  { id: 'game_theory', title: 'Meeting again tomorrow', patterns: [[/game theory/, 8], [/prisoner/, 6], [/repeated (?:game|interaction)/, 6], [/strategic interaction/, 5], [/cooperat/, 3]], params: {
    person: 'Ava', headline: 'Cut prices or hold steady?',
    situation: 'Ava and Omar run the only two lemonade stands on one street and meet again every single day.',
    wrongSay: 'Undercutting wins for a day, but the other stand copies it and both can end up earning less.',
    rightSay: 'Holding a fair price can work when both know they will meet again tomorrow.',
    lesson: 'In a repeated game, today\'s move changes how the other side plays tomorrow.',
    wrong: { title: 'Undercut today', lines: ['Win one day', 'Price war after'] },
    right: { title: 'Hold a fair price', lines: ['Both earn more', 'Works if repeated'] },
    stamp: 'Tomorrow changes today' } },
  { id: 'signaling', title: 'Proof that is hard to fake', patterns: [[/asymmetr/, 7], [/\blemons?\b/, 4], [/signal(?:ing|ling)\b/, 5], [/information gap|hidden information/, 5]], params: {
    person: 'Kofi', headline: 'Who knows more?',
    situation: 'Kofi wants to buy a used bike, but only the seller knows whether it has hidden problems.',
    wrongSay: 'A spoken promise costs the seller nothing, so it tells Kofi very little.',
    rightSay: 'A costly promise, like free repairs for a year, only makes sense for a seller with a good bike.',
    lesson: 'A signal is believable when it would be too expensive for a faker to copy.',
    wrong: { title: 'Trust the words', lines: ['Free to say', 'Easy to fake'] },
    right: { title: 'Costly proof', lines: ['Repair promise', 'Hard to fake'] },
    stamp: 'Costly signals are credible' } },
  { id: 'trading_costs', title: 'Every trade has a cost', patterns: [[/turnover/, 5], [/transaction costs?/, 7], [/market impact/, 6], [/\bfees?\b/, 3]], params: {
    person: 'Theo', headline: 'Trade often or trade less?',
    situation: 'Theo can run a busy plan with {busyTrades|num} trades a year or a calm plan with {calmTrades|num}, and each trade costs about {costEach|pct}.',
    wrongSay: 'The busy plan pays about {busyDrag|pct} a year in costs before it earns anything.',
    rightSay: 'The calm plan pays about {calmDrag|pct}, so it needs a much smaller edge to come out ahead.',
    lesson: 'Costs are certain while profits are not, so every extra trade has to earn its cost.',
    wrong: { title: 'Busy plan', lines: ['{busyTrades|num} trades a year', '{busyDrag|pct} in costs'] },
    right: { title: 'Calm plan', lines: ['{calmTrades|num} trades a year', '{calmDrag|pct} in costs'] },
    stamp: 'Costs come first',
    given: { busyTrades: 10, calmTrades: 2, costEach: 0.005 },
    calc: { busyDrag: 'busyTrades * costEach', calmDrag: 'calmTrades * costEach' } } }
]);

const PROCESS_TEMPLATES = Object.freeze([
  { id: 'model_monitoring', title: 'Keep the model honest', patterns: [[/monitor/, 5], [/drift/, 6], [/kill switch/, 6], [/model governance/, 6]], params: {
    actor: 'Lena', goal: 'keep a trading model honest after launch', headline: 'Watch the model every day',
    steps: [
      { label: 'Set limits', say: 'set the limits the model must stay inside' },
      { label: 'Watch live', say: 'watch its live results every day' },
      { label: 'Compare', say: 'compare live results with the test results' },
      { label: 'Pause if off', say: 'pause it when results drift outside the limits' }
    ],
    why: 'A model that worked in testing can quietly stop working when markets change.',
    stamp: 'Pause first, fix second' } },
  { id: 'trade_review', title: 'Grade the process, not the luck', patterns: [[/journal/, 7], [/\breview/, 4], [/debias/, 6], [/post-trade|decompos/, 5], [/falsif/, 3]], params: {
    actor: 'Ravi', goal: 'learn from every trade, win or lose', headline: 'Grade the decision, not the luck',
    steps: [
      { label: 'Plan', say: 'write the plan before the trade' },
      { label: 'Trade', say: 'follow the plan' },
      { label: 'Record', say: 'record what happened and how it felt' },
      { label: 'Review', say: 'compare the result with the plan' }
    ],
    why: 'Reviewing the decision, not just the result, separates good luck from good process.',
    stamp: 'Grade the process' } },
  { id: 'order_execution', title: 'From order to fill', patterns: [[/execution/, 4], [/routing/, 6], [/order types?/, 6], [/best execution/, 7], [/slippage/, 5]], params: {
    actor: 'Kofi', goal: 'buy shares without paying more than needed', headline: 'Every step can hide a cost',
    steps: [
      { label: 'Pick order', say: 'pick the order type' },
      { label: 'Check spread', say: 'check the spread and the size shown' },
      { label: 'Send', say: 'send the order' },
      { label: 'Check fill', say: 'check the fill price against the quote' }
    ],
    why: 'Every step is a place where hidden trading costs can sneak in.',
    stamp: 'Check every fill' } },
  { id: 'rates_transmission', title: 'One rate, a chain of effects', patterns: [[/central bank/, 7], [/monetary/, 6], [/transmission/, 5], [/policy rate/, 6]], params: {
    actor: 'Iris', goal: 'follow what happens after a central bank raises its rate', headline: 'One rate, a chain of effects',
    steps: [
      { label: 'Rate rises', say: 'the policy rate goes up' },
      { label: 'Loans pricier', say: 'loans and mortgages cost more' },
      { label: 'Spending slows', say: 'people and companies spend less' },
      { label: 'Prices cool', say: 'price rises tend to slow down' }
    ],
    why: 'Each link takes time and can surprise, which is why expectations matter so much.',
    stamp: 'Effects arrive with a delay' } },
  { id: 'data_pipeline', title: 'Clean data first', patterns: [[/data engineering/, 8], [/pipeline/, 6], [/timestamp/, 5], [/vendor/, 3]], params: {
    actor: 'Omar', goal: 'build a clean record of market data', headline: 'Clean data before clever models',
    steps: [
      { label: 'Collect', say: 'collect the raw numbers' },
      { label: 'Add times', say: 'stamp when each number became known' },
      { label: 'Check', say: 'check for gaps and errors' },
      { label: 'Store', say: 'store every version without overwriting' }
    ],
    why: 'A model can only be as honest as the data it learns from.',
    stamp: 'Know when you knew it' } },
  { id: 'strategy_design', title: 'From idea to testable rules', patterns: [[/strategy design|signal design|system design/, 7], [/specification/, 5], [/\brules?\b/, 2]], params: {
    actor: 'Zoe', goal: 'turn a trading idea into something testable', headline: 'From idea to rules',
    steps: [
      { label: 'Idea', say: 'write the idea in one sentence' },
      { label: 'Rules', say: 'turn it into exact rules' },
      { label: 'Test', say: 'test it on data it has never seen' },
      { label: 'Monitor', say: 'watch it closely once it runs' }
    ],
    why: 'Exact rules can be tested and fixed, while a vague idea can only be argued about.',
    stamp: 'Rules you can test' } },
  { id: 'supply_demand', title: 'A chain reaction in prices', patterns: [[/\bsupply\b/, 4], [/\bdemand\b/, 3], [/equilibrium/, 7], [/elasticit/, 4], [/shortage|surplus/, 4]], params: {
    actor: 'Maya', goal: 'follow what a bad harvest does to the price of lemons', headline: 'Less supply, higher price',
    steps: [
      { label: 'Frost hits', say: 'a frost ruins part of the lemon harvest' },
      { label: 'Less supply', say: 'fewer lemons reach the market' },
      { label: 'Price rises', say: 'buyers compete and the price climbs' },
      { label: 'Buyers adjust', say: 'some buyers switch to limes until a new balance appears' }
    ],
    why: 'The price settles where the buyers who still want lemons meet the sellers who still have them.',
    stamp: 'Price balances the market' } },
  { id: 'forward_contract', title: 'Lock a price, settle later', patterns: [[/\bfutures?\b/, 5], [/\bforwards?\b(?! test)/, 4], [/\bswaps?\b/, 6], [/\bbasis\b/, 4], [/counterpart/, 5]], params: {
    actor: 'Omar', goal: 'lock in a price today for coffee beans he needs in three months', headline: 'Lock the price now, settle later',
    steps: [
      { label: 'Agree price', say: 'agree on a price with a partner today' },
      { label: 'Wait', say: 'wait for the delivery date' },
      { label: 'Settle', say: 'pay the agreed price, whatever the market did' },
      { label: 'Compare', say: 'compare it with the market price on that day' }
    ],
    why: 'Locking a price removes surprises, but it also gives up lucky moves, and the partner still has to pay up.',
    stamp: 'Certainty has a cost' } }
]);

/* Scoring: each pattern adds points x (3 per title hit + 2 per description hit
 * + 1 per step or question hit). Specific families carry bigger points. */
const NUMERIC_RULES = Object.freeze([
  { builder: 'optionPut', patterns: [[/\bput options?\b/, 7], [/\bputs\b/, 4], [/-strike put\b/, 9], [/\bprotective puts?\b/, 6], [/\bcash-secured puts?\b/, 6], [/\bput (?:buyer|seller|option|contract|premium)s?\b/, 6]] },
  { builder: 'optionCall', patterns: [[/\bcall options?\b/, 7], [/\bcovered calls?\b/, 5], [/-strike call\b/, 9], [/\bcall (?:buyer|seller|option|contract)s?\b/, 6], [/\boptions\b(?! lab)/, 2], [/\bgreeks?\b/, 4], [/\b(?:delta|gamma|theta|vega)\b/, 3], [/\bstrikes?\b/, 2], [/implied volatility/, 2], [/\bstraddles?\b|\bstrangles?\b/, 3], [/put-call parity/, 5], [/hedg/, 2]] },
  { builder: 'positionSize', patterns: [[/position siz/, 9], [/\bsizing\b/, 6], [/\bsize\b/, 2], [/invalidation/, 5], [/\bstop(?:-loss)?s?\b/, 2], [/risk budget|loss budget/, 6], [/risk per (?:trade|share)/, 6], [/max(?:imum)? (?:dollar )?loss/, 4], [/trade box/, 6], [/gap (?:risk|exposure)|\bhalts?\b/, 3]] },
  { builder: 'bidAsk', patterns: [[/\bbid\b/, 3], [/\bask\b/, 2], [/bid-ask|bid\/ask/, 7], [/\bspreads?\b/, 3], [/order book|top-of-book/, 3], [/market makers?/, 3], [/best bid|\bnbbo\b/, 5], [/price discovery/, 5], [/\bquotes?\b/, 2], [/adverse selection/, 5], [/\bliquidity\b/, 1], [/\bauctions?\b/, 2], [/\bqueue|order priority/, 3]] },
  { builder: 'bondYield', patterns: [[/\bbonds?\b/, 6], [/\byields?\b/, 3], [/\bcoupons?\b/, 5], [/fixed income/, 6], [/treasur/, 3], [/\bcredit\b/, 2], [/\bdefault\b/, 2], [/\bduration\b/, 3], [/convexity/, 3], [/\bmaturity\b/, 3], [/yield to maturity/, 6]] },
  { builder: 'presentValue', patterns: [[/present value/, 9], [/time value/, 7], [/\bdiscount(?:ed|ing)?\b/, 3], [/discount rate/, 5], [/\bdcf\b/, 5], [/\bnpv\b/, 6], [/annuit/, 5], [/perpetuit/, 5], [/capital budgeting/, 6], [/cost of capital|\bwacc\b/, 4], [/residual income|economic profit/, 3], [/\bvaluation\b/, 2]] },
  { builder: 'compound', patterns: [[/compound/, 9], [/\bgrowth\b/, 2], [/\breturns?\b/, 2], [/logarithm|\blog returns?\b/, 4], [/\bcagr\b/, 6], [/geometric/, 4]] },
  { builder: 'drawdownRecovery', patterns: [[/drawdowns?/, 9], [/\brecover(?:y|ies)?\b/, 4], [/diversif/, 3], [/portfolio risk/, 3], [/\bruin\b/, 4]] },
  /* percentChange tells a share-price story, so macro words (GDP, inflation,
   * jobs, currencies) no longer pull it in: those lessons get the neutral
   * fallback rather than an off-topic stock example. */
  { builder: 'percentChange', patterns: [[/percent(?:age)? change/, 6], [/rebalanc/, 3]] },
  { builder: 'ratio', patterns: [[/\bratios?\b/, 4], [/\bmargins?\b/, 3], [/\bmultiples?\b/, 4], [/\bp\/e\b|price-to-earnings|price to earnings/, 5], [/\bleverage\b/, 2], [/financial statements?/, 3], [/\baccounting\b/, 2], [/working capital/, 3], [/\binventory\b/, 2], [/\bdilution\b/, 3], [/buybacks?/, 3], [/\bbeta\b/, 3], [/\bcapm\b/, 4], [/earnings quality/, 3], [/revenue recognition/, 3]] },
  { builder: 'expectedValue', patterns: [[/expected value/, 9], [/expectancy/, 9], [/probabilit/, 4], [/\bbayes(?:ian)?\b/, 4], [/base rates?/, 4], [/\bodds\b/, 3], [/\bdistributions?\b/, 2], [/\bedge\b/, 2], [/calibrat/, 3], [/hypothesis/, 2], [/\bsampl/, 2], [/confidence interval/, 3], [/significance/, 2], [/tail risk|fat tails?/, 3], [/volatility trading|event risk/, 3]] },
  { builder: 'candle', patterns: [[/candle/, 8], [/\bohlcv?\b/, 8], [/\bwicks?\b/, 5], [/open, high, low|high, low, close/, 5]] },
  { builder: 'scenarioTree', patterns: [[/scenarios?/, 5], [/real options?/, 9], [/capstone/, 3], [/pre-market|premarket/, 3], [/\bthesis\b/, 2], [/bear, base|bull, base|bear case|bull case/, 5], [/decision trees?|scenario trees?/, 5], [/flexibilit/, 3]] }
]);

const MIN_SCORE = 4;
/* A specific example is only used when the lesson TITLE names its topic
 * strongly enough (points x 3 per title hit). A word that only shows up in
 * the description (which starts with the broad module name, such as "Fixed
 * Income and Credit:"), a step or the question is not enough; those lessons
 * get the neutral fallback instead of an off-topic example. */
const MIN_TOPIC_SCORE = 10;

function scorePatterns(patterns, texts) {
  let score = 0;
  let topic = 0;
  for (const [pattern, points] of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    const count = (text) => (text.match(global) || []).length;
    score += points * (3 * count(texts.title) + 2 * count(texts.description) + count(texts.steps) + count(texts.prompt));
    topic += points * 3 * count(texts.title);
  }
  return { score, topic };
}

function classifyLesson(lesson) {
  const raw = lessonTexts(lesson);
  const texts = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.toLowerCase()]));
  const scored = (entry, patterns) => ({ ...entry, ...scorePatterns(patterns, texts) });
  const candidates = [
    ...NUMERIC_RULES.map((rule, order) => scored({ builder: rule.builder, template: null, order }, rule.patterns)),
    ...TWO_CHOICE_TEMPLATES.map((template, order) => scored({ builder: 'twoChoices', template, order: 100 + order }, template.patterns)),
    ...PROCESS_TEMPLATES.map((template, order) => scored({ builder: 'process', template, order: 200 + order }, template.patterns))
  ];
  return candidates
    .filter((candidate) => candidate.score >= MIN_SCORE && candidate.topic >= MIN_TOPIC_SCORE)
    .sort((left, right) => right.score - left.score || left.order - right.order);
}

function moneyIn(pattern, text) {
  const match = pattern.exec(text);
  if (!match) return undefined;
  const value = Number(String(match[1]).replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function moneyAll(pattern, text) {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(global)].map((match) => Number(String(match[1]).replace(/,/g, ''))).filter((value) => Number.isFinite(value));
}

const MONEY = '\\$(\\d[\\d,]*(?:\\.\\d+)?)';

/* Numbers only come from the lesson's own steps/description (never from the
 * knowledge-check prompt) and only when a clear pattern exists. */
function extractParams(builder, lesson) {
  const texts = lessonTexts(lesson);
  const text = `${texts.description} \n ${texts.steps}`;
  const endings = moneyAll(new RegExp(`(?:finishes|ends|expires|closes) at ${MONEY}`, 'i'), text);
  if (builder === 'optionPut' || builder === 'optionCall') {
    const kind = builder === 'optionPut' ? 'put' : 'call';
    const strike = moneyIn(new RegExp(`${MONEY}[- ]strike ${kind}`, 'i'), text);
    if (strike === undefined) return null;
    const premium = moneyIn(new RegExp(`${kind}s? costs? ${MONEY}`, 'i'), text) ?? moneyIn(new RegExp(`premium (?:of |is )?${MONEY}`, 'i'), text);
    const stock = moneyIn(new RegExp(`stock (?:is|trades at|is at|at) ${MONEY}`, 'i'), text);
    const params = { strike };
    if (premium !== undefined) params.premium = premium;
    if (stock !== undefined) params.stock = stock;
    const unit = premium !== undefined ? premium : Math.max(1, Math.round(strike * 0.04));
    if (builder === 'optionPut') {
      const below = endings.filter((value) => value < strike);
      const above = endings.filter((value) => value >= strike);
      params.low = below.length ? Math.min(...below) : Math.max(0, strike - unit * 2.5);
      params.high = above.length ? Math.max(...above) : (stock !== undefined && stock > strike ? stock + (stock - strike) : strike + unit * 5);
      if (params.stock === undefined) params.stock = strike + unit * 2.5;
    } else {
      const above = endings.filter((value) => value > strike);
      const below = endings.filter((value) => value <= strike);
      params.high = above.length ? Math.max(...above) : strike + unit * 2.5;
      params.low = below.length ? Math.min(...below) : Math.max(0, strike - unit * 5);
      if (params.stock === undefined) params.stock = Math.max(unit, strike - unit * 2.5);
    }
    return params;
  }
  if (builder === 'positionSize') {
    const account = moneyIn(new RegExp(`${MONEY} (?:practice |trading |cash )?account`, 'i'), text) ?? moneyIn(new RegExp(`account (?:of |is )?${MONEY}`, 'i'), text);
    const riskPercent = (() => {
      const match = /risk(?:s|ing)? (?:only |at most |up to )?(\d+(?:\.\d+)?)%/i.exec(text);
      return match ? Number(match[1]) / 100 : undefined;
    })();
    const entry = moneyIn(new RegExp(`(?:buys?|enters?|entry)(?: at| is)? ${MONEY}`, 'i'), text);
    const stop = moneyIn(new RegExp(`(?:stop|invalidation|wrong)(?: is| at)? ${MONEY}`, 'i'), text);
    if (account === undefined || entry === undefined || stop === undefined) return null;
    return { account, entry, stop, ...(riskPercent !== undefined ? { riskPct: riskPercent } : {}) };
  }
  if (builder === 'bidAsk') {
    const bid = moneyIn(new RegExp(`bid (?:is |of |at )?${MONEY}`, 'i'), text);
    const ask = moneyIn(new RegExp(`(?:ask|offer) (?:is |of |at )?${MONEY}`, 'i'), text);
    return bid !== undefined && ask !== undefined ? { bid, ask } : null;
  }
  if (builder === 'percentChange') {
    const match = /from \$(\d[\d,]*(?:\.\d+)?) to \$(\d[\d,]*(?:\.\d+)?)/i.exec(text);
    return match ? { before: Number(match[1].replace(/,/g, '')), after: Number(match[2].replace(/,/g, '')) } : null;
  }
  return null;
}

const VARIANTS = Object.freeze({
  optionPut: [{}, { stock: 30, strike: 28, premium: 1.5, low: 24, high: 33 }, { stock: 80, strike: 75, premium: 3, low: 68, high: 86 }],
  optionCall: [{}, { stock: 20, strike: 22, premium: 1, high: 26, low: 18 }, { stock: 100, strike: 105, premium: 4, high: 115, low: 95 }],
  positionSize: [{}, { account: 5000, riskPct: 0.005, entry: 25, stop: 24 }, { account: 10000, riskPct: 0.01, entry: 40, stop: 38 }],
  percentChange: [{}, { before: 80, after: 60, thing: 'Maple Mill shares' }, { before: 200, after: 230, thing: 'Orbit Oats shares' }],
  compound: [{}, { start: 1000, rate: 0.07, years: 3 }, { start: 100, returns: [0.1, -0.1] }],
  presentValue: [{}, { amount: 121, rate: 0.1, years: 2, compareRate: 0.05 }, { amount: 500, rate: 0.05, years: 1, compareRate: 0.1 }],
  bidAsk: [{}, { bid: 20, ask: 20.1, shares: 500 }, { bid: 4.95, ask: 5.05, shares: 1000 }],
  expectedValue: [{}, { outcomes: [{ label: 'Win', p: 0.3, value: 100 }, { label: 'Loss', p: 0.7, value: -30 }] },
    { outcomes: [{ label: 'Big win', p: 0.2, value: 50 }, { label: 'Small win', p: 0.3, value: 10 }, { label: 'Loss', p: 0.5, value: -20 }] }],
  ratio: [{}, { company: 'Rise Up Games', top: 100, bottom: 4, topLabel: 'price', bottomLabel: 'yearly earnings', as: 'num', compare: { company: 'Crumb Bakery', top: 50, bottom: 5 },
    insight: 'A higher multiple means buyers expect more growth, which can disappoint.' },
  { company: 'Orbit Oats', top: 300, bottom: 100, topLabel: 'debt', bottomLabel: 'yearly profit', as: 'x', compare: null,
    insight: 'The bigger this number, the less room there is for a bad year.' }],
  drawdownRecovery: [{}, { start: 5000, drop: 0.5 }, { start: 2000, drop: 0.2 }],
  bondYield: [{}, { face: 1000, coupon: 40, yield: 0.05, newYield: 0.07 }, { face: 100, coupon: 3, price: 97, yield: null, newYield: null }],
  candle: [{}, { open: 20, high: 20.5, low: 18, close: 18.5, period: 'one week' }, { open: 5, high: 5.8, low: 4.9, close: 5.6 }],
  scenarioTree: [{}, { price: 20, branches: [{ label: 'Down', p: 0.3, value: 15 }, { label: 'Flat', p: 0.5, value: 20 }, { label: 'Up', p: 0.2, value: 30 }] },
    { price: 50, branches: [{ label: 'Miss', p: 0.4, value: 40 }, { label: 'Beat', p: 0.6, value: 60 }] }]
});

function namesFor(key) {
  const seed = hashText(key);
  const first = PEOPLE[seed % PEOPLE.length];
  const second = PEOPLE[(seed + 5) % PEOPLE.length];
  const company = COMPANIES[(seed >>> 3) % COMPANIES.length];
  const company2 = COMPANIES[((seed >>> 3) + 3) % COMPANIES.length];
  return { first, second, company, company2, variant: (seed >>> 7) % 3 };
}

function peopleParams(builder, names) {
  switch (builder) {
    case 'optionPut':
    case 'optionCall':
      return { buyer: names.first, seller: names.second, company: names.company };
    case 'bidAsk':
      return { buyer: names.first, seller: names.second, company: names.company };
    case 'positionSize':
      return { trader: names.first };
    case 'percentChange':
      return { holder: names.first };
    case 'compound':
      return { saver: names.first };
    case 'presentValue':
      return { receiver: names.first };
    case 'expectedValue':
      return { person: names.first };
    case 'ratio':
      return { company: names.company, compare: { company: names.company2, top: 40, bottom: 500 } };
    case 'drawdownRecovery':
      return { holder: names.first };
    case 'bondYield':
      return { buyer: names.first };
    case 'scenarioTree':
      return { planner: names.first, company: names.company };
    case 'candle':
      return { company: names.company };
    default:
      return {};
  }
}

function candidateParams(candidate, lesson, key) {
  const names = namesFor(key);
  if (candidate.builder === 'twoChoices' || candidate.builder === 'process') {
    return [{ ...candidate.template.params, family: candidate.template.id, title: candidate.template.title }];
  }
  const people = peopleParams(candidate.builder, names);
  const variants = VARIANTS[candidate.builder] || [{}];
  const variant = variants[names.variant % variants.length];
  const withVariant = { ...people, ...variant, ...(variant.compare !== undefined ? { compare: variant.compare } : {}) };
  const list = [];
  const extracted = extractParams(candidate.builder, lesson);
  if (extracted) list.push({ ...people, ...extracted });
  list.push(withVariant, people, {});
  return list;
}

function fallbackExample(key) {
  return runBuilder('twoChoices', { ...GENERIC_CHOICE }, { id: key, family: 'decision_compare', source: 'auto' });
}

/* autoExample(lesson) -> valid example with source 'auto' (null only if even the fallback fails). Never throws. */
function autoExample(lesson) {
  let key = '0.0';
  try {
    key = lessonKey(lesson);
    for (const candidate of classifyLesson(lesson).slice(0, 4)) {
      for (const params of candidateParams(candidate, lesson, key)) {
        try {
          return runBuilder(candidate.builder, params, {
            id: key,
            family: candidate.template ? candidate.template.id : BUILDER_FAMILY[candidate.builder],
            source: 'auto'
          });
        } catch (_) {
          /* try the next parameter set */
        }
      }
    }
  } catch (_) {
    /* fall through to the generic example */
  }
  try {
    return fallbackExample(key);
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Authored data access, strict checks and attachment                   */
/* ------------------------------------------------------------------ */

function authoredData() {
  try {
    return require('./examples-data');
  } catch (error) {
    return { AUTHORED: new Map(), RECORDS: [], DUPLICATES: [], LOAD_ERRORS: [{ module: './examples-data', message: error.message }] };
  }
}

/* Strict validator for tests: throws listing every load error, duplicate,
 * invalid authored example and (when lessons are given) unknown lesson id. */
function assertAuthoredExamples({ data = authoredData(), lessons = null } = {}) {
  const problems = [];
  for (const failure of data.LOAD_ERRORS || []) problems.push(`cannot load ${failure.module}: ${failure.message}`);
  for (const id of data.DUPLICATES || []) problems.push(`${id}: authored more than once (reference.js wins)`);
  for (const record of data.RECORDS || []) {
    if (!isAuthoredRecord(record)) problems.push(`${record && record.id}: not made with E() or B()`);
    else if (!record.example || record.errors.length) problems.push(`${record.id}: ${record.errors.join('; ')}`);
    else if (record.example.id !== record.id) problems.push(`${record.id}: example id ${record.example.id} does not match`);
  }
  if (Array.isArray(lessons)) {
    const keys = new Set(lessons.map(lessonKey));
    for (const id of data.AUTHORED ? data.AUTHORED.keys() : []) if (!keys.has(id)) problems.push(`${id}: no lesson with this id`);
  }
  if (problems.length) throw new Error(`Invalid authored Academy examples:\n- ${problems.join('\n- ')}`);
  return data.AUTHORED ? data.AUTHORED.size : 0;
}

/* attachWorkedExamples(lessons, { authored? }) -> new lesson objects with
 *   example (authored when valid, else autoExample), exampleIndex, parts, narrationVersion.
 * A lesson without a title gets example null (lesson-parts only places an
 * example after the title slot, so it would never be shown or spoken).
 * Deterministic, synchronous, silent; never mutates the input lessons. */
function attachWorkedExamples(lessons, options = {}) {
  const authored = options && options.authored instanceof Map ? options.authored : authoredData().AUTHORED;
  return (Array.isArray(lessons) ? lessons : []).map((lesson) => {
    if (!lesson || typeof lesson !== 'object') return lesson;
    const key = lessonKey(lesson);
    const titled = Boolean(lesson.title);
    const record = titled && authored && typeof authored.get === 'function' ? authored.get(key) : null;
    let example = record && record.example && record.example.id === key && isValidExample(record.example) ? record.example : null;
    if (!example && titled) example = autoExample(lesson);
    const next = { ...lesson, example: example || null };
    const info = lessonPartsInfo(next);
    next.exampleIndex = info.exampleIndex;
    next.parts = Object.freeze(info.parts.slice());
    next.narrationVersion = partsVersion(info.parts);
    return next;
  });
}

module.exports = {
  DEFAULT_TITLE,
  ICONS,
  TONES,
  ITEM_KINDS,
  LIMITS,
  FORMATS,
  BUILDER_FAMILY,
  BUILDER_DEFAULTS,
  TWO_CHOICE_TEMPLATES,
  PROCESS_TEMPLATES,
  PEOPLE,
  evaluate,
  roundTo,
  formatValue,
  validateExample,
  isValidExample,
  assertValidExample,
  buildExample,
  builders,
  E,
  B,
  isAuthoredRecord,
  lessonKey,
  classifyLesson,
  autoExample,
  assertAuthoredExamples,
  attachWorkedExamples
};
