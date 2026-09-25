'use strict';

/* Guards for the authored knowledge checks of the expansion modules (14-28).
 *
 * Those 75 lessons used to share ONE generated check: the prompt was always
 * "Which statement is most defensible?", the three wrong options were the same
 * everywhere and the answer was always A, so a learner could pass every check
 * without reading a word. These tests keep that from coming back: every lesson
 * must carry its own check, the answer letter must move around, and the check
 * must not be answerable by matching a phrase from the lesson it follows.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const quizzes = require('./quizzes');
const { SEED_LESSONS } = require('./curriculum');
const TOTAL_LESSONS = 121 + require('./street-smarts').STREET_LESSONS.length; // the original 29 modules plus the Street Smarts track

const {
  quizFor, quizKey, validateQuiz, isValidQuiz, assertQuizzes, LETTERS, LEGACY_PROMPT, LIMITS, DATA
} = quizzes;

/* The generated check expansion.js falls back to when a lesson has no authored
 * quiz. Its three wrong options were identical in all 75 lessons. */
const LEGACY_OPTIONS = [
  'One observation proves the conclusion in every market regime.',
  'Uncertainty and implementation costs can be ignored.',
  'The model guarantees the future outcome.'
];
const LEGACY_EXPLANATION_TAIL = 'The result remains conditional on data quality, assumptions, and context.';

const key = (lesson) => quizKey(lesson.moduleId, lesson.lessonId);
const byLesson = (a, b) => a.moduleId - b.moduleId || a.lessonId - b.lessonId;
const EXPANSION = SEED_LESSONS.filter((lesson) => lesson.moduleId >= 14 && lesson.moduleId <= 28).sort(byLesson);

test('every expansion lesson exists and carries an authored knowledge check', () => {
  assert.equal(SEED_LESSONS.length, TOTAL_LESSONS);
  assert.equal(EXPANSION.length, 75);
  assert.equal(new Set(EXPANSION.map(key)).size, 75);
  for (const lesson of EXPANSION) {
    const authored = quizFor(lesson.moduleId, lesson.lessonId);
    assert.ok(authored, `${key(lesson)}: no authored knowledge check`);
    assert.deepEqual(lesson.question, authored, `${key(lesson)}: lesson does not use its authored check`);
  }
});

test('assertQuizzes accepts the authored data against the real curriculum', () => {
  // 75 expansion checks plus the 20 Start Here checks.
  assert.equal(assertQuizzes(SEED_LESSONS), 95);
  assert.equal(Object.keys(DATA).length, 95);
  assert.throws(() => assertQuizzes([]), /no lesson with that id/);
});

test('no expansion lesson still uses the generated check', () => {
  for (const lesson of EXPANSION) {
    const { prompt, options, correct, explanation } = lesson.question;
    assert.notEqual(prompt, LEGACY_PROMPT, `${key(lesson)}: still uses the generated prompt`);
    for (const letter of LETTERS) {
      assert.ok(
        !LEGACY_OPTIONS.includes(options[letter].trim()),
        `${key(lesson)}: option ${letter} is still a generated wrong option`
      );
    }
    assert.ok(
      !explanation.includes(LEGACY_EXPLANATION_TAIL),
      `${key(lesson)}: still uses the generated explanation`
    );
    // The generated check always answered A with the lesson's own closing line.
    assert.ok(
      !(correct === 'A' && lesson.steps.some((step) => step.includes(options.A))),
      `${key(lesson)}: answer A repeats a lesson step, like the generated check did`
    );
  }
});

test('every check has four distinct options, a real answer and a question prompt', () => {
  for (const lesson of EXPANSION) {
    const label = key(lesson);
    const { prompt, options, correct, explanation } = lesson.question;

    assert.deepEqual(validateQuiz(lesson.question, label), [], `${label}: validator complained`);
    assert.deepEqual(Object.keys(options).sort(), ['A', 'B', 'C', 'D'], `${label}: options must be A-D`);

    const normal = LETTERS.map((letter) => options[letter].toLowerCase().replace(/[^a-z0-9]/g, ''));
    assert.equal(new Set(normal).size, 4, `${label}: two options say the same thing`);
    for (const [index, letter] of LETTERS.entries()) {
      assert.ok(normal[index].length > 0, `${label}: option ${letter} is empty`);
      assert.ok(!/^[A-D][).:]/.test(options[letter]), `${label}: option ${letter} repeats its own letter`);
      assert.ok(options[letter].length <= LIMITS.option[1], `${label}: option ${letter} is too long`);
    }

    assert.ok(LETTERS.includes(correct), `${label}: correct must be A, B, C or D`);
    assert.ok(options[correct].trim(), `${label}: correct points at an empty option`);

    assert.ok(prompt.endsWith('?'), `${label}: prompt must end with a question mark`);
    assert.ok(
      prompt.length >= LIMITS.prompt[0] && prompt.length <= LIMITS.prompt[1],
      `${label}: prompt is ${prompt.length} characters, outside ${LIMITS.prompt.join('-')}`
    );
    assert.ok(
      explanation.length >= LIMITS.explanation[0] && explanation.length <= LIMITS.explanation[1],
      `${label}: explanation is ${explanation.length} characters, outside ${LIMITS.explanation.join('-')}`
    );
    assert.ok(/[.!?]$/.test(explanation.trim()), `${label}: explanation must end in a full stop`);
  }
});

