importScripts('common.js');

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'speak') {
    if (!msg.enqueue) chrome.tts.stop();
    chrome.tts.speak(msg.text, { lang: 'zh-TW', rate: msg.rate || 1.0, enqueue: !!msg.enqueue });
  } else if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
  } else if (msg.type === 'syncIfStale') {
    syncIfStale().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
});

// 開啟借還書頁面時，若名單超過設定時數沒更新，就從雲端抓一次
async function syncIfStale() {
  const { settings = {}, meta = {} } = await chrome.storage.local.get(['settings', 'meta']);
  const st = { ...DEFAULT_SETTINGS, ...settings };
  if (!st.cloudUrl || !st.cloudToken || !st.autoSyncHours) return { ok: true, skipped: true };
  const last = meta.syncedAt ? Date.parse(meta.syncedAt) : 0;
  if (Date.now() - last < st.autoSyncHours * 3600e3) return { ok: true, skipped: true };
  const { students, updatedAt } = await cloudDownload(st.cloudUrl, st.cloudToken);
  if (!students.length) return { ok: false, error: '雲端名單是空的' };
  await chrome.storage.local.set({
    students,
    meta: { ...meta, updatedAt, syncedAt: new Date().toISOString(), source: '雲端試算表' }
  });
  return { ok: true, count: students.length };
}
