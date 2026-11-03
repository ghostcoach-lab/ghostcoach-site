import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const workflow = JSON.parse(readFileSync(new URL('./fixtures/s4-published.json', import.meta.url)));
const code = workflow.nodes.find(node => node.name === 'Parse Digest Response').parameters.jsCode;
const context = { user_id: 'fixture-user', email: 'qa@example.test', plan: 'operator' };
const digest = { opening: 'Your next steps.', actions: ['Review pricing', 'Call a customer', 'Ship the change'] };

function parse(content) {
  return JSON.parse(JSON.stringify(runInNewContext('(function () {\n' + code + '\n})()', {
    $input: { first: () => ({ json: { content } }) },
    $: name => { assert.equal(name, 'Build Digest Prompt'); return { first: () => ({ json: context }) }; },
  })[0].json));
}

test('Parse Digest Response reads text after thinking without using the fallback', () => {
  const result = parse([{ type: 'thinking', thinking: 'Synthetic fixture' }, { type: 'text', text: JSON.stringify(digest) }]);
  assert.equal(result.used_fallback, false);
  assert.equal(result.opening, digest.opening);
  assert.deepEqual(result.actions, digest.actions);
  assert.equal(result.user_id, context.user_id);
});

test('Parse Digest Response joins text blocks and ignores other block shapes', () => {
  const raw = JSON.stringify(digest);
  const result = parse([null, { type: 'text', text: raw.slice(0, 15) }, { type: 'tool_use', text: 'not JSON' }, { type: 'text', text: 7 }, { type: 'text', text: raw.slice(15) }]);
  assert.equal(result.used_fallback, false);
  assert.deepEqual(result.actions, digest.actions);
  assert.equal(result.opening, digest.opening);
});

test('Parse Digest Response preserves text-only parsing and invalid-response fallback', () => {
  assert.equal(parse([{ type: 'text', text: JSON.stringify(digest) }]).used_fallback, false);
  for (const content of [undefined, [], [{ type: 'thinking' }], [{ type: 'text', text: 'invalid' }]]) {
    const result = parse(content);
    assert.equal(result.used_fallback, true);
    assert.equal(result.user_id, context.user_id);
    assert.equal(result.opening, 'Here are your three actions for the week.');
  }
});
