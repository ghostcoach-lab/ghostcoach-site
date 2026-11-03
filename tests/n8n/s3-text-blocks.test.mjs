import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const fixture = JSON.parse(await readFile(new URL('./fixtures/s3-published.json', import.meta.url)));
function parse(name, content) {
  const code = fixture.nodes.find(n => n.name === name).parameters.jsCode;
  return vm.runInNewContext('(function(){' + code + '})()', {
    $input: {first: () => ({json:{content}})},
    $: () => ({first: () => ({json:{prev_score:40}})}),
  })[0].json;
}
test('S3 summary skips thinking before JSON text', () => {
  const result = parse('Parse Summary Response', [{type:'thinking'}, {type:'text',text:'{"summary":["Done"],"action_committed":"Ship"}'}]);
  assert.equal(result.summary, 'Done');
  assert.equal(result.action_committed, 'Ship');
});

test('S3 scoring reads split text around non-text blocks', () => {
  const result = parse('Parse Scoring Response', [{type:'thinking'}, {type:'text',text:'{"confirmed_completion":true,'}, null, {type:'tool_use'}, {type:'text',text:'"reason":"Done"}'}]);
  assert.equal(result.score, 60);
  assert.equal(result.reason, 'Done');
});
test('S3 text-only responses and failure fallbacks', () => {
  assert.equal(parse('Parse Summary Response', [{type:'text',text:'{"summary":["Normal"]}'}]).summary, 'Normal');
  assert.equal(parse('Parse Scoring Response', [{type:'text',text:'{"new_commitment":true}'}]).score, 45);
  for (const content of [undefined, [], [{type:'thinking'}], [{type:'text',text:'Not JSON'}]]) {
    assert.equal(parse('Parse Summary Response', content).summary, 'Session complete. | No summary was saved for this session.');
    const score = parse('Parse Scoring Response', content);
    assert.equal(score.score,40);
    assert.equal(score.reason,'Scoring parse error — score unchanged');
  }
});

import {prepareS3TextBlocks} from '../../scripts/n8n/s3-text-blocks.mjs';
test('candidate changes only published parser code and ignores draft edits', () => {
  const baseline = structuredClone(fixture);
  for (const n of baseline.nodes.filter(n => /^Parse (Summary|Scoring) Response$/.test(n.name))) {
    n.parameters.jsCode = n.parameters.jsCode.replace("const rawText = ($input.first().json?.content ?? [])\n  .filter(block => block && block.type === 'text' && typeof block.text === 'string')\n  .map(block => block.text)\n  .join('')\n  .trim();", "const rawText = $input.first().json?.content?.[0]?.text?.trim() ?? '';")
      .replace('No summary was saved for this session.', 'Summary unavailable — will retry.');
  }
  baseline.versionId = 'published';
  const snapshot = {activeVersionId:'published', activeVersion:baseline, nodes:[]};
  const result = prepareS3TextBlocks(snapshot);
  assert.deepEqual(result, {...fixture,versionId:'published'});
  assert.deepEqual(prepareS3TextBlocks({...snapshot,activeVersion:result}),result);
  assert.notDeepEqual(baseline,result);
  assert.throws(() => prepareS3TextBlocks({...snapshot,activeVersionId:'stale'}));
});
