/**
 * Vedantu Talent Desk - private Google Sheets reader.
 *
 * Deploy this as a Web App that executes as the owner. Store CONNECTOR_SECRET
 * in Apps Script Project Settings > Script Properties. The same value is saved
 * as the Cloudflare Worker secret named CONNECTOR_SECRET.
 */

var TALENT_DESK_ORIGIN_ = 'https://vedantu-talent-desk.abrar-ahmed-778.workers.dev';

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function requireSecret_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty('CONNECTOR_SECRET');
  if (!expected) throw new Error('CONNECTOR_SECRET is not configured in Script Properties.');
  if (!payload || payload.secret !== expected) throw new Error('Connector authorization failed.');
}

function base64WebSafe_(value) {
  var bytes = typeof value === 'string' ? Utilities.newBlob(value).getBytes() : value;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function escapeHtml_(value) {
  return String(value || '').replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
}

function loginPage_(title, message, redirectUrl) {
  var safeRedirect = redirectUrl ? escapeHtml_(redirectUrl) : '';
  var action = redirectUrl
    ? '<a href="' + safeRedirect + '">Continue to Talent Desk</a>'
    : '<p class="help">Close this tab and sign in again with your Vedantu Google account.</p>';
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><title>' + escapeHtml_(title) + '</title><style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f8f8;color:#01202b;font-family:Arial,sans-serif}' +
    '.card{width:min(420px,calc(100% - 40px));padding:34px;border-radius:18px;background:#fff;box-shadow:0 20px 60px rgba(1,32,43,.15);text-align:center}' +
    '.mark{width:48px;height:48px;margin:0 auto 20px;display:grid;place-items:center;border-radius:13px;background:#ff693d;color:#fff;font-size:25px;font-weight:900;transform:rotate(-4deg)}' +
    'h1{margin:0;font-size:24px}p{margin:12px 0 24px;color:#71868e;font-size:14px;line-height:1.6}' +
    'a{display:block;padding:13px 18px;border-radius:9px;background:#ff693d;color:#fff;text-decoration:none;font-weight:700}.help{margin-bottom:0;font-size:12px}' +
    '</style></head><body><main class="card"><div class="mark">V</div><h1>' + escapeHtml_(title) + '</h1><p>' +
    escapeHtml_(message) + '</p>' + action + '</main></body></html>'
  ).setTitle(title);
}

function talentDeskLogin_(event) {
  var callback = String(event && event.parameter && event.parameter.callback || '');
  var nonce = String(event && event.parameter && event.parameter.nonce || '');
  var expectedCallback = TALENT_DESK_ORIGIN_ + '/auth/callback';
  if (callback !== expectedCallback || !/^[0-9a-f-]{30,50}$/i.test(nonce)) {
    return loginPage_('Sign-in link expired', 'Return to Talent Desk and start a new sign-in.', '');
  }
  var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!/@vedantu\.com$/.test(email)) {
    return loginPage_('Vedantu account required', 'This workspace is available only to approved @vedantu.com accounts.', '');
  }
  var secret = PropertiesService.getScriptProperties().getProperty('CONNECTOR_SECRET');
  if (!secret) return loginPage_('Sign-in is not ready', 'The Talent Desk connector secret is missing.', '');
  var payload = base64WebSafe_(JSON.stringify({
    kind: 'login',
    email: email,
    nonce: nonce,
    exp: Math.floor(Date.now() / 1000) + 300
  }));
  var signature = base64WebSafe_(Utilities.computeHmacSha256Signature(payload, secret));
  var destination = callback + '?ticket=' + encodeURIComponent(payload + '.' + signature);
  return loginPage_('Signing you in', 'Google verified your Vedantu account. Returning to Talent Desk…', destination);
}

function sheet_(spreadsheetId, tabName) {
  if (!spreadsheetId) throw new Error('Spreadsheet ID is required.');
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheet = tabName ? spreadsheet.getSheetByName(tabName) : spreadsheet.getSheets()[0];
  if (!sheet) throw new Error('The requested Sheet tab was not found.');
  return sheet;
}

function headerRow_(sheet, requested) {
  return Math.min(Math.max(1, Number(requested) || 1), Math.max(1, sheet.getLastRow()));
}

function headers_(sheet, requestedHeaderRow) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return [];
  var headerRow = headerRow_(sheet, requestedHeaderRow);
  return sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });
}

function advancedSheetsAvailable_() {
  return typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values;
}

