(function (root) {
  // Reuse an existing instance if already injected (browser idempotency),
  // otherwise build it. Either way we always assign + export below.
  const GiveawayCore = root.GiveawayCore || {
    parsePointCost(row) {
      const thins = row.querySelectorAll('.giveaway__heading__thin');
      for (let i = thins.length - 1; i >= 0; i--) {
        const match = (thins[i].textContent || '').match(/\((\d+)P\)/);
        if (match) return Number(match[1]);
      }
      return null;
    },
    extractCode(row) {
      const input = row.querySelector('form.giveaway__quick-entry-form input[name="code"]');
      if (input && input.value) return input.value;
      const link = row.querySelector('a.giveaway__heading__name');
      if (!link) return null;
      const match = (link.getAttribute('href') || '').match(/\/giveaway\/([^/]+)/);
      return match ? match[1] : null;
    },
    isEnterable(row) { return false; },
    getScore(row) { return 0; },
    calculateWeight(row, config) { return 0; },
  };

  root.GiveawayCore = GiveawayCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = GiveawayCore;
})(typeof window !== 'undefined' ? window : globalThis);
