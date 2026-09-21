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

function formatDate(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `date:${year}-${month}-${day}`;
  }
  return `date:${value}`;
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

test('the release flag must be exactly true before eligibility is requested', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');

  for (const enabled of [false, undefined, 'true']) {
    const calls = [];
    const elements = auditElements();
    elements.section.style.display = 'block';
    elements.cta.style.display = '';
    elements.gated.style.display = 'block';
    elements.gated.textContent = 'stale';
    elements.last.textContent = 'stale';
    elements.next.textContent = 'stale';

    await loadAndRender({
      enabled,
      supabase: supabaseResponse({
        data: {
          state: 'eligible',
          is_welcome_audit: true,
          next_eligible_date: null,
          last_completed_at: null
        },
        error: null
      }, calls),
      elements,
      formatDate
    });

    assert.deepEqual(calls, []);
    assert.equal(elements.section.style.display, 'none');
    assert.equal(elements.cta.style.display, 'none');
    assert.equal(elements.gated.style.display, 'none');
    assert.equal(elements.gated.textContent, '');
    assert.equal(elements.last.textContent, '—');
    assert.equal(elements.next.textContent, '—');
  }
});

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

  await loadAndRender({ enabled: true, supabase, elements, formatDate });

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

  await loadAndRender({ enabled: true, supabase, elements, formatDate });

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

  await loadAndRender({ enabled: true, supabase, elements, formatDate });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
  assert.equal(elements.gated.style.display, 'none');
});

test('the audit section stays hidden while eligibility is loading', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  elements.section.style.display = 'block';
  elements.cta.style.display = '';
  let resolveInvoke;
  const invoked = new Promise(resolve => { resolveInvoke = resolve; });
  const supabase = { functions: { invoke: () => invoked } };

  const rendering = loadAndRender({ enabled: true, supabase, elements, formatDate: String });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
  resolveInvoke({
    data: {
      state: 'not_entitled',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: null
    },
    error: null
  });
  await rendering;
});

test('an invocation error keeps the section hidden without rejecting', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const supabase = supabaseResponse({ data: null, error: new Error('offline') });

  await loadAndRender({ enabled: true, supabase, elements, formatDate: String });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
});

test('a malformed eligibility response keeps the section hidden', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const supabase = supabaseResponse({
    data: {
      state: 'gated',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: null
    },
    error: null
  });

  await loadAndRender({ enabled: true, supabase, elements, formatDate: String });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.gated.style.display, 'none');
});

test('a server date-only value is formatted as the same local calendar date', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  let formattedNext;
  const supabase = supabaseResponse({
    data: {
      state: 'gated',
      is_welcome_audit: false,
      next_eligible_date: '2026-10-10',
      last_completed_at: null
    },
    error: null
  });

  await loadAndRender({
    enabled: true,
    supabase,
    elements,
    formatDate(value) {
      if (value instanceof Date) formattedNext = value;
      return formatDate(value);
    }
  });

  assert.ok(formattedNext instanceof Date);
  assert.equal(formattedNext.getFullYear(), 2026);
  assert.equal(formattedNext.getMonth(), 9);
  assert.equal(formattedNext.getDate(), 10);
  assert.equal(elements.next.textContent, 'date:2026-10-10');
});

test('an invalid completion timestamp keeps eligible controls hidden', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const supabase = supabaseResponse({
    data: {
      state: 'eligible',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: 'not-a-date'
    },
    error: null
  });

  await loadAndRender({ enabled: true, supabase, elements, formatDate });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
});

test('a formatting failure resets controls to the hidden state', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const supabase = supabaseResponse({
    data: {
      state: 'eligible',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: '2026-07-12T09:00:00.000Z'
    },
    error: null
  });

  await loadAndRender({
    enabled: true,
    supabase,
    elements,
    formatDate() { throw new Error('formatter failed'); }
  });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
  assert.equal(elements.last.textContent, '—');
  assert.equal(elements.next.textContent, '—');
});
