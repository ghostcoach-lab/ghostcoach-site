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

  function isOptionalString(value) {
    return value === null || typeof value === 'string';
  }

  function isEligibility(value) {
    if (!value || typeof value !== 'object') return false;
    if (!['eligible', 'gated', 'not_entitled'].includes(value.state)) return false;
    if (typeof value.is_welcome_audit !== 'boolean') return false;
    if (!isOptionalString(value.next_eligible_date)) return false;
    if (!isOptionalString(value.last_completed_at)) return false;
    if (value.state === 'gated' && !value.next_eligible_date) return false;
    return true;
  }

  async function loadAndRender({ supabase, elements, formatDate }) {
    reset(elements);

    try {
      const { data, error } = await supabase.functions.invoke(
        'pricing-audit-eligibility',
        { method: 'POST' }
      );
      if (error || !isEligibility(data)) return;

      if (data.state === 'eligible') {
        elements.section.style.display = 'block';
        elements.cta.style.display = '';
        elements.last.textContent = data.last_completed_at
          ? formatDate(data.last_completed_at)
          : '—';
        elements.next.textContent = 'Available now';
        return;
      }

      if (data.state === 'gated') {
        elements.section.style.display = 'block';
        elements.gated.style.display = 'block';
        elements.last.textContent = data.last_completed_at
          ? formatDate(data.last_completed_at)
          : '—';
        elements.next.textContent = formatDate(data.next_eligible_date);
        elements.gated.textContent = 'Your next pricing audit will be available on '
          + formatDate(data.next_eligible_date) + '.';
      }
    } catch (error) {
      console.warn('Pricing audit eligibility unavailable:', error?.message || error);
    }
  }

  return { loadAndRender };
}));