test('the answer letter is spread across A-D and never runs three lessons deep', () => {
  const sequence = EXPANSION.map((lesson) => lesson.question.correct);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const letter of sequence) counts[letter] += 1;
  for (const letter of LETTERS) {
    assert.ok(counts[letter] >= 10, `answer ${letter} is used only ${counts[letter]} times across the 75 lessons`);
  }
  assert.equal(counts.A + counts.B + counts.C + counts.D, 75);

  let run = 1;
  for (let index = 1; index < sequence.length; index += 1) {
    run = sequence[index] === sequence[index - 1] ? run + 1 : 1;
    assert.ok(
      run <= 2,
      `${key(EXPANSION[index])}: ${run} lessons in a row answer ${sequence[index]} (${key(EXPANSION[index - run + 1])} onward)`
    );
  }
});

/* Anti phrase-matching guard. A learner must not be able to answer by spotting
 * the option that reuses the lesson's own words. Text is compared with case,
 * quotes and punctuation removed and thousands separators dropped, so "$1,500."
 * and "$1500" match; tokens are compared whole, so the answer "2%" does not
 * count as found inside a lesson's "12%". Two rules:
 *   1. the whole option may not appear as a run of words in the lesson text;
 *   2. no shared run of 6+ words, or of 4+ content words, either.
 * Lesson text is the three steps plus the whiteboard example's spoken lines -
 * everything the learner hears before the check. */
const PHRASE_STOP = new Set(('a an the and or but of to in on at for by with from is are was were be been being it its this'
  + ' that these those as not no nor than then so if when while can may might will would should do does did has have had'
  + ' there here into out up down about over under only just also very more most less least each every both all any some'
  + ' what which who whose how why you your they their he she his her we our us my one two three').split(' '));

function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/,(?=\d)/g, '')
    .replace(/[^a-z0-9$%.]+/g, ' ')
    .split(' ')
    .map((token) => token.replace(/\.+$/, ''))
    .filter(Boolean)
    .join(' ');
}

const isContentWord = (word) => word.length > 2 && !PHRASE_STOP.has(word) && !/^[0-9.$%]+$/.test(word);
const lessonText = (lesson) => [
  ...(lesson.steps || []),
  ...((lesson.example && Array.isArray(lesson.example.say) ? lesson.example.say : []))
].join(' ');

/* The longest run of the option's words that appears, in order and unbroken,
 * in the lesson text, with how many of those words carry meaning. */
function sharedRun(option, text) {
  const optionWords = normalise(option).split(' ').filter(Boolean);
  const haystack = ` ${normalise(text)} `;
  let best = { words: 0, content: 0, phrase: '' };
  for (let start = 0; start < optionWords.length; start += 1) {
    for (let end = start + 1; end <= optionWords.length; end += 1) {
      const phrase = optionWords.slice(start, end).join(' ');
      if (!haystack.includes(` ${phrase} `)) break;
      const content = optionWords.slice(start, end).filter(isContentWord).length;
      if (end - start > best.words || content > best.content) {
        best = { words: Math.max(best.words, end - start), content: Math.max(best.content, content), phrase };
      }
    }
  }
  return best;
}

test('no correct option is quoted back from its own lesson', () => {
  for (const lesson of EXPANSION) {
    const label = key(lesson);
    const answer = lesson.question.options[lesson.question.correct];
    const text = lessonText(lesson);
    assert.ok(text.trim(), `${label}: lesson has no steps or spoken example to compare against`);

    const haystack = ` ${normalise(text)} `;
    assert.ok(
      !haystack.includes(` ${normalise(answer)} `),
      `${label}: the answer "${answer}" is written out in the lesson text`
    );

    const run = sharedRun(answer, text);
    assert.ok(
      run.words < 6 && run.content < 4,
      `${label}: the answer "${answer}" borrows "${run.phrase}" from the lesson text`
    );
  }
});

test('the phrase guard itself catches a copied answer', () => {
  const lesson = EXPANSION.find((item) => quizKey(item.moduleId, item.lessonId) === '14.1');
  const copied = lesson.steps[0];
  const haystack = ` ${normalise(lessonText(lesson))} `;
  assert.ok(haystack.includes(` ${normalise(copied)} `));
  assert.ok(sharedRun(copied, lessonText(lesson)).content >= 4);
  // Word-whole comparison: "2%" is not hiding inside "12%".
  assert.ok(!` ${normalise('It rose 12% last year.')} `.includes(` ${normalise('2%')} `));
  assert.ok(` ${normalise('It rose 12% last year.')} `.includes(` ${normalise('12%.')} `));
  assert.ok(` ${normalise('It is worth $1,500 today')} `.includes(` ${normalise('$1500')} `));
});

/* --- validator negative cases --------------------------------------------- */

