(function (root) {
  // Reuse an existing instance if already injected (browser idempotency),
  // otherwise build it. Either way we always assign + export below.
  const GiveawayCore = root.GiveawayCore || {
    parsePointCost(row) { return null; },
    extractCode(row) { return null; },
    isEnterable(row) { return false; },
    getScore(row) { return 0; },
    calculateWeight(row, config) { return 0; },
  };

  root.GiveawayCore = GiveawayCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = GiveawayCore;
})(typeof window !== 'undefined' ? window : globalThis);
