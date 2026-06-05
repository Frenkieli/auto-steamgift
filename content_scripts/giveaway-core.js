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
    isEnterable(row) {
      if (row.classList.contains('is-faded')) return false;
      const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insert) return false;
      return !insert.classList.contains('is-locked');
    },
    getScore(row) {
      const span = row.querySelector('span.auto_steam-score');
      if (!span) return 0;
      const value = Number((span.textContent || '').replace(/[^0-9.]/g, ''));
      return Number.isNaN(value) ? 0 : value;
    },
    getContributorLevel(row) {
      const el = row.querySelector('.giveaway__column--contributor-level');
      if (!el) return 0;
      const value = Number((el.textContent || '').replace(/[^0-9]/g, ''));
      return Number.isNaN(value) ? 0 : value;
    },
    calculateWeight(row, config) {
      const restricted = config.restricted.trigger && row.querySelector('.giveaway__column--region-restricted')
        ? Number(config.restricted.value) : 0;
      const whitelist = config.whitelist.trigger && row.querySelector('.giveaway__column--whitelist')
        ? Number(config.whitelist.value) : 0;
      const group = config.group.trigger && row.querySelector('.giveaway__column--group')
        ? Number(config.group.value) : 0;

      let level = 0;
      const levelEl = row.querySelector('.giveaway__column--contributor-level');
      if (config.level.trigger && levelEl) {
        const lvl = Number((levelEl.textContent || '').replace(/[^0-9]/g, '')) || 0;
        level = lvl * Number(config.level.value);
      }

      const cost = config.cost.trigger
        ? (GiveawayCore.parsePointCost(row) || 0) * 0.1 * Number(config.cost.value)
        : 0;

      const total = restricted + whitelist + group + level + cost;
      return Math.round(total * 1000) / 1000;
    },
  };

  root.GiveawayCore = GiveawayCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = GiveawayCore;
})(typeof window !== 'undefined' ? window : globalThis);
