// 借書小幫手：在「書籍借閱與歸還」頁面加上智慧輸入、操作面板、超大字確認區與數字鍵盤快捷鍵
(() => {
  if (window.__libHelper) return;
  window.__libHelper = true;

  const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const DEFAULTS = {
    readerIdType: 'pid', bigFormat: 'short',
    showReaderBig: true, showReturnBig: true, showWarnBig: true, showReturnMode: true, showOverdue: true, showQuota: true,
    speakMode: 'name', speakRate: 1.1, acceptClassSeat: true, sayFull: true, sayOverdue: true,
    sayName: true, sayReturn: true, sayBookKey: true, sayNextKey: true, sayBorrowKey: true, sayModeSwitch: true, sayWarn: true
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const maskPid = (p) => (p ? p.slice(0, 3) + '****' + p.slice(-3) : '');

  // 數字鍵盤快捷鍵（只認右側數字鍵盤，不影響條碼機與主鍵盤）
  const NUMPAD = {
    NumpadAdd: 'next',          // +  下一位（清除、回讀者證號欄）
    NumpadSubtract: 'recess',   // -  下課模式 ↔ 上一個班級（先回讀者證號欄）
    NumpadDivide: 'pickClass',  // /  選班級：/ 203 Enter（/ Enter = 下課模式）（先回讀者證號欄）
    NumpadMultiply: 'book',     // *  跳到書籍條碼欄（還書）
    NumpadDecimal: 'book'       // .  跳到書籍條碼欄（還書）
  };

  const S = {
    students: [],
    bySid: new Map(), byPid: new Map(), byChest: new Map(),
    byClass: new Map(),   // "年-班序" -> Map(座號 -> 學生)
    keyLens: new Set(),   // 胸號（含班級座號）的長度
    bookLens: new Set(),  // 系統確認過的書號長度（借出／歸還成功才記）
    ctx: 'idle',          // idle＝游標在讀者欄等待；borrow＝借書中；return＝還書中
    swallow: new Set(),   // 已攔下 keydown 的按鍵，連同 keyup 一起攔（系統是用 keyup 處理 Enter）
    classes: [],
    settings: { ...DEFAULTS },
    meta: {},
    classMode: '', lastClass: '',
    workMode: 'continuous', // continuous＝連續借書；mixed＝借還書
    fullKey: '',           // 已處理過「借滿」的讀者
    current: null,        // {st, via, state:'pending'|'ok'|'mismatch', pageName, quota, overdue}
    msg: null,
    ret: null,            // 最近一次還書結果 {title, shelf}            // {text, kind:'warn'|'info'} 大字區暫時訊息
    picking: null,        // 正在用 / 選班級時的輸入緩衝
    pollTimer: null
  };

  const readerId = (st) => (S.settings.readerIdType === 'pid' ? st.pid : st.sid);
  const idLabel = () => (S.settings.readerIdType === 'pid' ? '身分證字號' : '學號');
  const clsShort = (st) => { const m = (st.className || '').match(/年(.+?)班/); return m ? m[1] : String(st.cls); };
  const classLabel = (key) => S.classes.find((c) => c.key === key)?.label || '';

  // ---------- 名單 ----------
  function rebuild() {
    S.bySid.clear(); S.byPid.clear(); S.byChest.clear(); S.byClass.clear(); S.keyLens.clear();
    const cls = new Map();
    for (const st of S.students) {
      if (st.sid) S.bySid.set(st.sid, st);
      if (st.pid) S.byPid.set(st.pid.toUpperCase(), st);
      S.byChest.set(st.chest, st);
      S.keyLens.add(st.chest.length);
      const key = st.grade + '-' + st.cls;
      if (!S.byClass.has(key)) S.byClass.set(key, new Map());
      S.byClass.get(key).set(st.seat, st);
      if (!cls.has(key)) cls.set(key, { key, label: st.className || `${st.grade}年${st.cls}班`, grade: st.grade, cls: st.cls });
    }
    if (S.settings.acceptClassSeat) {
      for (const st of S.students) {
        const alias = `${st.grade}${pad2(st.cls)}${pad2(st.seat)}`;
        if (!S.byChest.has(alias) && !S.bySid.has(alias)) { S.byChest.set(alias, st); S.keyLens.add(alias.length); }
      }
    }
    S.classes = [...cls.values()].sort((a, b) => a.grade - b.grade || a.cls - b.cls);
    if (S.classMode && !S.byClass.has(S.classMode)) S.classMode = '';
    renderPanel();
    renderBig();
  }

  async function load() {
    const d = await chrome.storage.local.get(['students', 'settings', 'meta', 'classMode', 'lastClass', 'bookLens2', 'workMode']);
    S.workMode = d.workMode || 'continuous';
    S.students = d.students || [];
    S.settings = { ...DEFAULTS, ...(d.settings || {}) };
    S.meta = d.meta || {};
    S.classMode = d.classMode || '';
    S.lastClass = d.lastClass || '';
    S.bookLens = new Set(d.bookLens2 || []);   // 舊版 bookLens 可能記錯，不再沿用
    rebuild();
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.students) S.students = ch.students.newValue || [];
    if (ch.settings) S.settings = { ...DEFAULTS, ...(ch.settings.newValue || {}) };
    if (ch.meta) S.meta = ch.meta.newValue || {};
    if (ch.classMode) S.classMode = ch.classMode.newValue || '';
    if (ch.lastClass) S.lastClass = ch.lastClass.newValue || '';
    if (ch.workMode) S.workMode = ch.workMode.newValue || 'continuous';
    if (ch.students || ch.settings || ch.meta || ch.classMode || ch.lastClass || ch.workMode) rebuild();
  });

  // ---------- 頁面欄位 ----------
  function inputs() {
    return {
      reader: document.querySelector('input[placeholder*="讀者證號"]'),
      book: document.querySelector('input[placeholder*="書籍登錄號"], input[placeholder*="書籍條碼"]')
    };
  }
  function setValue(el, v) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function pressEnter(el) { el.dispatchEvent(new CustomEvent('libhelper:enter', { bubbles: true })); }
  function focusEl(el, clear) { if (!el) return; if (clear) setValue(el, ''); el.focus(); el.select && el.select(); }

  // ---------- 解析輸入 ----------
  // 回傳 {student, via} / {error} / null（null＝不是學生，交給系統：書號、教師證、AAAAA…）
  function resolve(raw) {
    if (!raw) return null;
    const up = raw.toUpperCase();
    if (S.byPid.has(up)) return { student: S.byPid.get(up), via: '身分證' };
    if (S.bySid.has(raw)) return { student: S.bySid.get(raw), via: '學號' };
    if (S.byChest.has(raw)) return { student: S.byChest.get(raw), via: '胸號' };
    if (!/^\d+$/.test(raw)) return null;
    if (raw.length <= 2) {
      if (!S.classMode) return { error: '請先選班級，或輸入完整胸號' };
      const st = S.byClass.get(S.classMode)?.get(Number(raw));
      return st ? { student: st, via: '座號' } : { error: `本班沒有 ${Number(raw)} 號` };
    }
    if (S.keyLens.has(raw.length)) return { error: `查無胸號 ${raw}` };
    return null;
  }

  // ---------- 鍵盤 ----------
  document.addEventListener('keydown', onKey, true);

  function onKey(e) {
    if (!e.isTrusted) return;                 // 自己模擬的 Enter 不處理
    const { reader, book } = inputs();
    if (!reader) return;

    // 選班級輸入中：吃掉所有按鍵
    if (S.picking != null) { onPickKey(e); return; }

    const act = NUMPAD[e.code];
    if (act) { block(e); doAction(act); return; }
    if (e.key === 'Escape') { block(e); doAction('next'); return; }
    if (e.key === 'F2') { block(e); doAction('book'); return; }

    const t = e.target;
    // NumLock 沒開時，數字鍵盤的數字照樣輸入
    const nd = e.code.match(/^Numpad(\d)$/);
    if (nd && !/^\d$/.test(e.key) && (t === reader || t === book)) {
      block(e); setValue(t, t.value + nd[1]); showMsg('數字鍵盤 NumLock 沒開，已自動處理', 'info', 1500); return;
    }

    if (e.key !== 'Enter' || e.isComposing) return;
    if (t !== reader && t !== book) return;
    const raw = t.value.trim();
    if (!raw) {                                   // 空白 Enter 不送，避免系統跳「登錄號為空」
      block(e);
      if (t === book) { nextReader(); speak('借書', false, 'sayBorrowKey'); }   // 書籍欄空白 Enter → 回讀者證號欄
      return;
    }
    const hit = resolve(raw);

    if (t === reader) {
      if (!hit && /^(A{5,6}|B{5,6})$/i.test(raw)) return;
      if (!(hit && hit.student) && S.current && S.current.state === 'mismatch') {
        block(e); focusEl(reader, true);
        warn(`還沒確認讀者 ${S.current.st.name}，請重新輸入胸號`);
        return;
      }
      if (!hit) {                                   // 名單外：照常交給系統
        if (/^[a-z]\d{9}$/.test(raw)) setValue(reader, raw.toUpperCase());
        S.current = null; S.ctx = 'borrow'; renderPanel();
        showMsg('名單外的號碼，已交給系統', 'info', 2500);
        return;
      }
      if (hit.error && raw.length <= 2) { block(e); warn(hit.error); focusEl(reader); return; }
      if (hit.error) { S.current = null; S.ctx = 'borrow'; showMsg(`名單內查無 ${raw}，已照原號碼交給系統`, 'info', 3000); return; }
      const id = readerId(hit.student);
      if (!id) { block(e); warn(`${hit.student.name} 沒有${idLabel()}資料`); return; }
      if (raw !== id) setValue(reader, id);
      startReader(hit.student, hit.via);            // 不攔截：讓這個真的 Enter 送給系統
      return;
    }

    // 書籍欄輸入學生 → 自動改送讀者證號欄（此長度曾是書號就當書，避免誤判）
    const looksLikeBook = S.bookLens.has(raw.length) && !(hit && hit.via === '座號');
    if (hit && hit.student && !looksLikeBook) {
      block(e);
      setValue(book, '');
      const id = readerId(hit.student);
      if (!id) { warn(`${hit.student.name} 沒有${idLabel()}資料`); return; }
      setValue(reader, id);
      reader.focus();
      pressEnter(reader);
      startReader(hit.student, hit.via);
      return;
    }
    if (hit && hit.error && raw.length <= 2) { block(e); warn(hit.error); focusEl(book, true); return; }

    // 一般書號
    if (/^\d{3,}$/.test(raw) || /^[A-Z0-9]{5,}$/i.test(raw) && !/^(A{5,6}|B{5,6})$/i.test(raw)) {
      if (S.current && S.current.state === 'mismatch') {
        block(e); setValue(book, '');
        warn(`系統上的讀者不是 ${S.current.st.name}，這本書沒有借出`);
        return;
      }
      const before = resultLine();
      setTimeout(() => checkScanResult(before, raw), 700);
    }
  }

  function block(e) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'keydown') S.swallow.add(e.code || e.key);
  }
  // 系統（AngularJS ng-keyup）在 keyup 才處理 Enter：被攔下的按鍵，keypress / keyup 也要一起攔
  const eatUp = (e) => {
    if (!e.isTrusted) return;
    const k = e.code || e.key;
    if (!S.swallow.has(k)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'keyup') S.swallow.delete(k);
  };
  document.addEventListener('keypress', eatUp, true);
  document.addEventListener('keyup', eatUp, true);

  // 游標位置決定大字區：讀者欄＝先隱藏等待；書籍欄（且這一輪沒輸入讀者）＝還書中
  document.addEventListener('focusin', (e) => {
    const { reader, book } = inputs();
    if (!reader) return;
    if (e.target === reader) {
      if (S.ctx !== 'idle') { S.ctx = 'idle'; S.ret = null; renderBig(); }
    } else if (e.target === book) {
      if (S.ctx === 'idle') { S.ctx = 'return'; S.current = null; renderPanel(); renderBig(); }
    }
  }, true);

  function doAction(act) {
    const { book } = inputs();
    if (act === 'next') { nextReader(); speak('下一位', false, 'sayNextKey'); }
    else if (act === 'book') {
      S.ctx = 'return'; S.ret = null;
      if (S.current && S.current.state !== 'mismatch') S.current = null;
      focusEl(book, true); renderPanel(); renderBig();
      speak('還書', false, 'sayBookKey');
    }
    else if (act === 'recess') toggleRecess();
    else if (act === 'pickClass') { nextReader(); S.picking = ''; renderBig(); speak('請輸入班級', false, 'sayModeSwitch'); }
  }

  function onPickKey(e) {
    block(e);
    const d = e.code.match(/^(?:Numpad|Digit)(\d)$/);
    if (d) { S.picking += d[1]; renderBig(); return; }
    if (e.key === 'Backspace') { S.picking = S.picking.slice(0, -1); renderBig(); return; }
    if (e.key === 'Escape' || e.code === 'NumpadDivide' || e.code === 'NumpadSubtract') { S.picking = null; renderBig(); speak('取消', false, 'sayModeSwitch'); return; }
    if (e.key === 'Enter') {
      const buf = S.picking; S.picking = null;
      if (!buf || buf === '0') { setMode(''); return; }
      const c = S.classes.find((x) => `${x.grade}${x.cls}` === buf || `${x.grade}${pad2(x.cls)}` === buf);
      if (c) setMode(c.key); else { warn(`沒有班級 ${buf}`); }
    }
  }

  function setMode(key) {
    const prev = S.classMode;
    if (prev && prev !== key) S.lastClass = prev;
    S.classMode = key;
    chrome.storage.local.set({ classMode: key, lastClass: S.lastClass });
    speak(key ? `${classLabel(key)}，請輸入座號` : '下課模式', false, 'sayModeSwitch');
    nextReader();
  }

  function toggleRecess() {
    if (S.classMode) setMode('');
    else if (S.lastClass && S.byClass.has(S.lastClass)) setMode(S.lastClass);
    else speak('下課模式', false, 'sayModeSwitch');
  }

  function rememberBookLen(n) {
    if (S.bookLens.has(n)) return;
    S.bookLens.add(n);
    chrome.storage.local.set({ bookLens2: [...S.bookLens] });
  }

  function nextReader() {
    const { reader, book } = inputs();
    if (book) setValue(book, '');
    S.current = null; S.msg = null; S.ret = null;
    clearInterval(S.pollTimer);
    renderPanel(); renderBig();
    focusEl(reader, true);
  }

  // ---------- 讀者確認：比對系統畫面上的讀者姓名 ----------
  // 掃書後讀系統訊息：還書（○○ 已歸還 排架號 N）→ 大字區改顯示還書結果，不再顯示舊讀者
  function resultLine() {
    return document.body.innerText.split('\n').find((l) => /已歸還\s*排架號|已借出/.test(l) && !/【/.test(l)) || '';
  }
  function checkScanResult(before, bookNo) {
    const line = resultLine();
    if (line !== before && /已借出|已歸還/.test(line) && /^\d{3,}$/.test(bookNo || '')) rememberBookLen(bookNo.length);
    const m = line.match(/^\s*(.*?)\s*已歸還\s*(?:排架號\s*(\S+))?/);
    if (m && line !== before) {
      clearInterval(S.pollTimer);
      S.current = null;
      // 系統訊息的書名太長會被截斷，優先用下方清單裡同一個登錄號的完整書名
      const title = rowTitle(bookNo) || m[1].trim().replace(/\.{3}$|…$/, '');
      S.ret = { title, shelf: m[2] || '' };
      S.ctx = 'return';
      renderPanel(); renderBig();
      speak(`已歸還，${title}`, false, 'sayReturn');            // 不排隊：連續快速還書時直接打斷上一句
      return;
    }
    if (S.current) afterBookScan();
  }

  function rowTitle(no) {
    if (!no) return '';
    const td = [...document.querySelectorAll('td')].find((x) => x.textContent.trim() === no);
    const cell = td && td.nextElementSibling;
    return cell ? cell.textContent.replace(/[【\[]\s*已歸還\s*[】\]]/, '').trim() : '';
  }

  function startReader(st, via) {
    S.ret = null;
    S.ctx = 'borrow';
    S.current = { st, via, state: 'pending', pageName: '', quota: null, overdue: null };
    S.msg = null;
    renderPanel(); renderBig();
    speak(speechText(st), false, 'sayName');
    clearInterval(S.pollTimer);
    const t0 = Date.now();
    let announced = false;
    S.pollTimer = setInterval(() => {
      const cur = S.current;
      if (!cur || cur.st !== st) { clearInterval(S.pollTimer); return; }
      const info = readPageInfo();
      const elapsed = Date.now() - t0;
      if (info.name === st.name) {
        clearInterval(S.pollTimer);
        Object.assign(cur, { state: 'ok', pageName: info.name, quota: info.quota, overdue: info.overdue });
        if (info.overdue > 0) {
          const titles = overdueBooks().map((b) => b.title).slice(0, 2);
          speak(`有 ${info.overdue} 本逾期未還${titles.length ? '：' + titles.join('、') : ''}，請盡快歸還`, true, 'sayOverdue');
        }
        const { book } = inputs();
        if (info.quota === 0) watchFull();                  // 已借滿：依工作模式決定游標位置
        else if (book && document.activeElement !== book) focusEl(book, true);
        renderPanel(); renderBig();
      } else if (elapsed > 4000 && cur.state !== 'mismatch') {
        cur.state = 'mismatch'; cur.pageName = info.name;
        if (!announced) { speak('讀者不符，請確認', true, 'sayWarn'); announced = true; focusEl(inputs().reader); }
        renderPanel(); renderBig();
      }
      if (elapsed > 12000) clearInterval(S.pollTimer);   // 12 秒內系統若補上正確讀者仍會轉為正常
    }, 300);
  }

  function afterBookScan() {
    if (!S.current || S.current.state !== 'ok') return;
    const info = readPageInfo();
    if (info.quota == null || info.name !== S.current.st.name) return;
    S.current.quota = info.quota; S.current.overdue = info.overdue;
    renderPanel();
    watchFull();
  }

  // 系統畫面顯示「尚可借閱 0」時（不論是查讀者時就借滿，或掃書掃到借滿）
  // 連續借書：唸出並把游標停在讀者證號欄；借還書：只唸出，游標留在書籍欄方便還書
  function watchFull() {
    const { reader } = inputs();
    if (!reader) return;
    const info = readPageInfo();
    if (S.current && S.current.state === 'ok' && info.name && info.name !== S.current.st.name) {
      S.current = null; renderPanel(); renderBig();
    }
    const key = info.name && info.quota === 0 ? info.name : '';
    if (!key) { S.fullKey = ''; return; }
    if (S.fullKey === key) return;
    S.fullKey = key;
    if (S.current && S.current.st.name === key) { S.current.quota = 0; renderPanel(); }
    if (S.workMode === 'continuous') {
      speak('已借滿，請換下一位', true, 'sayFull');
      focusEl(reader, true);
    } else speak('已經借滿', true, 'sayFull');
  }

  function setWorkMode(m) {
    S.workMode = m;
    chrome.storage.local.set({ workMode: m });
    speak(m === 'continuous' ? '連續借書' : '借還書', false, 'sayModeSwitch');
    S.fullKey = '';
    renderPanel(); renderBig();
    if (m === 'mixed') { const { book } = inputs(); focusEl(book, true); } else watchFull();
  }

  function readPageInfo() {
    const txt = document.body.innerText;
    const num = (re) => { const m = txt.match(re); return m ? Number(m[1]) : null; };
    const nm = txt.match(/讀者姓名\s*[:：]\s*(\S+)/);
    return { name: nm ? nm[1] : '', quota: num(/尚可借閱\s*[:：]\s*(\d+)/), overdue: num(/逾期未還冊數\s*[:：]\s*(\d+)/) };
  }

  function speak(text, enqueue, key) {
    if (key && !S.settings[key]) return;
    chrome.runtime.sendMessage({ type: 'speak', text, rate: S.settings.speakRate, enqueue: !!enqueue });
  }

  function warn(msg) {
    showMsg(msg, 'warn', 4000);
    speak(msg, false, 'sayWarn');
    try {
      const ctx = new AudioContext(); const o = ctx.createOscillator();
      o.frequency.value = 330; o.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
    } catch (_) {}
  }

  function showMsg(text, kind, ms) {
    S.msg = { text, kind };
    renderBig(); renderPanel();
    clearTimeout(showMsg.t);
    showMsg.t = setTimeout(() => { S.msg = null; renderBig(); renderPanel(); }, ms || 3000);
  }

  function speechText(st) {
    return S.settings.speakMode === 'class' ? `${st.className || ''}${st.seat}號，${st.name}` : st.name;
  }

  function bigText(st) {
    return S.settings.bigFormat === 'long'
      ? `${st.grade}年${clsShort(st)}班${st.name}`
      : `${st.grade}${clsShort(st)}${st.name}`;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- 操作面板 ----------
  let host, root;
  const CSS = `
    :host{all:initial}
    .p{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;font-family:"Microsoft JhengHei","PingFang TC",sans-serif;
       background:#fff;border:2px solid #2b7bb9;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);color:#222;font-size:14px}
    .hd{display:flex;align-items:center;justify-content:space-between;background:#2b7bb9;color:#fff;padding:6px 10px;border-radius:9px 9px 0 0;font-weight:bold;cursor:pointer}
    .hd span{font-size:12px;font-weight:normal;opacity:.9}
    .bd{padding:10px}
    .min .bd{display:none}
    .mrow{display:flex;gap:6px}
    .wm{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:8px;border:2px solid #2b7bb9;border-radius:10px;overflow:hidden}
    .wm button{border:none;border-radius:0;font-size:18px;font-weight:bold;padding:10px 2px;background:#fff;color:#2b7bb9}
    .wm button.act{background:#2b7bb9;color:#fff}
    .wm button.act.mx{background:#e67e22}
    .wm button + button{border-left:2px solid #2b7bb9}
    select{flex:1;min-width:0;font-size:15px;padding:6px;border-radius:6px;border:1px solid #aaa;font-family:inherit}
    .mode{margin-top:6px;padding:6px 8px;border-radius:6px;font-size:13px;background:#eef6fb;color:#1d5f8f}
    .mode.cls{background:#fff4d6;color:#8a5a00;font-weight:bold}
    .cur{margin:10px 0;padding:8px;border-radius:8px;background:#f4f8f4;text-align:center;min-height:56px;font-size:13px;color:#555;line-height:1.6}
    .cur b{font-size:20px;color:#1a4d8f}
    .bad{color:#c0392b;font-weight:bold}.ok{color:#27864a;font-weight:bold}
    .btns{display:grid;grid-template-columns:1fr 2fr;gap:6px}
    button{font-family:inherit;font-size:14px;padding:7px 2px;border-radius:8px;border:1px solid #2b7bb9;background:#fff;color:#2b7bb9;cursor:pointer;line-height:1.2}
    button.pri{background:#2b7bb9;color:#fff}
    button.rec{flex:none;padding:6px 8px;background:#fff4d6;border-color:#d9a400;color:#8a5a00;font-weight:bold}
    button.rec.on{background:#eef6fb;border-color:#9bc3df;color:#1d5f8f;font-weight:normal}
    kbd{display:inline-block;min-width:14px;padding:0 4px;margin-left:4px;border:1px solid currentColor;border-radius:4px;font-size:13px;font-weight:bold;line-height:16px;font-family:Consolas,monospace}
    .ft{margin-top:8px;font-size:12px;color:#777;display:flex;justify-content:space-between;align-items:center}
    .ft a{color:#2b7bb9;cursor:pointer;text-decoration:underline}
  `;

  function ensurePanel() {
    const { reader } = inputs();
    if (!reader) { if (host) host.style.display = 'none'; if (bigHost) bigHost.style.display = 'none'; return; }
    if (!host) {
      host = document.createElement('div');
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="p">
          <div class="hd" id="hd">📚 借書小幫手 <span>點這裡收合</span></div>
          <div class="bd">
            <div class="wm"><button id="wmC">📚 連續借書</button><button id="wmM">🔄 借還書</button></div>
            <div class="mrow"><select id="sel"></select><button id="rec" class="rec">下課<kbd>−</kbd></button></div>
            <div class="mode" id="mode"></div>
            <div class="cur" id="cur"></div>
            <div class="btns">
              <button id="next" class="pri">下一位<kbd>+</kbd></button>
              <button id="bk">掃書／還書<kbd>.</kbd><kbd>*</kbd></button>
            </div>
            <div class="ft"><span id="info"></span><a id="opt">名單／設定</a></div>
            <div class="ft"><span>選班：<kbd>/</kbd> 班級代碼 Enter（例 / 203）</span></div>
          </div>
        </div>`;
      document.documentElement.appendChild(host);
      const $ = (id) => root.getElementById(id);
      $('hd').onclick = () => { $('hd').parentElement.classList.toggle('min'); layoutBig(); };
      $('sel').onchange = (e) => setMode(e.target.value);
      $('rec').onclick = () => toggleRecess();
      $('wmC').onclick = () => setWorkMode('continuous');
      $('wmM').onclick = () => setWorkMode('mixed');
      $('next').onclick = () => doAction('next');
      $('bk').onclick = () => doAction('book');
      $('opt').onclick = () => chrome.runtime.sendMessage({ type: 'openOptions' });
      renderPanel();
    }
    host.style.display = '';
    ensureBig();
  }

  function renderPanel() {
    if (!root) return;
    const $ = (id) => root.getElementById(id);
    let html = '<option value="">🔔 下課模式（全校：胸號／學號）</option>';
    let g = 0;
    for (const c of S.classes) {
      if (c.grade !== g) { if (g) html += '</optgroup>'; g = c.grade; html += `<optgroup label="${CN_NUM[g] || g}年級">`; }
      html += `<option value="${c.key}">📖 ${c.label}（輸入座號）</option>`;
    }
    if (g) html += '</optgroup>';
    $('sel').innerHTML = html;
    $('sel').value = S.classMode;
    $('wmC').className = S.workMode === 'continuous' ? 'act' : '';
    $('wmM').className = S.workMode === 'mixed' ? 'act mx' : '';
    const rec = $('rec');
    rec.className = 'rec' + (S.classMode ? '' : ' on');
    rec.innerHTML = S.classMode ? '下課<kbd>−</kbd>' : (S.lastClass ? '回班級<kbd>−</kbd>' : '下課中');
    const c = S.classes.find((x) => x.key === S.classMode);
    $('mode').className = 'mode' + (c ? ' cls' : '');
    $('mode').textContent = c ? `班級模式：${c.label}，輸入座號 1～${Math.max(...S.byClass.get(c.key).keys())}`
                              : '下課模式：輸入胸號或掃學生條碼';
    $('info').textContent = S.students.length
      ? `名單 ${S.students.length} 人・證號用${idLabel()}・v${chrome.runtime.getManifest?.().version || ''}` : '⚠ 尚未匯入名單';

    const el = $('cur');
    if (!S.current) {
      el.innerHTML = S.msg ? esc(S.msg.text)
        : S.ret ? `<span class="ok">✔ 已歸還：${esc(S.ret.title)}</span><br>排架號 <b>${esc(S.ret.shelf)}</b>`
        : '等待下一位讀者…';
      return;
    }
    const { st, via, state, quota, overdue, pageName } = S.current;
    const id = S.settings.readerIdType === 'pid' ? maskPid(st.pid) : st.sid;
    let status = '系統查詢中…';
    if (state === 'ok') status = (quota === 0 ? '<span class="bad">已借滿</span>' : `<span class="ok">尚可借 ${quota ?? '?'} 本</span>`)
                                + (overdue > 0 ? `・<span class="bad">逾期 ${overdue} 本</span>` : '');
    if (state === 'mismatch') status = `<span class="bad">⚠ 系統顯示：${esc(pageName || '（無讀者）')}</span>`;
    el.innerHTML = `<b>${esc(st.name)}</b>　${esc(st.className || '')} ${st.seat} 號<br>
      胸號 ${st.chest}・${idLabel()} ${esc(id)}（${via}）<br>${status}`;
  }

  // ---------- 超大字確認區（表格下方空白處，自動填滿） ----------
  let bigHost, bigRoot;
  function ensureBig() {
    if (!bigHost) {
      bigHost = document.createElement('div');
      bigRoot = bigHost.attachShadow({ mode: 'open' });
      bigRoot.innerHTML = `<style>
        :host{all:initial}
        .b{position:fixed;z-index:2147483646;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden;
           border-radius:12px;font-family:"Microsoft JhengHei","PingFang TC",sans-serif;font-weight:900;line-height:1;white-space:nowrap;box-sizing:border-box}
        .b.idle{background:rgba(0,0,0,.03);border:2px dashed #c9d6df;color:#9aaab5;font-weight:bold}
        .b.ok{background:#fff200;color:#111;border:4px solid #e0c800}
        .b.pending{background:#fff9b0;color:#333;border:4px dashed #e0c800}
        .b.bad{background:#c0392b;color:#fff;border:4px solid #922}
        .b.pick{background:#1d5f8f;color:#fff}
        .b.info{background:#eef6fb;color:#1d5f8f;border:2px solid #9bc3df}
        .rt{color:#5a3fd0}
        .b.retmode{background:#fff200;color:#5a3fd0;border:4px solid #e0c800;letter-spacing:.3em}
        span{display:inline-block}
      </style><div class="b idle" id="b"><span id="t"></span></div>`;
      document.documentElement.appendChild(bigHost);
      window.addEventListener('resize', layoutBig);
      window.addEventListener('scroll', layoutBig, true);
      renderBig();
    }
    layoutBig();
  }

  function renderBig() {
    if (!bigRoot) return;
    const b = bigRoot.getElementById('b'), t = bigRoot.getElementById('t');
    let cls = 'idle', text = '', show = false;
    const st = S.settings;
    if (S.picking != null) { cls = 'pick'; text = `選班級：${S.picking || '＿'}`; show = true; }
    else if (S.msg && S.msg.kind === 'warn') { cls = 'bad'; text = S.msg.text; show = st.showWarnBig; }
    else if (S.current && S.current.state === 'mismatch') {
      cls = 'bad'; text = `⚠ 系統是「${S.current.pageName || '無讀者'}」不是 ${S.current.st.name}`; show = st.showWarnBig;
    } else if (S.ctx === 'borrow' && S.current) {
      cls = S.current.state === 'ok' ? 'ok' : 'pending'; text = bigText(S.current.st); show = st.showReaderBig && st.bigFormat !== 'off';
    } else if (S.ctx === 'return' && S.ret) { cls = 'ok'; text = null; show = st.showReturnBig; }
    else if (S.ctx === 'return') { cls = 'retmode'; text = '還書中'; show = st.showReturnMode; }
    else if (S.msg && S.ctx !== 'idle') { cls = 'info'; text = S.msg.text; show = true; }
    b.className = 'b ' + cls;
    if (text === null) t.innerHTML = `<span class="rt">【已歸還】</span>${esc(S.ret.title)}`;
    else t.textContent = text;
    b.dataset.idle = cls === 'idle' || cls === 'info' ? '1' : '';
    b.dataset.wrap = text === null ? '1' : '';
    b.dataset.off = show ? '' : '1';
    layoutBig();
  }

  function layoutBig() {
    if (!bigHost || bigHost.style.display === 'none') return;
    const b = bigRoot.getElementById('b');
    const visible = (el) => { const r = el && el.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; };
    const { reader, book } = inputs();
    const th = [...document.querySelectorAll('th,td')].find((x) => x.textContent.trim() === '館藏登錄號');
    const tableR = visible(th && th.closest('table'));
    const inR = visible(book) || visible(reader);
    const panel = host?.shadowRoot.querySelector('.p')?.getBoundingClientRect();
    let left, right, top;
    if (tableR && tableR.width >= 500 && (!inR || tableR.top > inR.bottom)) {
      // 系統有顯示讀者與書單：放在書單表格下方
      left = tableR.left; right = tableR.right; top = tableR.bottom + 8;
    } else if (inR) {
      // 沒有讀者（表格隱藏）：放在兩個輸入欄下方，用整個內容區寬度
      left = Math.max(8, inR.left - 140); right = window.innerWidth - 16; top = inR.bottom + 40;
    }
    if (panel && panel.width && right != null) right = Math.min(right, panel.left - 12);
    const bottom = window.innerHeight - 8;
    if (top != null && bottom - top < 140) top = bottom - 140;
    const W = right - left, H = bottom - top;
    // 算不出像樣的空間（找不到欄位、太窄）就不顯示，避免出現直立的怪框
    const bad = !inR || !(W >= 480) || !(H >= 100);
    b.style.visibility = bad || b.dataset.off ? 'hidden' : 'visible';
    if (!bad) Object.assign(b.style, { left: left + 'px', top: top + 'px', width: W + 'px', height: H + 'px' });
    fitBig();
  }

  function fitBig() {
    if (!bigRoot) return;
    const b = bigRoot.getElementById('b'), t = bigRoot.getElementById('t');
    const W = b.clientWidth, H = b.clientHeight;
    if (!W || !H) return;
    t.style.whiteSpace = ''; t.style.width = ''; t.style.lineHeight = '';
    if (b.dataset.wrap) {                        // 還書書名較長：允許換行，找出放得下的最大字
      Object.assign(t.style, { whiteSpace: 'normal', width: W * 0.94 + 'px', lineHeight: '1.15', textAlign: 'center' });
      let lo = 14, hi = H * 0.8;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        t.style.fontSize = mid + 'px';
        if (t.scrollHeight <= H * 0.92 && t.scrollWidth <= W * 0.95) lo = mid; else hi = mid;
      }
      t.style.fontSize = lo + 'px';
      return;
    }
    t.style.fontSize = '100px';
    const w = t.scrollWidth || 1;
    let fs = Math.min(100 * (W * 0.94) / w, H * 0.8);
    if (b.dataset.idle) fs = Math.min(fs, 40);
    t.style.fontSize = Math.max(14, fs) + 'px';
  }

  // ---------- 逾期書名提示框（預約記錄下方空白處） ----------
  function overdueBooks() {
    const th = [...document.querySelectorAll('th,td')].find((x) => x.textContent.trim() === '館藏登錄號');
    const table = th && th.closest('table');
    if (!table) return [];
    const heads = [...th.parentElement.children].map((x) => x.textContent.trim());
    const ci = (name) => heads.findIndex((h) => h.includes(name));
    const iNo = ci('館藏登錄號'), iTitle = ci('書名'), iDue = ci('到期'), iRet = ci('歸還');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = [];
    for (const tr of table.querySelectorAll('tr')) {
      const td = [...tr.children];
      if (td.length < 3 || td[0].tagName === 'TH' || td === th.parentElement) continue;
      const txt = (i) => (i >= 0 && td[i] ? td[i].textContent.trim() : '');
      if (!txt(iNo) || txt(iNo) === '館藏登錄號') continue;
      if (txt(iRet)) continue;                                   // 已歸還
      const m = txt(iDue).match(/(\d{2,4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      let late = false, days = 0, dueText = '';
      if (m) {
        const y = Number(m[1]) < 1911 ? Number(m[1]) + 1911 : Number(m[1]);
        const due = new Date(y, Number(m[2]) - 1, Number(m[3]));
        days = Math.round((today - due) / 86400000);
        late = days > 0; dueText = `${Number(m[2])}/${Number(m[3])}`;
      } else {
        const c = getComputedStyle(td[iTitle] || td[0]).color.match(/\d+/g) || [];
        late = Number(c[0]) > 170 && Number(c[1]) < 90 && Number(c[2]) < 90;   // 系統用紅字標示
      }
      if (late) out.push({ no: txt(iNo), title: txt(iTitle) || txt(iNo), due: dueText, days });
    }
    return out;
  }

  let odHost, odRoot;
  function updateOverdue() {
    const { reader } = inputs();
    const info = reader ? readPageInfo() : {};
    const has = reader && info.name && info.quota != null;
    const list = has && S.settings.showOverdue && info.overdue > 0 ? overdueBooks() : [];
    const on = has && (list.length || S.settings.showQuota);
    if (!on) { if (odHost) odHost.style.display = 'none'; return; }
    if (!odHost) {
      odHost = document.createElement('div');
      odRoot = odHost.attachShadow({ mode: 'open' });
      odRoot.innerHTML = `<style>
        :host{all:initial}
        .o{position:fixed;z-index:2147483645;pointer-events:none;box-sizing:border-box;background:#fff;border:4px solid #e00;border-radius:6px;
           padding:8px 14px;font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#c00;overflow:hidden;line-height:1.35}
        .h{font-weight:900}.i{font-weight:bold;color:#222}.i small{color:#c00;font-weight:bold}
        .o.q{border-color:#27864a;color:#1e6b3b;display:flex;align-items:center;justify-content:center;font-weight:900;white-space:nowrap}
        .o.q.zero{border-color:#e08a00;color:#b36b00}
      </style><div class="o" id="o"></div>`;
      document.documentElement.appendChild(odHost);
    }
    odHost.style.display = '';
    const o = odRoot.getElementById('o');
    const sig = JSON.stringify([list, info.quota]);
    if (o.dataset.sig !== sig) {
      o.dataset.sig = sig;
      if (list.length) {
        o.className = 'o';
        o.innerHTML = `<div class="h">⚠ 逾期未還 ${list.length} 本，請趕快歸還！</div>`
          + list.map((b) => `<div class="i">📕 ${esc(b.title)}${b.due ? ` <small>（到期 ${b.due}${b.days > 0 ? `，逾期 ${b.days} 天` : ''}）</small>` : ''}</div>`).join('');
      } else {
        o.className = 'o q' + (info.quota === 0 ? ' zero' : '');
        o.innerHTML = info.quota === 0 ? '<span>已借滿，不能再借</span>' : `<span>還可借 ${info.quota} 本</span>`;
      }
    }
    // 位置：「預約記錄」標題下方到「逾期未還冊數」那一列上方
    // 取「最內層」的元素（外層容器可能整塊撐高，位置會不準）
    const innermost = (re) => [...document.querySelectorAll('body *')]
      .filter((x) => x.children.length <= 2 && re.test(x.textContent.trim()) && x.getBoundingClientRect().height > 0)
      .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    const hd = innermost(/^[^\u4e00-\u9fff]*預約記錄$/);
    const stat = innermost(/^[^\u4e00-\u9fff]*逾期未還冊數/);
    const th = [...document.querySelectorAll('th,td')].find((x) => x.textContent.trim() === '館藏登錄號');
    const tableR = th?.closest('table')?.getBoundingClientRect();
    const panel = host?.shadowRoot.querySelector('.p')?.getBoundingClientRect();
    const hr0 = hd?.getBoundingClientRect();
    const hr = hr0 && hr0.width > 0 ? hr0 : null;
    let left = hr ? hr.left - 150 : (tableR ? tableR.left + tableR.width * 0.4 : 500);
    let right = tableR ? tableR.right : window.innerWidth - 20;
    if (panel && panel.width && panel.top < (stat?.getBoundingClientRect().top ?? 400)) right = Math.min(right, panel.left - 12);
    const { reader: rd } = inputs();
    left = Math.max(left, (rd?.getBoundingClientRect().right ?? 0) + 160);
    const top = hr ? hr.bottom + 10 : 150;
    let bottom = Math.min(stat ? stat.getBoundingClientRect().top - 10 : Infinity, tableR ? tableR.top - 10 : Infinity);
    if (!isFinite(bottom)) bottom = top + 160;
    if (bottom - top < 70) bottom = top + 70;
    if (!hr || right - left < 220) { odHost.style.display = 'none'; return; }   // 找不到「預約記錄」位置就不顯示
    Object.assign(o.style, { left: left + 'px', top: top + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
    // 字體縮放到剛好放得下
    let fs = list.length ? Math.min(30, (bottom - top - 20) / (list.length + 1) / 1.35) : Math.min(90, (bottom - top) * 0.6);
    o.style.fontSize = fs + 'px';
    while (fs > 12 && (o.scrollHeight > o.clientHeight + 1 || o.scrollWidth > o.clientWidth + 1)) { fs -= 1; o.style.fontSize = fs + 'px'; }
  }

  // 單頁式網站：持續偵測借還書頁面，並追蹤表格位置
  setInterval(() => { ensurePanel(); layoutBig(); updateOverdue(); watchFull(); }, 700);
  load().then(ensurePanel);
  chrome.runtime.sendMessage({ type: 'syncIfStale' }).catch(() => {});
})();
