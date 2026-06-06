(function (root) {
  // updatedAt: epoch ms (0/undefined = 從未更新)；now: epoch ms；t: (key, n?) => string
  function relativeUpdatedText(updatedAt, now, t) {
    if (!updatedAt) return t('pointUpdatedNever');
    const diff = Math.max(0, now - updatedAt);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('pointUpdatedJustNow');
    const min = Math.floor(sec / 60);
    if (min < 60) return t('pointUpdatedMinutes', min);
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('pointUpdatedHours', hr);
    const day = Math.floor(hr / 24);
    return t('pointUpdatedDays', day);
  }

  root.RelativeTime = { relativeUpdatedText };
  if (typeof module !== 'undefined' && module.exports) module.exports = { relativeUpdatedText };
})(typeof window !== 'undefined' ? window : globalThis);
