/**
 * Minimal in-browser .xlsx reader — no package.
 *
 * A .xlsx is a zip of XML parts. The browser has no unzip, but it has
 * `DecompressionStream` (Chrome 80+, Firefox 113+, Safari 17+), which covers
 * the raw-deflate stream zip stores. This reads the first worksheet plus
 * the shared-string table, and returns a plain string grid — the same shape
 * the CSV path of ImportExcelModal produces, so header mapping is shared.
 *
 * Legacy .xls (the old BIFF binary) is NOT supported: it is a different
 * format, not a zip. The caller gets a clear error telling the user to
 * re-save as .xlsx or CSV. Google Sheets "Download → Microsoft Excel"
 * produces .xlsx; "Download → CSV" produces CSV. Both work here.
 */

/** Grid = one array of cell strings per sheet row, first row = header. */
export type XlsxCsvGrid = string[][];

export class XlsxParseError extends Error {}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/** A .xlsx zip ends with the EOCD record; scan backwards for it. */
function findEndOfCentralDirectory(buf: Uint8Array): number {
  // EOCD is 22 bytes + an optional comment (≤ 65535). Scan back 66KB.
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    const v = buf.subarray(i, i + 4);
    if (v[0] === 0x50 && v[1] === 0x4b && v[2] === 0x06 && v[3] === 0x05) return i;
  }
  return -1;
}

interface ZipEntry {
  name: string;
  method: number;
  dataOffset: number;
  compSize: number;
}

function listEntries(buf: Uint8Array, eocd: number): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let cursor = readU32(view, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    // Central directory signature 0x02014b50.
    if (buf[cursor] !== 0x50 || buf[cursor + 1] !== 0x4b || buf[cursor + 2] !== 0x01 || buf[cursor + 3] !== 0x02) {
      break;
    }
    const method = view.getUint16(cursor + 10, true);
    const compSize = readU32(view, cursor + 20);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = readU32(view, cursor + 42);
    const name = new TextDecoder().decode(buf.subarray(cursor + 46, cursor + 46 + nameLen));

    // The local header repeats name/length fields; the data sits right after
    // them, not at the central entry's position.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    entries.push({
      name,
      method,
      dataOffset: localOffset + 30 + localNameLen + localExtraLen,
      compSize,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new XlsxParseError('This browser cannot decompress .xlsx files (needs Chrome 80+, Firefox 113+, Safari 17+). Download the sheet as CSV instead.');
  }
  const stream = new Response(data as unknown as BodyInit).body;
  if (!stream) {
    // Defensive: a zero-length entry is still valid, so read it as-is.
    return data;
  }
  const decompressed = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(decompressed).arrayBuffer();
  return new Uint8Array(buf);
}

async function entryText(buf: Uint8Array, entries: ZipEntry[], name: string): Promise<string | null> {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  const raw = buf.subarray(entry.dataOffset, entry.dataOffset + entry.compSize);
  const expanded = entry.method === 8 ? await inflateRaw(raw) : raw;
  return new TextDecoder().decode(expanded);
}

function a1ToCol(ref: string | null): number {
  if (!ref) return 0;
  let col = 0;
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') col = col * 26 + (ch.charCodeAt(0) - 64);
    else break;
  }
  return Math.max(0, col - 1);
}

/** The shared-string table: one <si> per index. Rich-text <si> nests runs. */
function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: string[] = [];
  doc.querySelectorAll('si').forEach((si) => {
    out.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  });
  return out;
}

/** First worksheet of the workbook, as a string grid. */
export async function parseXlsxGrid(buf: ArrayBuffer | Uint8Array): Promise<XlsxCsvGrid> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) {
    throw new XlsxParseError('This file is not a valid .xlsx. Google Sheets: File → Download → "Microsoft Excel (.xlsx)". Legacy .xls is not supported — re-save it.');
  }
  const entries = listEntries(bytes, eocd);

  const shared = parseSharedStrings(await entryText(bytes, entries, 'xl/sharedStrings.xml'));

  // The first sheet of the workbook. xl/workbook.xml names them; the safest
  // generic pick is the first xl/worksheets/sheet*.xml, which is sheet1 for
  // files Google Sheets or Excel write.
  const sheetNames = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/\d+/)?.[0] ?? 0);
      const nb = Number(b.name.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    });
  const sheet = sheetNames[0];
  if (!sheet) {
    throw new XlsxParseError('No worksheet found in the .xlsx. Pick the sheet file, not the folder.');
  }

  const xml = await entryText(bytes, entries, sheet.name);
  if (xml === null) throw new XlsxParseError(`Worksheet part missing (${sheet.name}).`);

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const grid: string[][] = [];

  doc.querySelectorAll('row').forEach((rowEl) => {
    const rowIdx = Number(rowEl.getAttribute('r') ?? '0') - 1;
    while (grid.length < rowIdx) grid.push([]);
    const cells = grid[rowIdx] ?? (grid[rowIdx] = []);

    rowEl.querySelectorAll('c').forEach((c) => {
      const type = c.getAttribute('t');
      const col = a1ToCol(c.getAttribute('r'));
      let value = '';
      if (type === 'inlineStr') {
        value = Array.from(c.querySelector('is')?.querySelectorAll('t') ?? []).map((t) => t.textContent ?? '').join('');
      } else {
        const vEl = c.querySelector('v');
        value = vEl?.textContent ?? '';
        if (type === 's') value = shared[Number(value)] ?? '';
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    });
  });

  return grid.filter((r) => r.some((c) => c !== ''));
}

/**
 * Excel serial date → ISO day. Sheets store dates as a number (e.g. 45321).
 * The epoch is 1899-12-30 (the 1900 leap-year bug, which every reader
 * compensates for). Used by the importer to turn a date-typed column into
 * the ISO days the register expects.
 */
export function excelSerialToISO(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** True when the bytes start with the zip signature (a .xlsx/.xls-zip). */
export function looksLikeZip(buf: ArrayBuffer): boolean {
  const v = new Uint8Array(buf, 0, 2);
  return v[0] === 0x50 && v[1] === 0x4b;
}
