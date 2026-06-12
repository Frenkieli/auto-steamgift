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

  // Previously-won skip list: newest first, uncapped. One entry per GAME: the same
  // game often has several concurrent giveaways (different codes), so dedup by
  // gameId first and fall back to the giveaway code for entries without one.
  function pushWonEntry(list, entry) {
    const base = Array.isArray(list) ? list : [];
    const dup = base.some((e) => e && (
      (entry.gameId && e.gameId === entry.gameId) ||
      (entry.code && e.code === entry.code)
    ));
    if (dup) return base;
    return [entry, ...base];
  }

  root.EntryRecord = { pushRecentEntry, successRate, pushWonEntry };
  if (typeof module !== 'undefined' && module.exports) module.exports = { pushRecentEntry, successRate, pushWonEntry };
})(typeof window !== 'undefined' ? window : globalThis);
