// csv-reader-speed-01 entry: fast drop-in for csv-reader 1.0.0.
// Same output as the reference (vendor/csv-reader/index.js), but scans with indexOf on
// string chunks instead of per-character charAt calls, and builds rows with slice().

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordRow = null;

  // skip empty lines (LF or CRLF only)
  function skipBlank() {
    while (pos < n) {
      const c = text[pos];
      if (c === '\n') { pos++; line++; }
      else if (c === '\r' && pos + 1 < n && text[pos + 1] === '\n') { pos += 2; line++; }
      else break;
    }
  }

  function readUnquoted(start) {
    // scan from start to next comma / line-break; handle stray CR
    let i = start;
    let haveCR = false; // a stray CR was dropped; value needs assembling from pieces
    let pieceStart = start;
    let value = null;
    while (true) {
      const ci = text.indexOf(',', i);
      const li = text.indexOf('\n', i);
      const ri = text.indexOf('\r', i);
      // choose the earliest of ci, li, ri
      let e = n, kind = END;
      if (ci !== -1 && ci < e) { e = ci; kind = COMMA; }
      if (li !== -1 && li < e) { e = li; kind = LINE_BREAK; }
      if (ri !== -1 && ri < e) { e = ri; kind = 3; } // 3 = CR
      if (kind === 3) {
        if (e + 1 < n && text[e + 1] === '\n') {
          // CRLF: line break
          const piece = text.slice(pieceStart, e);
          if (value === null) value = piece; else value += piece;
          return { value, ended: LINE_BREAK, endPos: e + 2, lineEnd: line + 1 };
        }
        // stray CR: drop it
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        const piece = text.slice(pieceStart, e);
        if (value === null) value = piece; else value += piece;
        i = e + 1;
        pieceStart = i;
        haveCR = true;
        continue;
      }
      const piece = text.slice(pieceStart, e);
      if (value === null) value = piece; else value += piece;
      if (kind === COMMA) return { value, ended: COMMA, endPos: e + 1 };
      if (kind === LINE_BREAK) return { value, ended: LINE_BREAK, endPos: e + 1, lineEnd: line + 1 };
      return { value, ended: END, endPos: e };
    }
  }

  function readQuoted(open) {
    // scan for closing quote
    let i = open + 1;
    let value = null;
    let closed = false;
    let q = -1;
    let scanLine = 0; // extra line count from embedded newlines
    while (i < n) {
      q = text.indexOf('"', i);
      if (q === -1) { i = n; break; }
      if (q + 1 < n && text[q + 1] === '"') {
        i = q + 2;
        continue;
      }
      // closing quote at q
      closed = true;
      i = q + 1;
      break;
    }
    if (!closed) {
      // unterminated: quote is a literal, restart unquoted from open+1
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const r = readUnquoted(open + 1);
      return { value: '"' + r.value, ended: r.ended, endPos: r.endPos, lineEnd: r.lineEnd };
    }
    // count embedded newlines between open+1 and q
    // (each LF, CRLF or lone CR is one line; inside quotes all CRs count as LF)
    const seg = text.slice(open + 1, q);
    value = seg.indexOf('""') !== -1 ? seg.replaceAll('""', '"') : seg;
    // normalize CR inside quoted field to LF
    if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) {
      value = seg.replace(/\r\n?/g, '\n');
      let cnt = 0;
      for (let k = 0; k < value.length; k++) if (value[k] === '\n') cnt++;
      scanLine = cnt;
    }
    let ended, endPos, lineEnd;
    if (i >= n) { ended = END; endPos = i; }
    else {
      const c = text[i];
      if (c === ',') { ended = COMMA; endPos = i + 1; }
      else if (c === '\n') { ended = LINE_BREAK; endPos = i + 1; lineEnd = line + scanLine + 1; }
      else if (c === '\r' && i + 1 < n && text[i + 1] === '\n') { ended = LINE_BREAK; endPos = i + 2; lineEnd = line + scanLine + 1; }
      else {
        // junk after closing quote: the junk appends to the quoted value.
        // readUnquoted counts from `line`, which does not yet hold the quoted segment's
        // embedded line breaks, so its line number is shifted by scanLine.
        const r = readUnquoted(i);
        if (r.value.length > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return {
          value: value + r.value,
          ended: r.ended,
          endPos: r.endPos,
          lineEnd: r.lineEnd !== undefined ? r.lineEnd + scanLine : line + scanLine,
        };
      }
    }
    return { value, ended, endPos, lineEnd: lineEnd !== undefined ? lineEnd : line + scanLine };
  }

  let recordLine = 1;
  while (true) {
    skipBlank();
    if (pos >= n) break;
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted;
    do {
      quoted = text[pos] === '"';
      let r;
      if (quoted) r = readQuoted(pos);
      else r = readUnquoted(pos);
      fields.push(r.value);
      // Apply the new line number whenever the field carries one (a multiline quoted
      // field may end at a comma, and its embedded line breaks still count).
      if (r.lineEnd !== undefined) {
        line = r.lineEnd;
      } else if (r.ended === LINE_BREAK) {
        line++;
      }
      pos = r.endPos;
      ended = r.ended;
    } while (ended === COMMA);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
