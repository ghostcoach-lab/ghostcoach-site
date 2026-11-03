// Offline only: change two parser nodes on the published snapshot.
const names = ['Parse Summary Response', 'Parse Scoring Response'];
const before = "const rawText = $input.first().json?.content?.[0]?.text?.trim() ?? '';";
const after = "const rawText = ($input.first().json?.content ?? [])\n  .filter(block => block && block.type === 'text' && typeof block.text === 'string')\n  .map(block => block.text)\n  .join('')\n  .trim();";
export function prepareS3TextBlocks(snapshot) {
  if (!snapshot.activeVersion?.nodes || snapshot.activeVersion.versionId !== snapshot.activeVersionId)
    throw new Error('Expected matching published activeVersion');
  const candidate = structuredClone(snapshot.activeVersion);
  for (const name of names) {
    const matches = candidate.nodes.filter(node => node.name === name);
    if (matches.length !== 1) throw new Error('Expected one parser: ' + name);
    const node = matches[0];
    const code = node.parameters.jsCode;
    if (!code.startsWith(before) && !code.startsWith(after)) throw new Error('Parser changed: ' + name);
    node.parameters.jsCode = code.replace(before, after)
      .replace('Summary unavailable — will retry.', 'No summary was saved for this session.');
  }
  return candidate;
}