function sheetMetadata_(spreadsheetId, tabName) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'sheet-meta:' + spreadsheetId + ':' + String(tabName || '');
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var spreadsheet = Sheets.Spreadsheets.get(spreadsheetId, {
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });
  var sheets = spreadsheet.sheets || [];
  var selected = null;
  for (var index = 0; index < sheets.length; index += 1) {
    var properties = sheets[index].properties || {};
    if ((!tabName && !selected) || properties.title === tabName) selected = properties;
  }
  if (!selected) throw new Error('The requested Sheet tab was not found.');
  var metadata = {
    title: selected.title,
    sheetId: selected.sheetId,
    rowCount: Math.max(1, Number(selected.gridProperties && selected.gridProperties.rowCount) || 1),
    columnCount: Math.min(250, Math.max(1, Number(selected.gridProperties && selected.gridProperties.columnCount) || 1))
  };
  cache.put(cacheKey, JSON.stringify(metadata), 300);
  return metadata;
}

function columnLetter_(columnNumber) {
  var value = Math.max(1, Number(columnNumber) || 1);
  var result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function quotedTab_(title) {
  return "'" + String(title || '').replace(/'/g, "''") + "'";
}

function sheetValues_(spreadsheetId, metadata, startRow, endRow, columnCount) {
  var range = quotedTab_(metadata.title) + '!A' + startRow + ':' + columnLetter_(columnCount) + endRow;
  var response = Sheets.Spreadsheets.Values.get(spreadsheetId, range, {
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return response.values || [];
}

function fastHeaders_(spreadsheetId, metadata, requestedHeaderRow) {
  var headerRow = Math.min(Math.max(1, Number(requestedHeaderRow) || 1), metadata.rowCount);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'sheet-headers:' + spreadsheetId + ':' + metadata.sheetId + ':' + headerRow;
  var cached = cache.get(cacheKey);
  if (cached) return { headerRow: headerRow, headers: JSON.parse(cached) };
  var values = sheetValues_(spreadsheetId, metadata, headerRow, headerRow, metadata.columnCount);
  var headers = (values[0] || []).map(function (value) { return String(value || '').trim(); });
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  cache.put(cacheKey, JSON.stringify(headers), 300);
  return { headerRow: headerRow, headers: headers };
}

function previewFast_(payload) {
  var metadata = sheetMetadata_(payload.spreadsheetId, payload.tabName);
  var header = fastHeaders_(payload.spreadsheetId, metadata, payload.headerRow);
  return {
    ok: true,
    tabName: metadata.title,
    headerRow: header.headerRow,
    headers: header.headers,
    totalRows: metadata.rowCount,
    totalRowsEstimated: true
  };
}

function readRowsFast_(payload) {
  var metadata = sheetMetadata_(payload.spreadsheetId, payload.tabName);
  var header = fastHeaders_(payload.spreadsheetId, metadata, payload.headerRow);
  var startRow = Math.max(header.headerRow + 1, Number(payload.startRow) || header.headerRow + 1);
  var limit = Math.min(200, Math.max(1, Number(payload.limit) || 200));
  if (startRow > metadata.rowCount || !header.headers.length) {
    return { ok: true, tabName: metadata.title, headerRow: header.headerRow, headers: header.headers, rows: [], totalRows: metadata.rowCount, nextRow: startRow, done: true };
  }
  var endRow = Math.min(metadata.rowCount, startRow + limit - 1);
  var requestedRows = endRow - startRow + 1;
  var values = sheetValues_(payload.spreadsheetId, metadata, startRow, endRow, header.headers.length);
  var rows = [];
  values.forEach(function (valuesRow, offset) {
    var hasValue = valuesRow.some(function (value) { return String(value || '').trim() !== ''; });
    if (!hasValue) return;
    var record = { _sheetRow: startRow + offset };
    header.headers.forEach(function (headerName, column) {
      if (headerName) record[headerName] = valuesRow[column] || '';
    });
    rows.push(record);
  });
  var reachedBlankTail = values.length < requestedRows;
  var actualLastRow = reachedBlankTail ? Math.max(header.headerRow, startRow + values.length - 1) : metadata.rowCount;
  return {
    ok: true,
    tabName: metadata.title,
    headerRow: header.headerRow,
    headers: header.headers,
    rows: rows,
    totalRows: actualLastRow,
    nextRow: endRow + 1,
    done: endRow >= metadata.rowCount || reachedBlankTail
  };
}

function preview_(payload) {
  if (advancedSheetsAvailable_()) return previewFast_(payload);
  var sheet = sheet_(payload.spreadsheetId, payload.tabName);
  var headerRow = headerRow_(sheet, payload.headerRow);
  return {
    ok: true,
    tabName: sheet.getName(),
    headerRow: headerRow,
    headers: headers_(sheet, headerRow),
    totalRows: sheet.getLastRow()
  };
}

function readRows_(payload) {
  if (advancedSheetsAvailable_()) return readRowsFast_(payload);
  var sheet = sheet_(payload.spreadsheetId, payload.tabName);
  var headerRow = headerRow_(sheet, payload.headerRow);
  var headers = headers_(sheet, headerRow);
  var lastRow = sheet.getLastRow();
  var startRow = Math.max(headerRow + 1, Number(payload.startRow) || headerRow + 1);
  var limit = Math.min(200, Math.max(1, Number(payload.limit) || 200));
  if (startRow > lastRow || !headers.length) {
    return { ok: true, tabName: sheet.getName(), headerRow: headerRow, headers: headers, rows: [], totalRows: lastRow, nextRow: startRow, done: true };
  }

  var rowCount = Math.min(limit, lastRow - startRow + 1);
  var values = sheet.getRange(startRow, 1, rowCount, headers.length).getDisplayValues();
  var rows = values.map(function (valuesRow, offset) {
    var record = { _sheetRow: startRow + offset };
    headers.forEach(function (header, column) {
      if (header) record[header] = valuesRow[column];
    });
    return record;
  });
  var nextRow = startRow + rowCount;
  return {
    ok: true,
    tabName: sheet.getName(),
    headerRow: headerRow,
    headers: headers,
    rows: rows,
    totalRows: lastRow,
    nextRow: nextRow,
    done: nextRow > lastRow
  };
}

function driveFileId_(value) {
  var input = String(value || '').trim();
  var pathMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];
  var idMatch = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(input) ? input : '';
}

function safeResumeName_(name, mimeType) {
  var value = String(name || 'resume').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 180);
  if (/\.([a-z0-9]{2,5})$/i.test(value)) return value;
  if (mimeType === MimeType.PDF) return value + '.pdf';
  if (mimeType === MimeType.MICROSOFT_WORD) return value + '.docx';
  return value + '.pdf';
}

function readResume_(payload) {
  var fileId = driveFileId_(payload.resumeUrl);
  if (!fileId) throw new Error('The resume link is not a valid Google Drive file link.');
  var file = DriveApp.getFileById(fileId);
  var sourceMimeType = file.getMimeType();
  var blob;
  if (sourceMimeType.indexOf('application/vnd.google-apps.') === 0) {
    blob = file.getAs(MimeType.PDF);
  } else {
    blob = file.getBlob();
  }
  var bytes = blob.getBytes();
  var maxBytes = Math.min(8 * 1024 * 1024, Math.max(1024, Number(payload.maxBytes) || 5 * 1024 * 1024));
  if (bytes.length > maxBytes) throw new Error('The resume is larger than the processing file-size limit.');
  var mimeType = blob.getContentType() || MimeType.PDF;
  var updated = file.getLastUpdated();
  return {
    ok: true,
    fileName: safeResumeName_(file.getName(), mimeType),
    mimeType: mimeType,
    size: bytes.length,
    fingerprint: fileId + ':' + (updated ? updated.toISOString() : '') + ':' + bytes.length,
    base64: Utilities.base64Encode(bytes)
  };
}

/**
 * Run this once from the Apps Script editor as the deployment owner.
 * It deliberately touches Sheets and Drive so Google shows every required
 * authorization screen before background synchronization begins.
 */
function authorizeTalentDeskAccess() {
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder().getName();
  return 'Talent Desk can read permitted Sheets and Google Drive résumés.';
}

function doGet(event) {
  if (event && event.parameter && event.parameter.action === 'talentDeskLogin') return talentDeskLogin_(event);
  return json_({ ok: true, service: 'Vedantu Talent Desk Google Sheets connector' });
}

function doPost(event) {
  try {
    var payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    requireSecret_(payload);
    if (payload.action === 'preview') return json_(preview_(payload));
    if (payload.action === 'readRows') return json_(readRows_(payload));
    if (payload.action === 'readResume') return json_(readResume_(payload));
    return json_({ ok: false, error: 'Unknown connector action.' });
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}
