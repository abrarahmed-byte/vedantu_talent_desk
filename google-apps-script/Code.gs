/**
 * Vedantu Talent Desk - private Google Sheets reader.
 *
 * Deploy this as a Web App that executes as the owner. Store CONNECTOR_SECRET
 * in Apps Script Project Settings > Script Properties. The same value is saved
 * as the Cloudflare Worker secret named CONNECTOR_SECRET.
 */

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function requireSecret_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty('CONNECTOR_SECRET');
  if (!expected) throw new Error('CONNECTOR_SECRET is not configured in Script Properties.');
  if (!payload || payload.secret !== expected) throw new Error('Connector authorization failed.');
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

function preview_(payload) {
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
 * It deliberately touches Drive and Sheets so Google shows the required
 * authorization screen before background résumé processing begins.
 */
function authorizeTalentDeskAccess() {
  DriveApp.getRootFolder().getName();
  SpreadsheetApp.getActiveSpreadsheet();
  return 'Talent Desk can read permitted Sheets and Google Drive résumés.';
}

function doGet() {
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
