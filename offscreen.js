const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const ENTRY_URL = "https://www.steamgifts.com/ajax.php";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {}, message.maxEntries || 0)
    .then(({ count, point, loggedIn, entries }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point, loggedIn, entries }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});

async function postAjax(doValue, code, xsrf) {
  const body = new URLSearchParams({ xsrf_token: xsrf, do: doValue, code });
  try {
    const res = await fetch(ENTRY_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString()
    });
    return await res.json();
  } catch (e) {
    return null;
  }
}

const enterOne = async (code, xsrf) => {
  const data = await postAjax("entry_insert", code, xsrf);
  return !!data && data.type === "success";
};

// 點開描述（giveaway_description）並回傳描述文字長度，供閱讀停留計算
const fetchDescriptionLen = async (code, xsrf) => {
  const data = await postAjax("giveaway_description", code, xsrf);
  return (data && data.html ? String(data.html) : "").length;
};

async function runFullAuto(cfg, maxEntries) {
  const human = window.Humanize;
  const hcfg = (cfg && cfg.humanizeConfig) || {};
  const res = await fetch(WISHLIST_URL, { credentials: "include" });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const xsrfEl = doc.querySelector('input[name="xsrf_token"]');
  const xsrf = xsrfEl ? xsrfEl.value : null;
  if (!xsrf) return { count: 0, loggedIn: false };

  const pointsEl = doc.querySelector('.nav__points');
  let myPoint = pointsEl ? Number((pointsEl.textContent || '').replace(/[^0-9]/g, '')) || 0 : 0;

  const core = window.GiveawayCore;
  const rows = [...doc.getElementsByClassName('giveaway__row-inner-wrap')];

  // inject score spans (same shape getScore/countScore expect) so passesMinimum works
  rows.forEach((row) => {
    const total = core.calculateWeight(row, cfg);
    let span = row.querySelector('span.auto_steam-score');
    if (!span) {
      span = doc.createElement('span');
      span.className = 'auto_steam-score';
      const heading = row.querySelector('.giveaway__heading');
      if (heading) heading.appendChild(span);
    }
    span.textContent = `(Score:${total})`;
  });

  const eligible = rows
    .filter((row) => core.isEnterable(row) && core.passesMinimum(row, cfg))
    .sort((a, b) => core.getScore(b) - core.getScore(a));

  const pointFloor = Number(cfg.pointFloor) || 0;
  let count = 0;
  const entries = [];

  for (const row of eligible) {
    if (count >= maxEntries) break; // 每日額度上限
    const cost = core.parsePointCost(row) || 0;
    if (myPoint - cost < pointFloor) continue;
    const code = core.extractCode(row);
    if (!code) continue;
    if (core.isDescriptionGated(row)) {
      const len = await fetchDescriptionLen(code, xsrf);
      await delay(human.readingDelayMs(len, hcfg)); // 閱讀停留（伺服器可觀測）
    }
    const ok = await enterOne(code, xsrf);
    if (ok) {
      myPoint -= cost;
      count++;
    }
    const nameLink = row.querySelector('.giveaway__heading__name');
    const name = nameLink ? nameLink.textContent.trim() : "";
    const path = nameLink ? nameLink.getAttribute('href') : "";
    const url = path ? new URL(path, "https://www.steamgifts.com").href : "";
    entries.push({ name, url, points: ok ? cost : 0, result: ok ? "success" : "fail", time: Date.now() });
    await delay(human.humanDelayMs(hcfg));
    const breakMs = human.maybeBreakMs(hcfg);
    if (breakMs) await delay(breakMs);
  }
  return { count, point: myPoint, loggedIn: true, entries };
}
