// 在網頁本身的環境（MAIN world）執行。
// 擴充功能的隔離環境做出來的鍵盤事件，網頁讀不到 keyCode，
// 所以「模擬按 Enter」必須在這裡產生。
(() => {
  if (window.__libHelperPage) return;
  window.__libHelperPage = true;
  document.addEventListener('libhelper:enter', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => 13 });
      Object.defineProperty(ev, 'which', { get: () => 13 });
      Object.defineProperty(ev, 'charCode', { get: () => (type === 'keypress' ? 13 : 0) });
      el.dispatchEvent(ev);
    }
  }, true);
})();