const validQuiz = () => ({
  prompt: 'A stall takes $200 one year and $288 two years later. What is the growth per year?',
  options: {
    A: '44%, the whole two-year gain',
    B: '22%, half of the two-year gain',
    C: '20%, because 1.2 times 1.2 is 1.44',
    D: '24%, the second year against the first start'
  },
  correct: 'C',
  explanation: 'Each year multiplies by 1.2, so 1.2 times 1.2 is 1.44 and the growth is 20% a year. Halving the 44% total ignores that year two grows on a bigger base.'
});

const errorsFor = (changes) => validateQuiz({ ...validQuiz(), ...changes }, 'x.y').join(' | ');

test('the validator accepts a well-formed quiz', () => {
  assert.deepEqual(validateQuiz(validQuiz()), []);
  assert.equal(isValidQuiz(validQuiz()), true);
});

test('the validator rejects bad shapes', () => {
  assert.match(validateQuiz(null).join(' '), /must be an object/);
  assert.match(validateQuiz('a quiz').join(' '), /must be an object/);
  assert.match(errorsFor({ prompt: 'Too short?' }), /prompt must be/);
  assert.match(errorsFor({ prompt: `${'x'.repeat(LIMITS.prompt[1])}?` }), /prompt must be/);
  assert.match(errorsFor({ prompt: LEGACY_PROMPT }), /generated placeholder/);
  assert.match(errorsFor({ prompt: 'This prompt forgot its question mark' }), /question mark/);

  assert.match(errorsFor({ options: null }), /options must be an object/);
  assert.match(errorsFor({ options: { A: 'one', B: 'two', C: 'three' } }), /exactly A, B, C and D/);
  assert.match(
    errorsFor({ options: { ...validQuiz().options, E: 'a fifth option nobody can pick' } }),
    /exactly A, B, C and D/
  );

  const duplicated = validQuiz().options;
  duplicated.B = duplicated.C;
  assert.match(errorsFor({ options: duplicated }), /option C repeats another option/);

  const selfLettered = validQuiz().options;
  selfLettered.D = 'D) 24%, the second year against the first start';
  assert.match(errorsFor({ options: selfLettered }), /must not repeat its own letter/);

  // "Busy streets drive both..." under B hands a scanner the answer for free.
  const selfStarted = validQuiz().options;
  selfStarted.B = 'Because the second year grows on a bigger base';
  assert.match(errorsFor({ options: selfStarted }), /option B must not start with the letter B/);
  const startsWithDigit = validQuiz().options;
  startsWithDigit.B = '22%, because half of the two-year gain is easy to reach for';
  assert.deepEqual(validateQuiz({ ...validQuiz(), options: startsWithDigit }), []);

  // A key that is much the longest (the only hedge) or much the shortest (the
  // only bare figure) is pickable without reading the question.
  const lopsided = validQuiz().options;
  lopsided.C = '20%, because 1.2 times 1.2 is 1.44 and that is the per-year step';
  assert.match(errorsFor({ options: lopsided }), /characters longer than every wrong option/);
  const stunted = validQuiz().options;
  stunted.C = '20%';
  assert.match(errorsFor({ options: stunted }), /characters shorter than every wrong option/);

  const blank = validQuiz().options;
  blank.C = '   ';
  assert.match(errorsFor({ options: blank }), /option C must be/);
  assert.match(errorsFor({ options: blank }), /empty option/);

  const tooLong = validQuiz().options;
  tooLong.A = 'x'.repeat(LIMITS.option[1] + 1);
  assert.match(errorsFor({ options: tooLong }), /option A must be/);

  assert.match(errorsFor({ correct: 'E' }), /correct must be A, B, C or D/);
  assert.match(errorsFor({ correct: null }), /correct must be A, B, C or D/);
  assert.match(errorsFor({ explanation: 'Too short.' }), /explanation must be/);
  assert.match(errorsFor({ explanation: 'x'.repeat(LIMITS.explanation[1] + 1) }), /explanation must be/);

  assert.equal(isValidQuiz({ ...validQuiz(), correct: 'E' }), false);
  const label = validateQuiz({ ...validQuiz(), correct: 'E' }, '99.9')[0];
  assert.ok(label.startsWith('99.9: '), `expected a keyed message, got "${label}"`);
});

test('quizFor returns a trimmed copy and nothing for lessons without one', () => {
  const quiz = quizFor(14, 1);
  assert.ok(quiz);
  assert.deepEqual(Object.keys(quiz).sort(), ['correct', 'explanation', 'options', 'prompt']);
  assert.notEqual(quiz, DATA['14.1'], 'quizFor must not hand out the stored object');
  assert.equal(quiz.prompt, quiz.prompt.trim());
  for (const letter of LETTERS) assert.equal(quiz.options[letter], quiz.options[letter].trim());

  assert.equal(quizFor(13, 1), null, 'modules 1-13 keep their own hand-written checks');
  assert.equal(quizFor(14, 99), null);
  assert.equal(quizFor(99, 1), null);
  assert.equal(quizKey('14', '2'), '14.2');
});
