'use strict';

/* Real knowledge checks for the expansion modules (14-28).
 *
 * Those 75 lessons were generated from one template: the prompt was always
 * "Which statement is most defensible?", the answer was always option A, and
 * the same three wrong options appeared in every lesson. A learner could pass
 * every check without reading anything, so the check taught nothing.
 *
 * A quiz here is plain data, keyed "moduleId.lessonId". It must be answerable
 * from the lesson itself (its principle and its whiteboard example), so the
 * wrong options are the mistakes a beginner actually makes, not filler. The
 * validator below is enforced by tests, not at runtime: a lesson with no valid
 * custom quiz keeps the old generated one rather than breaking the curriculum.
 *
 * It also blocks the two mechanical tells that replaced "the answer is always
 * A": an option that opens with its own letter, and an answer whose length puts
 * it far outside the wrong options.
 */

const DATA = require('./quizzes-data');

const LETTERS = ['A', 'B', 'C', 'D'];
const LEGACY_PROMPT = 'Which statement is most defensible?';
/* answerLengthGap: how far the answer may stand out from the wrong options by
 * length. A key that is much the longest (it carries the only hedge) or much the
 * shortest (it is the only bare figure while every distractor explains itself)
 * can be picked by a test-taker who never read the lesson, which is the same
 * free pass the old always-A template gave. */
const LIMITS = { prompt: [12, 200], option: [1, 90], explanation: [20, 260], answerLengthGap: 8 };

function quizKey(moduleId, lessonId) {
  return `${Number(moduleId)}.${Number(lessonId)}`;
}

function validateQuiz(quiz, key = '') {
  const label = key ? `${key}: ` : '';
  const errors = [];
  if (!quiz || typeof quiz !== 'object') return [`${label}quiz must be an object`];
  const { prompt, options, correct, explanation } = quiz;
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const within = (value, [min, max]) => value.length >= min && value.length <= max;

  const promptText = text(prompt);
  if (!within(promptText, LIMITS.prompt)) errors.push(`${label}prompt must be ${LIMITS.prompt[0]}-${LIMITS.prompt[1]} characters`);
  if (promptText === LEGACY_PROMPT) errors.push(`${label}prompt is still the generated placeholder`);
  if (promptText && !/[?]$/.test(promptText)) errors.push(`${label}prompt must end with a question mark`);

  const lengths = {};
  if (!options || typeof options !== 'object') {
    errors.push(`${label}options must be an object with A, B, C and D`);
  } else {
    const keys = Object.keys(options);
    if (keys.length !== 4 || LETTERS.some((letter) => !keys.includes(letter))) {
      errors.push(`${label}options must be exactly A, B, C and D`);
    }
    const seen = new Set();
    for (const letter of LETTERS) {
      const value = text(options[letter]);
      lengths[letter] = value.length;
      if (!within(value, LIMITS.option)) {
        errors.push(`${label}option ${letter} must be ${LIMITS.option[0]}-${LIMITS.option[1]} characters`);
        continue;
      }
      if (/^[A-D][).:]/.test(value)) errors.push(`${label}option ${letter} must not repeat its own letter`);
      /* "Busy streets drive both..." under B is a free hint to anyone scanning
       * for the option that starts with its own letter. */
      const first = value.charAt(0);
      if (/[A-Za-z]/.test(first) && first.toUpperCase() === letter) {
        errors.push(`${label}option ${letter} must not start with the letter ${letter}`);
      }
      const normal = value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(normal)) errors.push(`${label}option ${letter} repeats another option`);
      seen.add(normal);
    }
  }

  if (!LETTERS.includes(correct)) errors.push(`${label}correct must be A, B, C or D`);
  else if (!text(options && options[correct])) errors.push(`${label}correct points at an empty option`);
  else {
    const others = LETTERS.filter((letter) => letter !== correct).map((letter) => lengths[letter] || 0);
    const answer = lengths[correct];
    const gap = LIMITS.answerLengthGap;
    const over = answer - Math.max(...others);
    const under = Math.min(...others) - answer;
    if (over > gap) errors.push(`${label}the answer is ${over} characters longer than every wrong option; level the lengths`);
    if (under > gap) errors.push(`${label}the answer is ${under} characters shorter than every wrong option; level the lengths`);
  }

  const explanationText = text(explanation);
  if (!within(explanationText, LIMITS.explanation)) errors.push(`${label}explanation must be ${LIMITS.explanation[0]}-${LIMITS.explanation[1]} characters`);

  return errors;
}

function isValidQuiz(quiz) {
  return validateQuiz(quiz).length === 0;
}

/** The custom quiz for a lesson, or null when there is none (the caller keeps its own). */
function quizFor(moduleId, lessonId) {
  const quiz = DATA[quizKey(moduleId, lessonId)];
  if (!quiz || !isValidQuiz(quiz)) return null;
  return {
    prompt: quiz.prompt.trim(),
    options: { A: quiz.options.A.trim(), B: quiz.options.B.trim(), C: quiz.options.C.trim(), D: quiz.options.D.trim() },
    correct: quiz.correct,
    explanation: quiz.explanation.trim(),
  };
}

/** Strict check used by tests: every authored quiz is valid and keyed to a real lesson. */
function assertQuizzes(lessons) {
  const errors = [];
  for (const [key, quiz] of Object.entries(DATA)) {
    errors.push(...validateQuiz(quiz, key));
    if (lessons && !lessons.some((lesson) => quizKey(lesson.moduleId, lesson.lessonId) === key)) {
      errors.push(`${key}: no lesson with that id`);
    }
  }
  if (errors.length) throw new Error(`Invalid knowledge checks:\n- ${errors.join('\n- ')}`);
  return Object.keys(DATA).length;
}

module.exports = { quizFor, quizKey, validateQuiz, isValidQuiz, assertQuizzes, LETTERS, LEGACY_PROMPT, LIMITS, DATA };
