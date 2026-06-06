(function (root) {
  // 每個可調參數的預設值（canonical 單位：ms / 0–1 小數 / 原始整數）。
  const DEFAULTS = {
    delayMedian: 4000, delaySigma: 0.6, delayMin: 2000, delayMax: 30000,
    readWpm: 1000, readBase: 200, readMin: 400, readMax: 1500,
    breakProb: 0.15, breakMin: 60000, breakMax: 300000,
    earlyStopProb: 0.10,
    capMin: 50, capMax: 58
  };
  // 每個參數的允許範圍 [lo, hi]；讀取時夾限，防止關閉反偵測或卡死。
  const BOUNDS = {
    delayMedian: [2000, 600000], delaySigma: [0, 2], delayMin: [2000, 600000], delayMax: [2000, 600000],
    readWpm: [60, 1000], readBase: [0, 30000], readMin: [0, 60000], readMax: [0, 60000],
    breakProb: [0, 1], breakMin: [0, 1800000], breakMax: [0, 1800000],
    earlyStopProb: [0, 1],
    capMin: [0, 1000], capMax: [0, 1000]
  };

  function clampNum(value, lo, hi, fallback) {
    if (value == null) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  // 把使用者設定（可能殘缺/越界/非法）解析成完整、夾限過的 canonical 設定。
  function resolveConfig(raw) {
    const r = raw || {};
    const out = {};
    for (const key in DEFAULTS) {
      const [lo, hi] = BOUNDS[key];
      out[key] = clampNum(r[key], lo, hi, DEFAULTS[key]);
    }
    // 確保每組 min <= max（避免區間反轉產生怪異結果）
    if (out.delayMax < out.delayMin) out.delayMax = out.delayMin;
    if (out.readMax < out.readMin) out.readMax = out.readMin;
    if (out.breakMax < out.breakMin) out.breakMax = out.breakMin;
    if (out.capMax < out.capMin) out.capMax = out.capMin;
    return out;
  }

  // 標準常態（Box-Muller）；注入 rng 以利測試。u1=0.5,u2=0.25 → 0
  function gaussian(rng) {
    const u1 = Math.max(rng(), 1e-9); // 避免 log(0)
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // 兩次抽獎之間的「思考/瀏覽」間隔：對數常態（重尾），夾在 [delayMin, delayMax]
  function humanDelayMs(cfg = {}, rng = Math.random) {
    const c = resolveConfig(cfg);
    const ms = Math.exp(Math.log(c.delayMedian) + c.delaySigma * gaussian(rng));
    return Math.round(Math.min(c.delayMax, Math.max(c.delayMin, ms)));
  }

  // 點開描述後的閱讀停留：依字數（textLen/5 詞）以略讀 readWpm + 變異，夾 [readMin, readMax]
  function readingDelayMs(textLen, cfg = {}, rng = Math.random) {
    const c = resolveConfig(cfg);
    const words = textLen / 5;
    const variance = 0.7 + rng() * 0.6; // 0.7..1.3
    const ms = c.readBase + (words / c.readWpm) * 60000 * variance;
    return Math.round(Math.min(c.readMax, Math.max(c.readMin, ms)));
  }

  // 偶發長休息：機率 breakProb 回傳 [breakMin, breakMax]，否則 0
  function maybeBreakMs(cfg = {}, rng = Math.random) {
    const c = resolveConfig(cfg);
    if (rng() >= c.breakProb) return 0;
    return Math.round(c.breakMin + rng() * (c.breakMax - c.breakMin));
  }

  // 是否在活躍時段內（分鐘為單位）；start>end 代表跨午夜
  function inActiveHours(date, startMin, endMin) {
    const mins = date.getHours() * 60 + date.getMinutes();
    if (startMin === endMin) return true; // 全天
    if (startMin < endMin) return mins >= startMin && mins < endMin;
    return mins >= startMin || mins < endMin; // 跨午夜
  }

  // 每日上限（每天重抽，範圍 [capMin, capMax]，含端點）
  function pickDailyCap(cfg = {}, rng = Math.random) {
    const c = resolveConfig(cfg);
    return c.capMin + Math.floor(rng() * (c.capMax - c.capMin + 1));
  }

  // 機率早停：本 session 有機率提早收手
  function shouldEarlyStop(cfg = {}, rng = Math.random) {
    const c = resolveConfig(cfg);
    return rng() < c.earlyStopProb;
  }

  const Humanize = {
    humanDelayMs, readingDelayMs, maybeBreakMs, inActiveHours, pickDailyCap, shouldEarlyStop,
    resolveConfig, DEFAULTS
  };
  root.Humanize = Humanize;
  if (typeof module !== 'undefined' && module.exports) module.exports = Humanize;
})(typeof window !== 'undefined' ? window : globalThis);
