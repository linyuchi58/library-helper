const $ = (id) => document.getElementById(id);
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CLS_CHAR = '甲乙丙丁戊己庚辛壬癸';
let parsed = null;   // 匯入後、尚未儲存的名單

// ---------- 目前名單 ----------
async function showCurrent() {
  const { students = [], meta = {} } = await chrome.storage.local.get(['students', 'meta']);
  if (!students.length) { $('cur').className = 'msg err'; $('cur').textContent = '尚未匯入名單。'; return; }
  const st = await getSettings();
  const useP = st.readerIdType === 'pid';
  const noSid = students.filter((s) => !(useP ? s.pid : s.sid)).length;
  const classes = new Set(students.map((s) => s.grade + '-' + s.cls)).size;
  $('cur').className = 'msg ' + (noSid ? 'err' : 'ok');
  $('cur').textContent = `共 ${students.length} 位學生、${classes} 個班，胸號例：${students[0].chest}（${students[0].className} ${students[0].seat} 號）。`
    + `\n來源：${meta.source || '—'}　更新：${meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('zh-TW') : '—'}`
    + `\n讀者證號使用：${useP ? '身分證字號' : '學號'}`
    + (noSid ? `\n⚠ 有 ${noSid} 位學生沒有${useP ? '身分證字號' : '學號'}，這些學生無法自動帶入讀者證號。` : '');
}

$('q').oninput = async () => {
  const v = $('q').value.trim();
  if (!v) { $('qr').textContent = ''; return; }
  const { students = [] } = await chrome.storage.local.get('students');
  const V = v.toUpperCase();
  const s = students.find((x) => x.chest === v || x.sid === v || x.pid === V);
  $('qr').textContent = s ? `→ ${s.className} ${s.seat} 號 ${s.name}（學號 ${s.sid || '無'}・身分證 ${maskPid(s.pid) || '無'}）` : '→ 查無資料';
};

$('exportCsv').onclick = async () => {
  const { students = [] } = await chrome.storage.local.get('students');
  const lines = [HEADER, ...studentsToRows(students)].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '借書小幫手名單.csv'; a.click();
};

// ---------- 匯入 ----------
$('file').onchange = () => doParse();
$('importRule').onchange = () => { $('tplBox').style.display = $('importRule').value === 'custom' ? '' : 'none'; saveSettings(); doParse(); };
$('customTpl').onchange = () => { saveSettings(); doParse(); };
$('tplCsv').onclick = () => {
  const csv = '\uFEFF學號,身分證字號,姓名,年級,班序,座號,胸號（選填）\r\n115003,,王小明,1,1,1,\r\n115014,,陳小華,2,3,13,\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = '借書小幫手_名冊範本.csv'; a.click();
};

async function doParse() {
  const f = $('file').files[0];
  if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
    parsed = parseRoster(aoa, $('importRule').value, $('customTpl').value.trim().toUpperCase());
    parsed.source = f.name;
    renderParsed();
  } catch (e) {
    parsed = null;
    msg('impMsg', 'err', '讀取失敗：' + e.message);
    $('preview').innerHTML = '';
    $('save').disabled = $('saveUp').disabled = true;
  }
}

