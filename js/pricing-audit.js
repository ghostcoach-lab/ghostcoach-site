// GhostCoach — Quarterly pricing-audit eligibility adapter.
(function exposePricingAudit(root, factory) {
  const api = factory();
  root.GCPricingAudit = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis === 'object' ? globalThis : this, function createPricingAudit() {
  function reset(elements) {
    elements.section.style.display = 'none';
    elements.cta.style.display = 'none';
    elements.gated.style.display = 'none';
    elements.gated.textContent = '';
    elements.last.textContent = '—';
    elements.next.textContent = '—';
  }

  async function loadAndRender({ supabase, elements, formatDate }) {
    reset(elements);

    const { data, error } = await supabase.functions.invoke(
      'pricing-audit-eligibility',
      { method: 'POST' }
    );
    if (error) throw error;

    if (data.state === 'eligible') {
      elements.section.style.display = 'block';
      elements.cta.style.display = '';
      elements.last.textContent = data.last_completed_at
        ? formatDate(data.last_completed_at)
        : '—';
      elements.next.textContent = 'Available now';
    }
  }

  return { loadAndRender };
}));
