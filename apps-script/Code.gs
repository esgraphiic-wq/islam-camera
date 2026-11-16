// كاميرا المحل - إسلام جرافيك
// بيستقبل الملفات من التطبيق ويرفعها على الدرايف في فولدر باسم تاريخ اليوم، وبيعرض المعرض والكتالوج
// النسخة دي هي المرجع؛ الكود الشغال فعلاً في مشروع Apps Script "كاميرا إسلام جرافيك"

const FOLDERS = {
  raw: '1CynyU-urVUQ1UWJbP84k-oXv2VLuv28f',      // ١ خام (ارمي هنا)
  designs: '1Gv-xmxsXkVhLjsve3Ep6XPYRgqvdr1sc',  // ٤ تصميمات (للموك أب)
  catalog: '1USQhqI13CZxHpSojEzgad_87ycaAwk7G'   // ٥ الكتالوج (للعملاء)
};
// المفتاح السري مش محطوط هنا عشان الريبو عام؛ في المشروع الشغال مكتوب مكان السطر ده
const APP_KEY = PropertiesService.getScriptProperties().getProperty('APP_KEY');
const FIELDS = 'files(id,name,mimeType,thumbnailLink,createdTime,webViewLink)';

function doGet() {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">افتح تطبيق كاميرا المحل من الموبايل.</p>');
}

function auth_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }
function drive_(path) {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/' + path, { headers: auth_(), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('drive ' + r.getResponseCode());
  return JSON.parse(r.getContentText());
}
function q_(s) { return encodeURIComponent(s); }
function today_() { return Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'); }

function childFolder_(parentId, name) {
  const root = DriveApp.getFolderById(parentId);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function startUpload(fileName, mimeType, size, dest) {
  const folder = childFolder_(FOLDERS[dest] || FOLDERS.raw, today_());
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: Object.assign(auth_(), {
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(size)
      }),
      payload: JSON.stringify({ name: fileName, parents: [folder.getId()] }),
      muteHttpExceptions: true
    });
  if (res.getResponseCode() !== 200) throw new Error('init ' + res.getResponseCode() + ' ' + res.getContentText());
  const h = res.getAllHeaders();
  return h['Location'] || h['location'];
}

function sendChunk(url, b64, start, total) {
  const bytes = Utilities.base64Decode(b64);
  const end = start + bytes.length - 1;
  const res = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/octet-stream',
    payload: bytes,
    headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total },
    muteHttpExceptions: true
  });
  const c = res.getResponseCode();
  if (c === 308) return { done: false };
  if (c === 200 || c === 201) return { done: true, id: JSON.parse(res.getContentText()).id };
  throw new Error('chunk ' + c + ' ' + res.getContentText());
}

// صور مصغّرة صغيرة (حوالي 400 بكسل) عشان المعرض يفتح بسرعة
function withThumbs_(files, size) {
  const reqs = files.map(f => f.thumbnailLink ? {
    url: f.thumbnailLink.replace(/=s\d+$/, '=s' + size), headers: auth_(), muteHttpExceptions: true
  } : null);
  const idx = reqs.map((r, i) => r ? i : -1).filter(i => i >= 0);
  const res = UrlFetchApp.fetchAll(idx.map(i => reqs[i]));
  const out = files.map(f => ({ id: f.id, name: f.name, mime: f.mimeType, time: f.createdTime, url: f.webViewLink, thumb: null }));
  idx.forEach((i, k) => { if (res[k].getResponseCode() === 200) out[i].thumb = Utilities.base64Encode(res[k].getContent()); });
  return out;
}

function filesIn_(folderId, limit) {
  return drive_('files?q=' + q_("'" + folderId + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'") +
    '&orderBy=createdTime desc&pageSize=' + limit + '&fields=' + q_(FIELDS)).files || [];
}
function foldersIn_(folderId) {
  return drive_('files?q=' + q_("'" + folderId + "' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'") +
    '&orderBy=name desc&pageSize=100&fields=' + q_('files(id,name)')).files || [];
}

// المعرض: آخر الحاجات اللي اترفعت (فولدرات الأيام + اللي اترمى في الفولدر الرئيسي على طول)
function listRecent_(dest, limit) {
  const rootId = FOLDERS[dest] || FOLDERS.raw;
  let files = filesIn_(rootId, limit);
  for (const day of foldersIn_(rootId).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.name)).slice(0, 10)) {
    if (files.length >= limit * 2) break;
    files = files.concat(filesIn_(day.id, limit));
  }
  files.sort((a, b) => a.createdTime < b.createdTime ? 1 : -1);
  return withThumbs_(files.slice(0, limit), 400);
}

// الكتالوج: كل فولدر جوه «٥ الكتالوج» = قسم
function listCatalog_() {
  const cats = foldersIn_(FOLDERS.catalog).sort((a, b) => a.name < b.name ? -1 : 1);
  return cats.map(c => ({ name: c.name, items: withThumbs_(filesIn_(c.id, 40), 400) }));
}

// صورة كبيرة للعرض أو للمشاركة مع العميل
function bigImage_(id) {
  const f = drive_('files/' + id + '?fields=' + q_('name,mimeType,thumbnailLink'));
  if (!f.thumbnailLink) {
    const blob = DriveApp.getFileById(id).getBlob();
    if (f.mimeType.indexOf('image/') === 0 && blob.getBytes().length < 6 * 1024 * 1024) return { name: f.name, mime: f.mimeType, b64: Utilities.base64Encode(blob.getBytes()) };
    throw new Error('no preview');
  }
  const r = UrlFetchApp.fetch(f.thumbnailLink.replace(/=s\d+$/, '=s1600'), { headers: auth_() });
  return { name: f.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', b64: Utilities.base64Encode(r.getContent()) };
}

function toCatalog_(id, cat) {
  const folder = childFolder_(FOLDERS.catalog, cat || 'أخرى');
  const f = DriveApp.getFileById(id);
  f.makeCopy(f.getName(), folder);
  return { ok: true };
}

function doPost(e) {
  let out;
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.k !== APP_KEY) throw new Error('unauthorized');
    if (d.op === 'start') out = { url: startUpload(d.name, d.mime, d.size, d.dest) };
    else if (d.op === 'chunk') out = sendChunk(d.url, d.b64, d.start, d.total);
    else if (d.op === 'list') out = { items: listRecent_(d.dest, Math.min(d.limit || 30, 60)) };
    else if (d.op === 'catalog') out = { cats: listCatalog_() };
    else if (d.op === 'image') out = bigImage_(d.id);
    else if (d.op === 'tocat') out = toCatalog_(d.id, d.cat);
    else if (d.op === 'ping') out = { ok: true };
    else throw new Error('bad op');
  } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