function parseRoster(aoa, rule, customTpl) {
  const hi = aoa.slice(0, 15).findIndex((r) => r.some((c) => String(c).includes('姓名')));
  if (hi < 0) throw new Error('找不到「姓名」欄位的標題列');
  const H = aoa[hi].map((c) => String(c).replace(/\s/g, ''));
  const col = (re) => H.findIndex((h) => re.test(h));
  const C = {
    name: col(/姓名/),
    sid: [col(/借書證號|讀者證號/), col(/學號/), col(/證號/)].find((i) => i >= 0) ?? -1,
    chest: col(/^胸號/),
    pid: col(/身分證|身份證|統一編號|統編/),
    grade: col(/^年級/),
    classNum: col(/^班級[（(]?(數字|代碼|代號|編號)|^班級代|^班碼/),
    classSeat: col(/班級座號/),
    seat: col(/^座號/),
    classSeq: col(/^班序|^班別/),
    className: col(/^班級(名稱)?$/)
  };
  const num = (r, i) => { if (i < 0) return NaN; const v = String(r[i]).trim(); return /^\d+(\.0+)?$/.test(v) ? Number(v) : NaN; };
  const warnings = [];
  const list = [];
  let skipped = 0;

  for (const r of aoa.slice(hi + 1)) {
    const name = C.name >= 0 ? String(r[C.name]).trim() : '';
    if (!name) continue;
    let g = num(r, C.grade), cls = num(r, C.classSeq), seat = num(r, C.seat);
    const cn = num(r, C.classNum), cs = num(r, C.classSeat);
    if (!isNaN(cn) && isNaN(cls)) {
      if (!isNaN(g) && cn >= g * 100 && cn < (g + 1) * 100) cls = cn - g * 100;
      else if (cn >= 100) { if (isNaN(g)) g = Math.floor(cn / 100); cls = cn % 100; }
    }
    if (!isNaN(cs)) {
      if (isNaN(seat)) seat = cs % 100;
      const rest = Math.floor(cs / 100);
      if (isNaN(g)) g = Math.floor(rest / 100);
      if (isNaN(cls)) cls = rest % 100;
    }
    const cname = C.className >= 0 ? String(r[C.className]).trim() : '';
    if ((isNaN(g) || isNaN(cls)) && cname) {
      const m = cname.match(/^([一二三四五六七八九\d])年([甲乙丙丁戊己庚辛壬癸]|\d+)班?/);
      if (m) {
        if (isNaN(g)) g = /\d/.test(m[1]) ? Number(m[1]) : CN.indexOf(m[1]);
        if (isNaN(cls)) cls = /\d/.test(m[2]) ? Number(m[2]) : CLS_CHAR.indexOf(m[2]) + 1;
      }
    }
    if ([g, cls, seat].some((x) => isNaN(x) || x <= 0)) { skipped++; continue; }
    let sid = C.sid >= 0 ? String(r[C.sid]).trim().replace(/\.0+$/, '') : '';
    const chestCol = C.chest >= 0 ? String(r[C.chest]).trim().replace(/\.0+$/, '') : '';
    const pid = C.pid >= 0 ? String(r[C.pid]).trim().toUpperCase() : '';
    list.push({ grade: g, cls, seat, name, sid, pid, chestCol, className: cname || `${CN[g] || g}年${CLS_CHAR[cls - 1] || cls}班` });
  }
  if (!list.length) throw new Error(skipped
    ? `有 ${skipped} 位學生判斷不出年級／班序／座號。若班名是「忠、孝、仁、愛」這類文字，請在名冊加上「班序」或「班級代碼（例 203）」欄。`
    : '沒有讀到任何學生，請確認標題列有「姓名」欄。');

  const maxCls = Math.max(...list.map((s) => s.cls));
  const colFilled = list.filter((s) => s.chestCol).length;
  let mode = rule;
  if (rule === 'auto') mode = colFilled >= list.length * 0.9 ? 'col' : (maxCls >= 10 ? 'GCCSS' : 'GCSS');
  if (mode === 'col' && !colFilled) throw new Error('名冊裡沒有「胸號」欄（或是空的），請改選其他胸號規則');
  if (mode === 'custom') {
    if (!/^(GG|G|CC|C|SS|S|[0-9-])+$/.test(customTpl) || !/G/.test(customTpl) || !/S/.test(customTpl))
      throw new Error('自訂格式不正確，需包含年級（G）與座號（S），例如 GCSS');
    mode = customTpl;
  }
  let fallback = 0;
  for (const s of list) {
    if (mode === 'col') {
      s.chest = s.chestCol || formatChest(maxCls >= 10 ? 'GCCSS' : 'GCSS', s);
      if (!s.chestCol) fallback++;
    } else s.chest = formatChest(mode, s);
    delete s.chestCol;
  }
  const ruleLabel = mode === 'col' ? '使用名冊「胸號」欄' : `格式 ${mode}（例：${list[0].chest}）`;
  if (fallback) warnings.push(`有 ${fallback} 位學生的胸號欄是空的，已依年級班序座號自動產生。`);
  if (!/CC/.test(mode) && mode !== 'col' && maxCls >= 10) warnings.push(`有年級超過 9 個班（最多 ${maxCls} 班），班序只用 1 碼會造成胸號重複，建議改用 5 碼（GCCSS）。`);
  const dup = (key) => {
    const seen = new Map(), d = [];
    for (const s of list) { const k = s[key]; if (!k) continue; if (seen.has(k)) d.push(`${k}（${seen.get(k).name}／${s.name}）`); else seen.set(k, s); }
    return d;
  };
  const dChest = dup('chest'), dSid = dup('sid'), dPid = dup('pid');
  if (dPid.length) warnings.push(`身分證字號重複 ${dPid.length} 筆：${dPid.slice(0, 3).map((x) => x.replace(/^[A-Z]\d{9}/, maskPid)).join('、')}`);
  if (dChest.length) warnings.push(`胸號重複 ${dChest.length} 筆：${dChest.slice(0, 5).join('、')}`);
  if (dSid.length) warnings.push(`學號重複 ${dSid.length} 筆：${dSid.slice(0, 5).join('、')}`);
  const noSid = list.filter((s) => !s.sid).length;
  const idType = $('readerIdType').value;
  if (idType === 'sid') {
    if (C.sid < 0) warnings.push('⚠ 名冊裡沒有「學號」欄位！無法自動填入讀者證號。（若貴校讀者證號是身分證字號，請先到 ③ 改設定）');
    else if (noSid) warnings.push(`有 ${noSid} 位學生沒有學號。`);
  } else {
    const badPid = list.filter((s) => s.pid && !/^[A-Z][1289]\d{8}$/.test(s.pid)).length;
    const noPid = list.filter((s) => !s.pid).length;
    if (C.pid < 0) warnings.push('⚠ 讀者證號設定為「身分證字號」，但名冊裡沒有身分證字號欄位！');
    else {
      if (noPid) warnings.push(`有 ${noPid} 位學生沒有身分證字號。`);
      if (badPid) warnings.push(`有 ${badPid} 筆身分證字號格式不對（應為 1 個英文字母＋9 碼數字）。`);
    }
  }
  if (skipped) warnings.push(`有 ${skipped} 位學生判斷不出年級／班序／座號，已略過（班名若是忠、孝等文字，請加「班序」欄）。`);
  list.sort((a, b) => a.grade - b.grade || a.cls - b.cls || a.seat - b.seat);
  // 胸號與別人的學號相同會混淆
  const sids = new Map(list.filter((s) => s.sid).map((s) => [s.sid, s]));
  const clash = list.filter((s) => sids.has(s.chest) && sids.get(s.chest) !== s);
  if (clash.length) warnings.push(`有 ${clash.length} 個胸號剛好等於別人的學號（例：${clash[0].chest}），輸入時會優先當成學號。`);
  return { students: list, warnings, ruleLabel, fatal: dChest.length > 0 };
}

function renderParsed() {
  const { students, warnings, ruleLabel, fatal } = parsed;
  const classes = new Set(students.map((s) => s.grade + '-' + s.cls)).size;
  msg('impMsg', warnings.length ? 'err' : 'ok',
    `讀到 ${students.length} 位學生、${classes} 個班，胸號：${ruleLabel}。` + (warnings.length ? '\n' + warnings.join('\n') : '\n檢查通過，可以儲存。'));
  const sample = [...students.slice(0, 4), ...students.slice(-2)];
  $('preview').innerHTML = '<table><tr>' + HEADER.map((h) => `<th>${h}</th>`).join('') + '</tr>'
    + sample.map((s) => '<tr>' + studentsToRows([{ ...s, pid: maskPid(s.pid) }])[0].map((c) => `<td>${c === '' ? '<i style="color:#c00">（空）</i>' : c}</td>`).join('') + '</tr>').join('')
    + '</table><p class="hint">（只顯示前 4 筆與最後 2 筆）</p>';
  $('save').disabled = $('saveUp').disabled = fatal;
}

async function saveParsed() {
  await chrome.storage.local.set({
    students: parsed.students,
    meta: { source: parsed.source, updatedAt: new Date().toISOString(), syncedAt: new Date().toISOString() }
  });
  await showCurrent();
}

$('save').onclick = async () => { await saveParsed(); msg('impMsg', 'ok', `已儲存 ${parsed.students.length} 位學生到這台電腦。請到借還書頁面按 F5 重新整理。`); };
$('saveUp').onclick = async () => {
  await saveParsed();
  try {
    const st = await getSettings();
    if (!st.cloudUrl || !st.cloudToken) throw new Error('請先在 ② 填好雲端網址與密語並儲存設定');
    const r = await cloudUpload(st.cloudUrl, st.cloudToken, parsed.students);
    msg('impMsg', 'ok', `已儲存到這台電腦，並上傳 ${r.count} 筆到雲端試算表。`);
  } catch (e) { msg('impMsg', 'err', '已存到這台電腦，但上傳失敗：' + e.message); }
};

// ---------- 雲端 ----------
$('down').onclick = async () => {
  try {
    await saveSettings();
    const st = await getSettings();
    const { students, updatedAt } = await cloudDownload(st.cloudUrl, st.cloudToken);
    if (!students.length) throw new Error('雲端名單是空的');
    await chrome.storage.local.set({ students, meta: { source: '雲端試算表', updatedAt, syncedAt: new Date().toISOString() } });
    msg('cloudMsg', 'ok', `已從雲端下載 ${students.length} 位學生。`);
    showCurrent();
  } catch (e) { msg('cloudMsg', 'err', '下載失敗：' + e.message); }
};
$('up').onclick = async () => {
  try {
    await saveSettings();
    const st = await getSettings();
    const { students = [] } = await chrome.storage.local.get('students');
    if (!students.length) throw new Error('這台電腦還沒有名單');
    const r = await cloudUpload(st.cloudUrl, st.cloudToken, students);
    msg('cloudMsg', 'ok', `已上傳 ${r.count} 筆到雲端試算表。`);
  } catch (e) { msg('cloudMsg', 'err', '上傳失敗：' + e.message); }
};

// ---------- 設定 ----------
const FIELDS = ['readerIdType', 'bigFormat', 'showReaderBig', 'showReturnBig', 'showWarnBig', 'showReturnMode', 'showOverdue', 'showQuota',
  'speakMode', 'speakRate', 'sayName', 'sayReturn', 'sayBookKey', 'sayNextKey', 'sayBorrowKey', 'sayFull', 'sayOverdue', 'sayModeSwitch', 'sayWarn',
  'acceptClassSeat', 'cloudUrl', 'cloudToken', 'autoSyncHours', 'importRule', 'customTpl'];
async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}
async function loadSettings() {
  const st = await getSettings();
  if (st.bigFormat === 'off') { st.bigFormat = 'short'; st.showReaderBig = false; }
  for (const k of FIELDS) { const el = $(k); if (el.type === 'checkbox') el.checked = !!st[k]; else el.value = st[k]; }
  $('tplBox').style.display = st.importRule === 'custom' ? '' : 'none';
}
async function saveSettings() {
  const st = {};
  for (const k of FIELDS) {
    const el = $(k);
    st[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
  }
  await chrome.storage.local.set({ settings: st });
}
$('readerIdType').onchange = async () => { await saveSettings(); showCurrent(); doParse(); };
$('saveSet').onclick = async () => { await saveSettings(); $('setMsg').textContent = '已儲存 ✔ 請到借還書頁面按 F5 重新整理'; setTimeout(() => ($('setMsg').textContent = ''), 6000); };
$('testVoice').onclick = () => chrome.tts.speak('王小明，尚可借閱兩本', { lang: 'zh-TW', rate: Number($('speakRate').value) || 1 });

function msg(id, cls, text) { $(id).className = 'msg ' + cls; $(id).textContent = text; }

showCurrent();
loadSettings();
$('ver').textContent = chrome.runtime.getManifest().version;
