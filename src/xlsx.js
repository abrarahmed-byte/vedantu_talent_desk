const encoder = new TextEncoder();

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function safeSheetName(value, fallback) {
  return String(value || fallback).replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || fallback;
}

function excelDate(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp / 86400000 + 25569 : null;
}

function cellXml(value, reference, header = false) {
  if (header) return `<c r="${reference}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  const cell = value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "value") ? value : { value };
  if (cell.value === null || cell.value === undefined || cell.value === "") return "";
  if (cell.type === "date") {
    const serial = excelDate(cell.value);
    if (serial !== null) return `<c r="${reference}" s="3"><v>${serial}</v></c>`;
  }
  if (cell.type === "percent") {
    const number = Number(cell.value);
    if (Number.isFinite(number)) return `<c r="${reference}" s="2"><v>${number}</v></c>`;
  }
  if (cell.type === "number" || typeof cell.value === "number") {
    const number = Number(cell.value);
    if (Number.isFinite(number)) return `<c r="${reference}"><v>${number}</v></c>`;
  }
  const text = String(cell.value).slice(0, 32767);
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function sheetXml(sheet) {
  const columns = sheet.columns || [];
  const headers = columns.map((column) => column.label || column.key || "Column");
  const rows = sheet.rows || [];
  const widthXml = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(80, Number(column.width) || 18))}" customWidth="1"/>`).join("");
  const headerCells = headers.map((header, index) => cellXml(header, `${columnName(index)}1`, true)).join("");
  const rowXml = rows.map((row, rowIndex) => {
    const values = Array.isArray(row) ? row : columns.map((column) => row?.[column.key]);
    const cells = values.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${rowIndex + 2}`)).join("");
    return `<row r="${rowIndex + 2}">${cells}</row>`;
  }).join("");
  const lastColumn = columnName(Math.max(0, headers.length - 1));
  const lastRow = Math.max(1, rows.length + 1);
  const frozenColumns = Math.max(0, Math.min(headers.length, Math.round(Number(sheet.freezeColumns) || 0)));
  const pane = frozenColumns
    ? `<pane xSplit="${frozenColumns}" ySplit="1" topLeftCell="${columnName(frozenColumns)}2" activePane="bottomRight" state="frozen"/>`
    : `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${widthXml}</cols>
  <sheetData><row r="1" ht="24" customHeight="1">${headerCells}</row>${rowXml}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0"/><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="0&quot;%&quot;"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
  <fonts count="2"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/><family val="2"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF6845"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><bottom style="thin"><color rgb="FFD7DEE0"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function contentTypesXml(sheetCount) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookRelationshipsXml(sheetCount) {
  const worksheets = Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function littleEndian(value, bytes) {
  const output = new Uint8Array(bytes);
  let remaining = Number(value) >>> 0;
  for (let index = 0; index < bytes; index += 1) {
    output[index] = remaining & 0xff;
    remaining >>>= 8;
  }
  return output;
}

function combine(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function dosTimestamp(date = new Date()) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function zipStore(files) {
  const localChunks = [];
  const centralChunks = [];
  const timestamp = dosTimestamp();
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);
    const localHeader = combine([
      littleEndian(0x04034b50, 4), littleEndian(20, 2), littleEndian(0x0800, 2), littleEndian(0, 2),
      littleEndian(timestamp.time, 2), littleEndian(timestamp.day, 2), littleEndian(checksum, 4),
      littleEndian(data.length, 4), littleEndian(data.length, 4), littleEndian(name.length, 2), littleEndian(0, 2),
    ]);
    localChunks.push(localHeader, name, data);
    const centralHeader = combine([
      littleEndian(0x02014b50, 4), littleEndian(20, 2), littleEndian(20, 2), littleEndian(0x0800, 2), littleEndian(0, 2),
      littleEndian(timestamp.time, 2), littleEndian(timestamp.day, 2), littleEndian(checksum, 4),
      littleEndian(data.length, 4), littleEndian(data.length, 4), littleEndian(name.length, 2), littleEndian(0, 2),
      littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 4), littleEndian(offset, 4),
    ]);
    centralChunks.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }
  const central = combine(centralChunks);
  const end = combine([
    littleEndian(0x06054b50, 4), littleEndian(0, 2), littleEndian(0, 2), littleEndian(files.length, 2),
    littleEndian(files.length, 2), littleEndian(central.length, 4), littleEndian(offset, 4), littleEndian(0, 2),
  ]);
  return combine([...localChunks, central, end]);
}

export function createXlsx(inputSheets) {
  const sheets = (inputSheets || []).map((sheet, index) => ({ ...sheet, name: safeSheetName(sheet.name, `Sheet ${index + 1}`) }));
  if (!sheets.length) throw new Error("At least one worksheet is required");
  const files = [
    { name: "[Content_Types].xml", content: contentTypesXml(sheets.length) },
    { name: "_rels/.rels", content: rootRelationshipsXml() },
    { name: "xl/workbook.xml", content: workbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelationshipsXml(sheets.length) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet) })),
  ];
  return zipStore(files);
}
