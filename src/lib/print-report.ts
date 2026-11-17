'use client';

/**
 * A print-styled report window: the browser's "Save as PDF" is the download.
 *
 * No PDF library in the repo, so the honest path is a print-formatted report
 * opened in its own window. The caller passes live data (critical path rows,
 * the L1 schedule), the report renders a KEC-lettered A4 layout, and prints
 * itself on open. "Save as PDF" in the print dialog is the PDF version the
 * client asked for — same bytes, no extra dependency.
 */

export interface ReportTable {
  title: string;
  head: string[];
  rows: string[][];
  /** Per-column alignment, e.g. right-align the numeric tail. */
  aligns?: Array<'left' | 'right'>;
}

export interface ReportSpec {
  title: string;
  sub: string;
  meta: string[];
  tables: ReportTable[];
  /** A one-paragraph note under the tables (e.g. PR remarks). */
  notes?: string;
  /** Signature blocks across the foot, e.g. ['Prepared by', 'Checked by', 'Approved by']. */
  signatures?: string[];
}

/** Opens the report and triggers the print dialog once styles are ready. */
export function openPrintReport(spec: ReportSpec): void {
  const w = window.open('', '_blank', 'width=980,height=700');
  if (!w) return;

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const tablesHtml = spec.tables
    .map((t) => {
      const align = (i: number): string =>
        t.aligns && t.aligns[i] === 'right' ? 'text-align:right;' : '';
      const head = t.head.map((h, i) => `<th style="${align(i)}">${esc(h)}</th>`).join('');
      const body =
        t.rows.length === 0
          ? `<tr><td colspan="${t.head.length}" style="color:#666">No rows</td></tr>`
          : t.rows
              .map((r) => `<tr>${r.map((c, i) => `<td style="${align(i)}">${esc(c)}</td>`).join('')}</tr>`)
              .join('');
      return `
      <h2>${esc(t.title)}</h2>
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
    })
    .join('');

  // A totals / notes paragraph and a signature strip, both optional.
  const notesHtml = spec.notes
    ? `<p style="font-size:11px;margin:14px 0 0">${esc(spec.notes)}</p>`
    : '';
  const sigHtml = spec.signatures && spec.signatures.length
    ? `<div style="display:flex;gap:24px;margin-top:44px;font-size:11px">
         ${spec.signatures.map((s) =>
           `<div style="flex:1;border-top:1px solid #444;padding-top:4px;text-align:center">${esc(s)}</div>`).join('')}
       </div>`
    : '';

  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(spec.title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #14462f; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 15px; font-weight: 700; color: #14462f; }
    .brand small { display: block; font-weight: 400; font-size: 11px; color: #555; margin-top: 2px; }
    .title { font-size: 18px; font-weight: 700; margin: 2px 0 0; }
    .sub { font-size: 12px; color: #555; margin-top: 3px; }
    .meta { font-size: 11.5px; color: #333; margin: 0 0 14px; }
    .meta span { display: inline-block; margin-right: 18px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .4px;
         color: #14462f; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: left; background: #eef3f0; border: 1px solid #ccd6d0;
         padding: 4px 6px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; }
    td { border: 1px solid #dde5e0; padding: 4px 6px; vertical-align: top; }
    tr:nth-child(even) td { background: #f8faf9; }
    .foot { margin-top: 18px; font-size: 10px; color: #888; }
    .noprint { position: fixed; top: 10px; right: 10px; z-index: 9; }
    .noprint button { font: 13px/1.4 Arial; padding: 8px 14px; border: 1px solid #14462f;
                      background: #14462f; color: #fff; border-radius: 4px; cursor: pointer; }
    @media print { .noprint { display: none; } }
  </style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="head">
    <div class="brand">KEC Agritech Pvt. Ltd.<small>Engineering · Procurement · Construction</small></div>
    <div style="text-align:right">
      <div class="title">${esc(spec.title)}</div>
      <div class="sub">${esc(spec.sub)}</div>
    </div>
  </div>
  <p class="meta">${spec.meta.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
  ${tablesHtml}
  ${notesHtml}
  ${sigHtml}
  <div class="foot">Generated ${new Date().toLocaleString('en-IN')} · KEC Agritech ERP · ${esc(spec.title)}</div>
</body>
</html>`);

  w.document.close();
  // Print once the document is painted, so the user lands on a populated
  // page in the print dialog.
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      // The user can still hit the Print button; the report is complete.
    }
  }, 350);
}
