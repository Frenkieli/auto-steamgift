(function (root) {
  // 標準常態（Box-Muller）；注入 rng 以利測試。u1=0.5,u2=0.25 → 0
  function gaussian(rng) {
    const u1 = Math.max(rng(), 1e-9); // 避免 log(0)
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // 兩次抽獎之間的「思考/瀏覽」間隔：對數常態（重尾），夾在 [min,max]
  function humanDelayMs(rng = Math.random) {
    const MEDIAN = 13000, SIGMA = 0.6, MIN = 6000, MAX = 240000;
    const ms = Math.exp(Math.log(MEDIAN) + SIGMA * gaussian(rng));
    return Math.round(Math.min(MAX, Math.max(MIN, ms)));
  }

  // 點開描述後的閱讀停留：依字數（textLen/5 詞）以略讀 ~300wpm + 變異，夾 [1500,15000]
  function readingDelayMs(textLen, rng = Math.random) {
    const WPM = 300, BASE = 1200, MIN = 1500, MAX = 15000;
    const words = textLen / 5;
    const variance = 0.7 + rng() * 0.6; // 0.7..1.3
    const ms = BASE + (words / WPM) * 60000 * variance;
    return Math.round(Math.min(MAX, Math.max(MIN, ms)));
  }

  // 偶發長休息：機率 P 回傳 60–300 秒，否則 0
  function maybeBreakMs(rng = Math.random) {
    const P = 0.15, MIN = 60000, MAX = 300000;
    if (rng() >= P) return 0;
    return Math.round(MIN + rng() * (MAX - MIN));
  }

  const Humanize = { humanDelayMs, readingDelayMs, maybeBreakMs };
  root.Humanize = Humanize;
  if (typeof module !== 'undefined' && module.exports) module.exports = Humanize;
})(typeof window !== 'undefined' ? window : globalThis);
