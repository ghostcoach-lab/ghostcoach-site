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

test('eligible response reveals the audit CTA after an authenticated function invocation', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const calls = [];
  const elements = auditElements();
  const supabase = {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return {
          data: {
            state: 'eligible',
            is_welcome_audit: true,
            next_eligible_date: null,
            last_completed_at: null
          },
          error: null
        };
      }
    }
  };

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
