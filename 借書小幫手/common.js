// 名單資料的共用格式與雲端同步（background 與 options 共用）
const HEADER = ['胸號', '年級', '班序', '班級', '座號', '姓名', '學號', '身分證字號'];

const DEFAULT_SETTINGS = {
  readerIdType: 'pid',      // 系統讀者證號：sid＝學號；pid＝身分證字號（大寫）
  bigFormat: 'short',
  showReaderBig: true,      // 大字顯示讀者班級＋姓名
  showWarnBig: true,        // 大字顯示錯誤／讀者不符（紅底）
  showReturnMode: true,     // 游標在書籍欄且沒輸入讀者時顯示「還書中」
  showOverdue: true,        // 預約記錄下方：逾期書名紅框
  showQuota: true,          // 預約記錄下方：還可借 N 本       // 大字區：short＝5甲王小明；long＝5年甲班王小明；off＝不顯示
  speakMode: 'name',        // name：只唸姓名；class：唸班級座號＋姓名
  speakRate: 1.1,
  sayFull: true,            // 唸「已借滿」
  sayOverdue: true,         // 唸逾期書名
  showReturnBig: true,      // 還書時大字顯示【已歸還】書名
  sayName: true,            // 唸讀者姓名
  sayReturn: true,          // 唸「已歸還，書名」
  sayBookKey: true,         // 按 . * 唸「還書」
  sayNextKey: true,         // 按 + 唸「下一位」
  sayBorrowKey: true,       // 書籍欄空白按 Enter 唸「借書」
  sayModeSwitch: true,      // 切換模式／班級時唸出
  sayWarn: true,            // 唸出錯誤與「讀者不符」警示
  acceptClassSeat: true,    // 也接受 5 碼班級座號
  importRule: 'auto',
  customTpl: '',
  cloudUrl: '',
  cloudToken: '',
  autoSyncHours: 6          // 0 = 不自動同步
};

function rowsToStudents(header, rows) {
  const idx = {};
  HEADER.forEach((h) => { idx[h] = header.findIndex((x) => String(x).trim() === h); });
  const s = (r, h) => (idx[h] >= 0 && r[idx[h]] != null ? String(r[idx[h]]).trim() : '');
  return rows
    .map((r) => ({
      chest: s(r, '胸號'),
      grade: Number(s(r, '年級')),
      cls: Number(s(r, '班序')),
      className: s(r, '班級'),
      seat: Number(s(r, '座號')),
      name: s(r, '姓名'),
      sid: s(r, '學號'),
      pid: s(r, '身分證字號').toUpperCase()
    }))
    .filter((x) => x.name && x.chest);
}

function studentsToRows(list) {
  return list.map((x) => [x.chest, x.grade, x.cls, x.className, x.seat, x.name, x.sid, x.pid || '']);
}

async function cloudDownload(url, token) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token));
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '雲端回應錯誤');
  return { students: rowsToStudents(data.header, data.rows), updatedAt: data.updatedAt || new Date().toISOString() };
}

async function cloudUpload(url, token, students) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, header: HEADER, rows: studentsToRows(students) })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '雲端回應錯誤');
  return data;
}

// 依格式產生胸號：G/GG 年級、C/CC 班序、S/SS 座號（雙字母＝補成 2 碼）
function formatChest(tpl, s) {
  const pad = (n) => String(n).padStart(2, '0');
  return tpl.replace(/GG|G|CC|C|SS|S/g, (t) => ({
    GG: pad(s.grade), G: String(s.grade), CC: pad(s.cls), C: String(s.cls), SS: pad(s.seat), S: String(s.seat)
  }[t]));
}

function maskPid(p) { return p ? p.slice(0, 3) + '****' + p.slice(-3) : ''; }
