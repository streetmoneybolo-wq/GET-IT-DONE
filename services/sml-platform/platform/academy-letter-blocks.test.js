'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToBlocks, spansOf, plainText } = require('./academy-letter-blocks');

test('the story draft html becomes reader blocks: cover image first, headings, spans with marks, lists, disclosure last', () => {
  const html = '<p><strong>Hook &amp; line.</strong></p>\n<p>$ABCD is trading at $12.40 (+6.2% on the day) on 2.8x volume. See <em>this</em>.</p>\n'
    + '<h2>What the data says</h2><ul><li>Fact one.</li><li>Fact &quot;two&quot;.</li></ul>'
    + '<h2>The path to $13.00 (+4.8%)</h2><ol><li><strong>Trigger:</strong> hold $12.</li><li><strong>Target:</strong> $13.</li></ol><p>The GIF above animates that path.</p>'
    + '<p class="disclosure"><small>Data as of Oct 15. Not advice.</small></p>';
  const blocks = htmlToBlocks(html, { tickers: ['ABCD'], cover: { url: 'https://x/y.gif', alt: 'path', caption: 'Speculative.' }, disclosure: { position: 'educational scenario, not a trade recommendation' } });
  assert.equal(blocks[0].type, 'image'); assert.equal(blocks[0].url, 'https://x/y.gif');
  assert.equal(blocks[1].type, 'paragraph'); assert.deepEqual(blocks[1].spans, [{ text: 'Hook & line.', mark: 'bold' }]);
  const p2 = blocks[2]; assert.equal(p2.type, 'paragraph');
  assert.deepEqual(p2.spans[0], { text: '$ABCD', mark: 'ticker', symbol: 'ABCD' });
  assert.ok(p2.spans.some((s) => s.mark === 'italic' && s.text === 'this'));
  assert.equal(p2.spans.map((s) => s.text).join(''), '$ABCD is trading at $12.40 (+6.2% on the day) on 2.8x volume. See this.');
  const h = blocks.find((b) => b.type === 'heading'); assert.equal(h.level, 2); assert.equal(h.text, 'What the data says');
  const ul = blocks.find((b) => b.type === 'list' && b.style === 'bullet'); assert.deepEqual(ul.items, ['Fact one.', 'Fact "two".']);
  const ol = blocks.find((b) => b.type === 'list' && b.style === 'number'); assert.deepEqual(ol.items, ['Trigger: hold $12.', 'Target: $13.']);
  const last = blocks[blocks.length - 1]; assert.equal(last.type, 'disclosure'); assert.match(last.position, /educational/);
  const small = blocks[blocks.length - 2]; assert.equal(small.type, 'paragraph'); assert.equal(small.spans[0].text, 'Data as of Oct 15. Not advice.');
  assert.ok(new Set(blocks.map((b) => b.id)).size === blocks.length, 'ids are unique');
  assert.match(plainText(blocks), /Fact one/);
});

test('a $ amount is not a ticker and a figure already used as the cover is not repeated', () => {
  const spans = spansOf('Price $12.40 and $SPY moved', { tickers: ['SPY'] });
  assert.ok(!spans.some((s) => s.mark === 'ticker' && s.symbol !== 'SPY'));
  const blocks = htmlToBlocks('<figure class="sml-story-gif"><img src="https://x/y.gif" alt="a"></figure><p>t</p>', { cover: { url: 'https://x/y.gif' } });
  assert.equal(blocks.filter((b) => b.type === 'image').length, 1);
  assert.equal(htmlToBlocks('').length, 0);
});
