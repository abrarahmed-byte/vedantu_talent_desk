(() => {
  const encoder = new TextEncoder();

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
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
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(cell.value).slice(0, 32767))}</t></is></c>`;
  }

  function *sheetXmlChunks(sheet) {
    const columns = sheet.columns || [];
    const headers = columns.map((column) => column.label || column.key || "Column");
    const rows = sheet.rows || [];
    const widthXml = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(80, Number(column.width) || 18))}" customWidth="1"/>`).join("");
    const lastColumn = columnName(Math.max(0, headers.length - 1));
    const lastRow = Math.max(1, rows.length + 1);
    const frozenColumns = Math.max(0, Math.min(headers.length, Math.round(Number(sheet.freezeColumns) || 0)));
    const pane = frozenColumns
      ? `<pane xSplit="${frozenColumns}" ySplit="1" topLeftCell="${columnName(frozenColumns)}2" activePane="bottomRight" state="frozen"/>`
      : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
    yield `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widthXml}</cols><sheetData><row r="1" ht="24" customHeight="1">`;
    yield headers.map((header, index) => cellXml(header, `${columnName(index)}1`, true)).join("");
    yield "</row>";
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const values = Array.isArray(row) ? row : columns.map((column) => row?.[column.key]);
      yield `<row r="${rowIndex + 2}">${values.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${rowIndex + 2}`)).join("")}</row>`;
    }
    yield `</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
  }

  function workbookXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0&quot;%&quot;"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF6845"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFD7DEE0"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  function contentTypesXml(sheetCount) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  }

  function workbookRelationshipsXml(sheetCount) {
    const worksheets = Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  }

  const rootRelationshipsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    return value >>> 0;
  });

  function updateCrc(crc, bytes) {
    let result = crc;
    for (const byte of bytes) result = CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
    return result;
  }

  function littleEndian(value, bytes) {
    const output = new Uint8Array(bytes);
    let remaining = Number(value) >>> 0;
    for (let index = 0; index < bytes; index += 1) { output[index] = remaining & 0xff; remaining >>>= 8; }
    return output;
  }

  function combine(chunks) {
    const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }

  async function compressChunks(chunks) {
    let crc = 0xffffffff;
    let size = 0;
    let stream;
    try { stream = new CompressionStream("deflate-raw"); } catch { stream = null; }
    if (!stream) {
      const stored = [];
      for (const chunk of chunks) {
        const bytes = encoder.encode(chunk);
        crc = updateCrc(crc, bytes); size += bytes.length; stored.push(bytes);
      }
      return { data: combine(stored), size, crc: (crc ^ 0xffffffff) >>> 0, method: 0 };
    }
    const writer = stream.writable.getWriter();
    const compressedPromise = new Response(stream.readable).arrayBuffer();
    for (const chunk of chunks) {
      const bytes = encoder.encode(chunk);
      crc = updateCrc(crc, bytes); size += bytes.length;
      await writer.write(bytes);
    }
    await writer.close();
    return { data: new Uint8Array(await compressedPromise), size, crc: (crc ^ 0xffffffff) >>> 0, method: 8 };
  }

  function *singleChunk(value) { yield value; }

  async function zipFiles(files) {
    const localChunks = [];
    const centralChunks = [];
    const now = new Date();
    const year = Math.max(1980, now.getFullYear());
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const compressed = await compressChunks(file.chunks());
      const localHeader = combine([
        littleEndian(0x04034b50, 4), littleEndian(20, 2), littleEndian(0x0800, 2), littleEndian(compressed.method, 2),
        littleEndian(time, 2), littleEndian(day, 2), littleEndian(compressed.crc, 4), littleEndian(compressed.data.length, 4),
        littleEndian(compressed.size, 4), littleEndian(name.length, 2), littleEndian(0, 2),
      ]);
      localChunks.push(localHeader, name, compressed.data);
      const centralHeader = combine([
        littleEndian(0x02014b50, 4), littleEndian(20, 2), littleEndian(20, 2), littleEndian(0x0800, 2), littleEndian(compressed.method, 2),
        littleEndian(time, 2), littleEndian(day, 2), littleEndian(compressed.crc, 4), littleEndian(compressed.data.length, 4),
        littleEndian(compressed.size, 4), littleEndian(name.length, 2), littleEndian(0, 2), littleEndian(0, 2),
        littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 4), littleEndian(offset, 4),
      ]);
      centralChunks.push(centralHeader, name);
      offset += localHeader.length + name.length + compressed.data.length;
    }
    const central = combine(centralChunks);
    const end = combine([
      littleEndian(0x06054b50, 4), littleEndian(0, 2), littleEndian(0, 2), littleEndian(files.length, 2),
      littleEndian(files.length, 2), littleEndian(central.length, 4), littleEndian(offset, 4), littleEndian(0, 2),
    ]);
    return combine([...localChunks, central, end]);
  }

  async function createXlsx(inputSheets) {
    const sheets = (inputSheets || []).map((sheet, index) => ({ ...sheet, name: safeSheetName(sheet.name, `Sheet ${index + 1}`) }));
    if (!sheets.length) throw new Error("At least one worksheet is required");
    return zipFiles([
      { name: "[Content_Types].xml", chunks: () => singleChunk(contentTypesXml(sheets.length)) },
      { name: "_rels/.rels", chunks: () => singleChunk(rootRelationshipsXml) },
      { name: "xl/workbook.xml", chunks: () => singleChunk(workbookXml(sheets)) },
      { name: "xl/_rels/workbook.xml.rels", chunks: () => singleChunk(workbookRelationshipsXml(sheets.length)) },
      { name: "xl/styles.xml", chunks: () => singleChunk(stylesXml()) },
      ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, chunks: () => sheetXmlChunks(sheet) })),
    ]);
  }

  window.TalentDeskXlsx = { createXlsx };
})();
