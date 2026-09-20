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

  function localDateFromDateOnly(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) return null;
    return date;
  }

  function isOptionalTimestamp(value) {
    return value === null || (
      typeof value === 'string' &&
      value.length > 0 &&
      !Number.isNaN(Date.parse(value))
    );
  }

  function isEligibility(value) {
    if (!value || typeof value !== 'object') return false;
    if (!['eligible', 'gated', 'not_entitled'].includes(value.state)) return false;
    if (typeof value.is_welcome_audit !== 'boolean') return false;
    if (!isOptionalTimestamp(value.last_completed_at)) return false;
    if (value.state === 'gated') {
      if (!localDateFromDateOnly(value.next_eligible_date)) return false;
    } else if (value.next_eligible_date !== null) return false;
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
        const lastCompleted = data.last_completed_at
          ? formatDate(data.last_completed_at)
          : '—';
        elements.section.style.display = 'block';
        elements.cta.style.display = '';
        elements.last.textContent = lastCompleted;
        elements.next.textContent = 'Available now';
        return;
      }

      if (data.state === 'gated') {
        const nextEligible = formatDate(localDateFromDateOnly(data.next_eligible_date));
        const lastCompleted = data.last_completed_at
          ? formatDate(data.last_completed_at)
          : '—';
        elements.section.style.display = 'block';
        elements.gated.style.display = 'block';
        elements.last.textContent = lastCompleted;
        elements.next.textContent = nextEligible;
        elements.gated.textContent = 'Your next pricing audit will be available on '
          + nextEligible + '.';
      }
    } catch (error) {
      reset(elements);
      console.warn('Pricing audit eligibility unavailable:', error?.message || error);
    }
  }

  return { loadAndRender };
}));
