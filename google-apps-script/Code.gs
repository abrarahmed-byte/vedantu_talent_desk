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

function doGet() {
  return json_({ ok: true, service: 'Vedantu Talent Desk Google Sheets connector' });
}

function doPost(event) {
  try {
    var payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    requireSecret_(payload);
    if (payload.action === 'preview') return json_(preview_(payload));
    if (payload.action === 'readRows') return json_(readRows_(payload));
    return json_({ ok: false, error: 'Unknown connector action.' });
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}
