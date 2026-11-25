/**
 * 借書小幫手：雲端名單（Google 試算表 Apps Script）
 *
 * 安裝：
 * 1. 建立一份新的 Google 試算表 →「擴充功能 → Apps Script」，把這份程式碼整段貼上並儲存。
 * 2. 左側「專案設定（齒輪）→ 指令碼屬性」新增：屬性 TOKEN，值 = 自訂一組長密語（例如 20 個以上的英數字）。
 * 3. 右上「部署 → 新增部署作業 → 類型：網頁應用程式」
 *      執行身分：我
 *      誰可以存取：任何人
 *    部署後複製「網頁應用程式網址」（…/exec），連同密語填到擴充功能的設定頁。
 *
 * 安全性：網址必須搭配正確密語才能讀寫；試算表本身維持不公開。
 * 若名單含身分證字號，請把試算表放在學校帳號、不要分享給其他人，密語請設得夠長。
 * 密語外流時，到指令碼屬性換一組新的，再到各台電腦更新即可。
 */
const SHEET_NAME = '學生資料';
const HEADER = ['胸號', '年級', '班序', '班級', '座號', '姓名', '學號', '身分證字號'];

function doGet(e) {
  if (!checkToken_(e.parameter.token)) return json_({ ok: false, error: '密語錯誤' });
  const sh = sheet_();
  const values = sh.getDataRange().getDisplayValues();
  const props = PropertiesService.getScriptProperties();
  return json_({
    ok: true,
    header: values[0] || HEADER,
    rows: values.slice(1).filter(r => r.join('') !== ''),
    updatedAt: props.getProperty('UPDATED_AT') || ''
  });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '資料格式錯誤' }); }
  if (!checkToken_(body.token)) return json_({ ok: false, error: '密語錯誤' });
  const rows = body.rows || [];
  const header = body.header || HEADER;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    sh.clearContents();
    sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@'); // 全部當文字，保留學號前導 0
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows.map(r => r.map(String)));
    sh.setFrozenRows(1);
    const now = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty('UPDATED_AT', now);
    return json_({ ok: true, count: rows.length, updatedAt: now });
  } finally {
    lock.releaseLock();
  }
}

function checkToken_(t) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return !!token && t === token;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
