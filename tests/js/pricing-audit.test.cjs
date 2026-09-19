const assert = require('node:assert/strict');
const test = require('node:test');

function element(display = '') {
  return { style: { display }, textContent: '' };
}

function auditElements() {
  return {
    section: element('none'),
    last: element(),
    next: element(),
    cta: element(),
    gated: element('none')
  };
}

function supabaseResponse(result, calls = []) {
  return {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return result;
      }
    }
  };
}

test('eligible response reveals the audit CTA after an authenticated function invocation', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const calls = [];
  const elements = auditElements();
  const supabase = supabaseResponse({
    data: {
      state: 'eligible',
      is_welcome_audit: true,
      next_eligible_date: null,
      last_completed_at: null
    },
    error: null
  }, calls);

  await loadAndRender({ supabase, elements, formatDate: value => `date:${value}` });

  assert.deepEqual(calls, [{
    name: 'pricing-audit-eligibility',
    options: { method: 'POST' }
  }]);
  assert.equal(elements.section.style.display, 'block');
  assert.equal(elements.cta.style.display, '');
  assert.equal(elements.gated.style.display, 'none');
  assert.equal(elements.last.textContent, '—');
  assert.equal(elements.next.textContent, 'Available now');
});

test('gated response reveals eligibility dates without the audit CTA', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const supabase = supabaseResponse({
    data: {
      state: 'gated',
      is_welcome_audit: false,
      next_eligible_date: '2026-10-10',
      last_completed_at: '2026-07-12T09:00:00.000Z'
    },
    error: null
  });

  await loadAndRender({ supabase, elements, formatDate: value => `date:${value}` });

  assert.equal(elements.section.style.display, 'block');
  assert.equal(elements.cta.style.display, 'none');
  assert.equal(elements.gated.style.display, 'block');
  assert.equal(
    elements.gated.textContent,
    'Your next pricing audit will be available on date:2026-10-10.'
  );
  assert.equal(elements.last.textContent, 'date:2026-07-12T09:00:00.000Z');
  assert.equal(elements.next.textContent, 'date:2026-10-10');
});

test('not-entitled response keeps pricing audit controls hidden', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const supabase = supabaseResponse({
    data: {
      state: 'not_entitled',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: '2026-07-12T09:00:00.000Z'
    },
    error: null
  });

  await loadAndRender({ supabase, elements, formatDate: value => `date:${value}` });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
  assert.equal(elements.gated.style.display, 'none');
});
