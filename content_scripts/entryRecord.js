(function (root) {
  // Newest-first, capped list of giveaway entry records.
  function pushRecentEntry(list, entry, max = 20) {
    const base = Array.isArray(list) ? list : [];
    return [entry, ...base].slice(0, max);
  }

  // Lifetime success rate as an integer percent, or null when there are no attempts.
  function successRate(success, attempts) {
    const a = Number(attempts) || 0;
    if (a <= 0) return null;
    const s = Number(success) || 0;
    return Math.round((s / a) * 100);
  }

  root.EntryRecord = { pushRecentEntry, successRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = { pushRecentEntry, successRate };
})(typeof window !== 'undefined' ? window : globalThis);
