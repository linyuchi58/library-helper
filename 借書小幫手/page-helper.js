// 在網頁本身的環境（MAIN world）執行。
// 全國閱讀推動與圖書管理系統是 AngularJS：讀者證號欄用 ng-model="card_no"、ng-keyup 呼叫 enterCardNo()。
// 「書籍欄輸入學生 → 改送讀者欄」時，直接呼叫系統自己的 enterCardNo()，最穩定；
// 找不到 AngularJS 時才退回模擬按 Enter。
(() => {
  if (window.__libHelperPage) return;
  window.__libHelperPage = true;

  function viaAngular(el) {
    try {
      const ng = window.angular;
      if (!ng) return false;
      const scope = ng.element(el).scope();
      const model = el.getAttribute('ng-model');
      const call = (el.getAttribute('ng-keyup') || '').match(/(\w+)\(\)\s*$/);
      if (!scope || !model || !call || typeof scope[call[1]] !== 'function') return false;
      const run = () => {
        scope[model] = el.value;
        scope[call[1]]();
        // 系統會把 model 清空；因為 model 前後都是空字串，畫面不會自動更新，這裡順手清掉
        if (!scope[model]) setTimeout(() => { el.value = ''; }, 0);
      };
      if (scope.$root && scope.$root.$$phase) scope.$evalAsync(run); else scope.$apply(run);
      return true;
    } catch (_) { return false; }
  }

  function viaKeys(el) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => 13 });
      Object.defineProperty(ev, 'which', { get: () => 13 });
      Object.defineProperty(ev, 'charCode', { get: () => (type === 'keypress' ? 13 : 0) });
      el.dispatchEvent(ev);
    }
  }

  document.addEventListener('libhelper:enter', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!viaAngular(el)) viaKeys(el);
  }, true);
})();
