// كاميرا المحل - إسلام جرافيك
// بيستقبل الملفات من التطبيق ويرفعها على الدرايف في فولدر باسم تاريخ اليوم
// النسخة دي هي المرجع؛ الكود الشغال فعلاً في مشروع Apps Script "كاميرا إسلام جرافيك"

const FOLDERS = {
  raw: '1CynyU-urVUQ1UWJbP84k-oXv2VLuv28f',      // ١ خام (ارمي هنا)
  designs: '1Gv-xmxsXkVhLjsve3Ep6XPYRgqvdr1sc'   // ٤ تصميمات (للموك أب)
};
// المفتاح السري مش محطوط هنا عشان الريبو عام؛ في المشروع الشغال مكتوب مكان السطر ده
const APP_KEY = PropertiesService.getScriptProperties().getProperty('APP_KEY');

function doGet() {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">افتح تطبيق كاميرا المحل من الموبايل.</p>');
}

function today_() { return Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'); }

function dayFolder_(dest) {
  const root = DriveApp.getFolderById(FOLDERS[dest] || FOLDERS.raw);
  const name = today_();
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function startUpload(fileName, mimeType, size, dest) {
  const folder = dayFolder_(dest);
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(size)
      },
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

// آخر الملفات المرفوعة (للمعرض جوه التطبيق)
function listRecent_(dest, limit) {
  const root = DriveApp.getFolderById(FOLDERS[dest] || FOLDERS.raw);
  const days = [];
  const it = root.getFolders();
  while (it.hasNext()) { const f = it.next(); if (/^\d{4}-\d{2}-\d{2}$/.test(f.getName())) days.push(f); }
  days.sort((a, b) => b.getName() < a.getName() ? -1 : 1);
  const out = [];
  for (const day of days) {
    const files = [];
    const fi = day.getFiles();
    while (fi.hasNext()) files.push(fi.next());
    files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
    for (const f of files) {
      let thumb = null;
      try { const t = f.getThumbnail(); if (t) thumb = Utilities.base64Encode(t.getBytes()); } catch (e) {}
      out.push({ id: f.getId(), name: f.getName(), day: day.getName(), mime: f.getMimeType(), size: f.getSize(), thumb: thumb, url: f.getUrl() });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function doPost(e) {
  let out;
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.k !== APP_KEY) throw new Error('unauthorized');
    if (d.op === 'start') out = { url: startUpload(d.name, d.mime, d.size, d.dest) };
    else if (d.op === 'chunk') out = sendChunk(d.url, d.b64, d.start, d.total);
    else if (d.op === 'list') out = { items: listRecent_(d.dest, Math.min(d.limit || 24, 60)) };
    else if (d.op === 'ping') out = { ok: true };
    else throw new Error('bad op');
  } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
