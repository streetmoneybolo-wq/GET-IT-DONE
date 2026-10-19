'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RECRUITMENT_CHANNEL_ID, RECRUIT_BUTTON_ID, COPY_BUTTON_PREFIX, handleRecruitmentComponent } = require('./dsp-recruitment');
function interaction(customId, channelId = RECRUITMENT_CHANNEL_ID) { return { id: '123456789012345678', channel_id: channelId, member: { user: { id: '987654321098765432' } }, data: { custom_id: customId } }; }
test('the recruitment button returns a private Reddit-ready draft in its assigned channel', () => { const out = handleRecruitmentComponent(interaction(RECRUIT_BUTTON_ID)); assert.equal(out.response.type, 4); assert.equal(out.response.data.flags, 64); assert.match(out.response.data.content, /Open r\/.+ on Reddit/); assert.equal(out.response.data.components[0].components[0].custom_id.startsWith(COPY_BUTTON_PREFIX), true); });
test('copy returns a safe copy-ready title and body', () => { const out = handleRecruitmentComponent(interaction(`${COPY_BUTTON_PREFIX}sidehustle:42`)); assert.match(out.response.data.content, /\*\*Title:\*\*/); assert.match(out.response.data.content, /\*\*Body:\*\*/); });
test('the button fails closed outside its assigned channel', () => { const out = handleRecruitmentComponent(interaction(RECRUIT_BUTTON_ID, '1551968149132279907')); assert.match(out.response.data.content, /assigned Daily Recruitment channel/); });
