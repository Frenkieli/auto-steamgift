const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const ENTRY_URL = "https://www.steamgifts.com/ajax.php";

const delayRandom = () => new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 1200)));

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {})
    .then(({ count, point }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point }))
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
    const data = await res.json();
    return !!data && data.type === "success";
  } catch (e) {
    return false;
  }
}

const enterOne = (code, xsrf) => postAjax("entry_insert", code, xsrf);
const viewDescription = (code, xsrf) => postAjax("giveaway_description", code, xsrf);

async function runFullAuto(cfg) {
  const res = await fetch(WISHLIST_URL, { credentials: "include" });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const xsrfEl = doc.querySelector('input[name="xsrf_token"]');
  const xsrf = xsrfEl ? xsrfEl.value : null;
  if (!xsrf) return 0;

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

  for (const row of eligible) {
    const cost = core.parsePointCost(row) || 0;
    if (myPoint - cost < pointFloor) continue;
    const code = core.extractCode(row);
    if (!code) continue;
    if (core.isDescriptionGated(row)) {
      await viewDescription(code, xsrf);
      await delayRandom();
    }
    const ok = await enterOne(code, xsrf);
    if (ok) {
      myPoint -= cost;
      count++;
    }
    await delayRandom();
  }
  return { count, point: myPoint };
}
