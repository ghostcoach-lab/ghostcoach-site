import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/s4-published.json', import.meta.url)));
const code = fixture.nodes.find(node => node.name === 'Prepare User List').parameters.jsCode;
const run = users => JSON.parse(JSON.stringify(runInNewContext(`(function () { ${code} })()`, {
  $input: { all: () => users.map(json => ({ json })) },
  console: { log() {} },
})));

test('processes all users and preserves their plan, including a missing plan', () => {
  assert.deepEqual(run([
    { id: 'one', email: 'one@example.test', plan: 'operator' },
    { id: 'two', email: 'two@example.test', plan: 'lifetime' },
    { id: 'three', email: 'three@example.test' },
    { id: 'bad' },
  ]), [
    { json: { user_id: 'one', email: 'one@example.test', plan: 'operator' } },
    { json: { user_id: 'two', email: 'two@example.test', plan: 'lifetime' } },
    { json: { user_id: 'three', email: 'three@example.test' } },
  ]);
});

test('returns no items when the query is empty', () => {
  assert.deepEqual(run([]), []);
});
