/* Layout-aware PDF text & sentence extractor with normalized bounding boxes.
 * Reuses PDF Translator's bundled /pdfjs/build/pdf.min.mjs.
 */

let pdfjsPromise = null;

export async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("/pdfjs/build/pdf.min.mjs").then((mod) => {
      if (mod.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs";
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

export async function openPdfFromUrl(url) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    url,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  }).promise;
}

const ABBREVIATIONS = new Set([
  "fig", "figs", "eq", "eqs", "tab", "tabs", "sec", "secs", "ref", "refs",
  "al", "etc", "e.g", "i.e", "vs", "cf", "ca", "approx", "dr", "mr", "mrs",
  "ms", "prof", "jr", "sr", "st", "no", "nos", "vol", "vols", "pp", "p",
  "ed", "eds", "ch", "chap", "pt", "dept", "univ", "inc", "ltd", "corp",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "est", "min", "max", "avg", "std", "def", "thm", "lem", "prop", "cor", "alg",
]);

const round4 = (n) => Math.round(n * 10000) / 10000;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

function median(arr) {
  if (!arr.length) return 10;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mergeRects(rects) {
  if (!rects.length) return [];
  const sorted = rects.slice().sort((a, b) => (Math.abs(a[1] - b[1]) > 0.008 ? a[1] - b[1] : a[0] - b[0]));
  const out = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (
      prev
      && Math.abs(prev[1] - r[1]) <= Math.max(prev[3], r[3]) * 0.65
      && r[0] <= prev[0] + prev[2] + 0.045
    ) {
      const x1 = Math.min(prev[0], r[0]);
      const y1 = Math.min(prev[1], r[1]);
      const x2 = Math.max(prev[0] + prev[2], r[0] + r[2]);
      const y2 = Math.max(prev[1] + prev[3], r[1] + r[3]);
      prev[0] = round4(x1);
      prev[1] = round4(y1);
      prev[2] = round4(x2 - x1);
      prev[3] = round4(y2 - y1);
    } else {
      out.push([round4(r[0]), round4(r[1]), round4(r[2]), round4(r[3])]);
    }
  }
  return out;
}

function detectColumns(items, pageWidth) {
  if (items.length < 18) return null;
  const mid = pageWidth * 0.5;
  let left = 0;
  let right = 0;
  let crossing = 0;
  for (const it of items) {
    if (it.yn < 0.1 || it.yn > 0.9) continue;
    if (it.x + it.w < mid - pageWidth * 0.005) left++;
    else if (it.x > mid + pageWidth * 0.005) right++;
    else if (it.w > pageWidth * 0.12) crossing++;
  }
  return left >= 8 && right >= 8 && crossing < Math.min(left, right) * 0.35 ? mid : null;
}

function joinLineItems(items) {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i > 0) {
      const prev = items[i - 1];
      const gap = it.x - (prev.x + prev.w);
      if (
        gap > Math.max(prev.fontSize, it.fontSize) * 0.18
        && !out.endsWith(" ")
        && !it.str.startsWith(" ")
        && !/[\u4e00-\u9fff]$/.test(out)
        && !/^[\u4e00-\u9fff]/.test(it.str)
      ) {
        out += " ";
      }
    }
    out += it.str;
  }
  return out.replace(/\s+/g, " ").trim();
}

function buildLines(items) {
  if (!items.length) return [];
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let target = null;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
      const ln = lines[i];
      if (Math.abs(ln.y - it.y) <= Math.max(ln.h, it.h) * 0.52) {
        target = ln;
        break;
      }
    }
    if (!target) {
      lines.push({ y: it.y, h: it.h, items: [it] });
    } else {
      target.items.push(it);
      target.y = (target.y * (target.items.length - 1) + it.y) / target.items.length;
      target.h = Math.max(target.h, it.h);
    }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    ln.x = ln.items[0].x;
    ln.x2 = Math.max(...ln.items.map((it) => it.x + it.w));
    ln.fontSize = median(ln.items.map((it) => it.fontSize));
    ln.text = joinLineItems(ln.items);
  }
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

function extractColumnZones(items, pageWidth, pageHeight) {
  const gutter = detectColumns(items, pageWidth);
  if (!gutter) return [buildLines(items)];
  const topFull = [];
  const leftCol = [];
  const rightCol = [];
  const bottomFull = [];
  let colStartY = 0;
  let colEndY = pageHeight;
  for (const it of items) {
    if (it.x < gutter - pageWidth * 0.03 && it.x + it.w > gutter + pageWidth * 0.03) {
      if (it.y < pageHeight * 0.45 && it.y > colStartY) colStartY = it.y + 4;
      if (it.y > pageHeight * 0.85 && it.y < colEndY) colEndY = it.y - 4;
    }
  }
  for (const it of items) {
    if (it.y < colStartY) topFull.push(it);
    else if (it.y > colEndY) bottomFull.push(it);
    else if (it.x + it.w * 0.5 < gutter) leftCol.push(it);
    else rightCol.push(it);
  }
  return [buildLines(topFull), buildLines(leftCol), buildLines(rightCol), buildLines(bottomFull)]
    .filter((z) => z.length > 0);
}

function groupParagraphs(lines, bodyFontSize, pageHeight) {
  if (!lines.length) return [];
  const lineGaps = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].y - lines[i - 1].y;
    if (g > 0 && g < bodyFontSize * 3.5) lineGaps.push(g);
  }
  const normalGap = lineGaps.length ? median(lineGaps) : bodyFontSize * 1.35;
  const colLeft = Math.min(...lines.map((l) => l.x));
  const colRight = Math.max(...lines.map((l) => l.x2));
  const colWidth = Math.max(colRight - colLeft, bodyFontSize * 10);

  const groups = [];
  let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const ln = lines[i];
    const gap = ln.y - prev.y;
    const fontDiff = Math.abs(ln.fontSize - prev.fontSize) > Math.max(1.2, bodyFontSize * 0.14);
    const bigGap = gap > normalGap * 1.48 || gap < -bodyFontSize * 0.5;
    const indent = (ln.x - colLeft) > bodyFontSize * 1.1 && (prev.x - colLeft) < bodyFontSize * 0.8;
    const prevShort = (prev.x2 - colLeft) < colWidth * 0.72 && /[.!?。！？:：]$/.test(prev.text);
    const startsList = /^([•●◦▪\-–—]|\(\d+\)|\[\d+\]|\d+\.\s+[A-Z\u4e00-\u9fff])/.test(ln.text);
    const isHeading = ln.fontSize > bodyFontSize * 1.14 && ln.text.length < 140;
    const prevHeading = prev.fontSize > bodyFontSize * 1.14 && prev.text.length < 140;
    if (bigGap || fontDiff || indent || prevShort || startsList || isHeading !== prevHeading) {
      groups.push(cur);
      cur = [ln];
    } else {
      cur.push(ln);
    }
  }
  if (cur.length) groups.push(cur);

  return groups.map((g) => {
    const avgFont = median(g.map((l) => l.fontSize));
    const minY = Math.min(...g.map((l) => l.y));
    const maxY = Math.max(...g.map((l) => l.y + l.h));
    let text = "";
    const spans = [];
    for (let li = 0; li < g.length; li++) {
      const ln = g[li];
      let lineStr = "";
      const lineSpans = [];
      for (let ii = 0; ii < ln.items.length; ii++) {
        const it = ln.items[ii];
        if (ii > 0) {
          const prevIt = ln.items[ii - 1];
          const gap = it.x - (prevIt.x + prevIt.w);
          if (
            gap > Math.max(prevIt.fontSize, it.fontSize) * 0.18
            && !lineStr.endsWith(" ")
            && !it.str.startsWith(" ")
            && !/[\u4e00-\u9fff]$/.test(lineStr)
            && !/^[\u4e00-\u9fff]/.test(it.str)
          ) {
            lineStr += " ";
          }
        }
        const s0 = lineStr.length;
        lineStr += it.str;
        lineSpans.push({ start: s0, end: lineStr.length, rect: it.rect });
      }
      lineStr = lineStr.replace(/\s+$/, "");
      if (li > 0 && text.endsWith("-") && /^[a-z]/.test(lineStr)) {
        text = text.slice(0, -1);
      } else if (li > 0 && text.length && lineStr.length) {
        if (!/[\u4e00-\u9fff]$/.test(text) && !/^[\u4e00-\u9fff]/.test(lineStr)) text += " ";
      }
      const base = text.length;
      text += lineStr;
      for (const sp of lineSpans) {
        spans.push({ start: base + sp.start, end: base + sp.end, rect: sp.rect });
      }
    }
    const trimmed = text.trim();
    const isCaption = /^(fig(ure)?|table|tab\.?|algorithm|alg\.?)\s*\d+[\s.:—–-]/i.test(trimmed);
    const nonAlpha = (trimmed.match(/[^A-Za-z\u4e00-\u9fff\s]/g) || []).length;
    const numericTokens = (trimmed.match(/\b\d+(?:[.,]\d+)?%?\b/g) || []).length;
    const words = trimmed.split(/\s+/).filter(Boolean);
    const hasReplacementChar = trimmed.includes("\uFFFD");
    const multiColLines = g.filter((ln) => {
      let bigGaps = 0;
      for (let k = 1; k < ln.items.length; k++) {
        const gap = ln.items[k].x - (ln.items[k - 1].x + ln.items[k - 1].w);
        if (gap > Math.max(ln.fontSize, bodyFontSize) * 1.35) bigGaps++;
      }
      return bigGaps >= 2;
    }).length;
    // Title-Case label cluster (e.g. "Global Planner Noisy/Smoked Observations Semantic Understanding...")
    const capWords = words.filter((w) => /^[A-Z][a-zA-Z0-9/-]*$/.test(w)).length;
    const isLabelCluster = words.length >= 4 && !/[.!?。！？]$/.test(trimmed) && (capWords / words.length) >= 0.65;
    const isTableBlock = !isCaption && (
      (multiColLines >= 2 && multiColLines >= g.length * 0.5)
      || (multiColLines >= 1 && g.length <= 3 && !/[.!?。！？]$/.test(trimmed) && numericTokens >= 2)
      || (words.length >= 4 && numericTokens >= words.length * 0.4 && !/[.!?。！？]$/.test(trimmed))
    );
    const isDiagramLabel = !isCaption && (
      isTableBlock
      || avgFont < bodyFontSize * 0.83
      || (hasReplacementChar && !/[.!?。！？]$/.test(trimmed))
      || (isLabelCluster && avgFont <= bodyFontSize * 1.05)
      || (trimmed.length < 36 && !/[.!?。！？:：]$/.test(trimmed) && g.length === 1 && !/^(\d+(\.\d+)*\.?\s+|[IVX]+\.\s+|Abstract|Introduction|Related Work|Method|Methodology|Experiments?|Results?|Discussion|Conclusion|Conclusions|Acknowledgements?|References|Bibliography|Appendix)\b/i.test(trimmed))
      || (trimmed.length < 60 && nonAlpha > trimmed.length * 0.45 && !/[.!?。！？]$/.test(trimmed))
    );
    let kind = "body";
    if (
      trimmed.length < 3
      || isDiagramLabel
      || (/^\d{1,4}$/.test(trimmed) && (minY < pageHeight * 0.09 || maxY > pageHeight * 0.91))
      || (trimmed.length < 75 && (minY < pageHeight * 0.055 || maxY > pageHeight * 0.945))
    ) {
      kind = "other";
    } else if (
      !isCaption && (
        (avgFont > bodyFontSize * 1.13 && trimmed.length < 180)
        || (/^(\d+(\.\d+)*\.?\s+|[IVX]+\.\s+|Abstract|Introduction|Related Work|Method|Methodology|Experiments?|Results?|Discussion|Conclusion|Conclusions|Acknowledgements?|References|Bibliography|Appendix)\b/i.test(trimmed) && trimmed.length < 110 && !/[.!?。！？]$/.test(trimmed))
      )
    ) {
      kind = "heading";
    }
    return { text: trimmed, rawText: text, spans, kind };
  }).filter((p) => p.text.length > 0);
}

function splitSentences(rawText, kind) {
  if (kind === "heading" || kind === "other" || rawText.length < 60) {
    const m = rawText.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const start = m ? m[1].length : 0;
    const end = start + (m ? m[2].length : rawText.length);
    return [{ start, end, text: rawText.slice(start, end).replace(/\s+/g, " ").trim() }];
  }
  const slices = [];
  let start = 0;
  const len = rawText.length;
  for (let i = 0; i < len; i++) {
    const ch = rawText[i];
    let isEnd = false;
    if (ch === "。" || ch === "！" || ch === "？") {
      isEnd = true;
      while (i + 1 < len && /[”’"'）)》\]]/.test(rawText[i + 1])) i++;
    } else if (ch === "." || ch === "!" || ch === "?") {
      const next = rawText[i + 1] || "";
      const next2 = rawText[i + 2] || "";
      if (ch === ".") {
        if (/\d/.test(next) || next === ".") continue;
        const before = rawText.slice(Math.max(start, i - 16), i);
        const wordMatch = before.match(/([A-Za-z.]+)$/);
        const word = wordMatch ? wordMatch[1].toLowerCase().replace(/^\.+/, "") : "";
        if (word.length === 1 && /^[a-z]$/.test(word)) {
          if (i - start < 25 || !/\s+[A-Z]/.test(rawText.slice(i + 1, i + 4))) continue;
        }
        if (ABBREVIATIONS.has(word)) continue;
      }
      let j = i;
      while (j + 1 < len && /["'”’)\]]/.test(rawText[j + 1])) j++;
      const after = rawText.slice(j + 1);
      if (!after.trim() || /^\s+(?:[A-Z0-9\u4e00-\u9fff(“"'\[]|[a-z]+\s+[A-Z])/.test(after)) {
        if (j + 1 - start >= 12 || !after.trim()) {
          i = j;
          isEnd = true;
        }
      } else if (next === " " && /[A-Z\u4e00-\u9fff]/.test(next2) && i - start >= 20) {
        isEnd = true;
      }
    }
    if (isEnd) {
      const seg = rawText.slice(start, i + 1);
      const lead = seg.match(/^\s*/)[0].length;
      const clean = seg.replace(/\s+/g, " ").trim();
      if (clean) slices.push({ start: start + lead, end: i + 1, text: clean });
      start = i + 1;
    }
  }
  if (start < len) {
    const seg = rawText.slice(start);
    const lead = seg.match(/^\s*/)[0].length;
    const clean = seg.replace(/\s+/g, " ").trim();
    if (clean) {
      if (slices.length && clean.length < 10 && /^[\[\(]?\d+[\]\)]?\.?$/.test(clean)) {
        const prev = slices[slices.length - 1];
        prev.end = len;
        prev.text = `${prev.text} ${clean}`.trim();
      } else {
        slices.push({ start: start + lead, end: len, text: clean });
      }
    }
  }
  return slices.length ? slices : [{ start: 0, end: len, text: rawText.trim() }];
}

function rectsForSlice(spans, start, end) {
  const matched = [];
  for (const sp of spans) {
    if (sp.end <= start || sp.start >= end) continue;
    const spLen = Math.max(1, sp.end - sp.start);
    const frac0 = Math.max(0, (start - sp.start) / spLen);
    const frac1 = Math.min(1, (end - sp.start) / spLen);
    const [x, y, w, h] = sp.rect;
    matched.push([
      clamp01(x + w * frac0),
      clamp01(y),
      clamp01(w * Math.max(0.05, frac1 - frac0)),
      clamp01(h),
    ]);
  }
  return mergeRects(matched);
}

function mulMat(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function txPt(ctm, x, y) {
  return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
}

async function detectExcludedRegions(page, pw, ph, OPS) {
  const boxes = [];
  const hRules = []; // { x1, x2, y }
  if (!OPS) return boxes;
  try {
    const opList = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const addRule = (px1, py1, px2, py2) => {
      const y1 = (ph - py1) / ph;
      const y2 = (ph - py2) / ph;
      const x1 = Math.min(px1, px2) / pw;
      const x2 = Math.max(px1, px2) / pw;
      const w = x2 - x1;
      const h = Math.abs(y2 - y1);
      if (w >= 0.22 && h <= 0.008) {
        const y = (y1 + y2) * 0.5;
        if (y > 0.065 && y < 0.935) hRules.push({ x1, x2, y });
      }
    };

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform && Array.isArray(args) && args.length === 6) {
        ctm = mulMat(ctm, args);
      } else if (
        fn === OPS.paintImageXObject
        || fn === OPS.paintInlineImageXObject
        || fn === OPS.paintImageMaskXObject
      ) {
        const pts = [
          [ctm[4], ctm[5]],
          [ctm[0] + ctm[4], ctm[1] + ctm[5]],
          [ctm[2] + ctm[4], ctm[3] + ctm[5]],
          [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
        ];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => ph - p[1]);
        const x1 = Math.min(...xs) / pw;
        const x2 = Math.max(...xs) / pw;
        const y1 = Math.min(...ys) / ph;
        const y2 = Math.max(...ys) / ph;
        const bw = x2 - x1;
        const bh = y2 - y1;
        if (bw > 0.08 && bh > 0.05 && bw * bh < 0.78) {
          boxes.push([x1 - 0.01, y1 - 0.01, x2 + 0.01, y2 + 0.01]);
        }
      } else if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
        const [rx, ry, rw, rh] = args;
        const [px1, py1] = txPt(ctm, rx, ry);
        const [px2, py2] = txPt(ctm, rx + rw, ry + rh);
        const bx1 = Math.min(px1, px2) / pw;
        const bx2 = Math.max(px1, px2) / pw;
        const by1 = Math.min(ph - py1, ph - py2) / ph;
        const by2 = Math.max(ph - py1, ph - py2) / ph;
        const bw = bx2 - bx1;
        const bh = by2 - by1;
        if (Math.abs(py2 - py1) <= 4.5) {
          addRule(px1, (py1 + py2) * 0.5, px2, (py1 + py2) * 0.5);
        } else if (bw >= 0.22 && bh >= 0.08 && bw * bh < 0.62 && by1 > 0.05 && by2 < 0.94) {
          // Framed vector Figure box
          boxes.push([bx1 - 0.008, by1 - 0.008, bx2 + 0.008, by2 + 0.008]);
        }
      } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
        const ops = args[0] || [];
        const coords = args[1] || [];
        let ci = 0;
        let curX = 0;
        let curY = 0;
        let minPx = Infinity, maxPx = -Infinity, minPy = Infinity, maxPy = -Infinity;
        let pathOps = 0;
        const track = (x, y) => {
          if (x < minPx) minPx = x;
          if (x > maxPx) maxPx = x;
          if (y < minPy) minPy = y;
          if (y > maxPy) maxPy = y;
          pathOps++;
        };
        for (let oi = 0; oi < ops.length; oi++) {
          const op = ops[oi];
          if (op === OPS.moveTo) {
            curX = coords[ci++];
            curY = coords[ci++];
            const [px, py] = txPt(ctm, curX, curY);
            track(px, ph - py);
          } else if (op === OPS.lineTo) {
            const nx = coords[ci++];
            const ny = coords[ci++];
            const [px1, py1] = txPt(ctm, curX, curY);
            const [px2, py2] = txPt(ctm, nx, ny);
            addRule(px1, py1, px2, py2);
            track(px2, ph - py2);
            curX = nx;
            curY = ny;
          } else if (op === OPS.curveTo) {
            curX = coords[ci + 4];
            curY = coords[ci + 5];
            const [px, py] = txPt(ctm, curX, curY);
            track(px, ph - py);
            ci += 6;
          } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
            curX = coords[ci + 2];
            curY = coords[ci + 3];
            const [px, py] = txPt(ctm, curX, curY);
            track(px, ph - py);
            ci += 4;
          } else if (op === OPS.rectangle) {
            const rx = coords[ci++];
            const ry = coords[ci++];
            const rw = coords[ci++];
            const rh = coords[ci++];
            const [px1, py1] = txPt(ctm, rx, ry);
            const [px2, py2] = txPt(ctm, rx + rw, ry + rh);
            track(px1, ph - py1);
            track(px2, ph - py2);
            if (Math.abs(py2 - py1) <= 4.5) addRule(px1, (py1 + py2) * 0.5, px2, (py1 + py2) * 0.5);
          }
        }
        // Detect rounded-rectangle / framed vector Figure containers (like Fig. 1 in academic papers!)
        if (pathOps >= 4 && Number.isFinite(minPx)) {
          const bx1 = minPx / pw;
          const bx2 = maxPx / pw;
          const by1 = minPy / ph;
          const by2 = maxPy / ph;
          const bw = bx2 - bx1;
          const bh = by2 - by1;
          if (bw >= 0.22 && bh >= 0.08 && bw * bh < 0.62 && by1 > 0.05 && by2 < 0.94) {
            boxes.push([bx1 - 0.008, by1 - 0.008, bx2 + 0.008, by2 + 0.008]);
          }
        }
      }
    }

    // Group matching horizontal rules into Three-Line Tables (三线表: >=3 rules with aligned X-span,
    // or >=2 rules with aligned X-span and compact height)
    if (hRules.length >= 2) {
      hRules.sort((a, b) => a.y - b.y);
      // Deduplicate nearly identical rules at same y
      const uniq = [];
      for (const r of hRules) {
        if (!uniq.some((u) => Math.abs(u.y - r.y) < 0.004 && Math.abs(u.x1 - r.x1) < 0.02 && Math.abs(u.x2 - r.x2) < 0.02)) {
          uniq.push(r);
        }
      }
      const used = new Set();
      for (let i = 0; i < uniq.length; i++) {
        if (used.has(i)) continue;
        const base = uniq[i];
        const cluster = [i];
        for (let j = i + 1; j < uniq.length; j++) {
          if (used.has(j)) continue;
          const cand = uniq[j];
          if (cand.y - uniq[cluster[cluster.length - 1]].y > 0.42) break;
          const overlap = Math.min(base.x2, cand.x2) - Math.max(base.x1, cand.x1);
          const minW = Math.min(base.x2 - base.x1, cand.x2 - cand.x1);
          if (overlap >= minW * 0.72 && Math.abs(base.x1 - cand.x1) < 0.06 && Math.abs(base.x2 - cand.x2) < 0.06) {
            cluster.push(j);
          }
        }
        if (cluster.length >= 3 || (cluster.length === 2 && (uniq[cluster[1]].y - base.y) >= 0.035 && (uniq[cluster[1]].y - base.y) <= 0.36)) {
          const rs = cluster.map((idx) => uniq[idx]);
          for (const idx of cluster) used.add(idx);
          const bx1 = Math.min(...rs.map((r) => r.x1)) - 0.012;
          const bx2 = Math.max(...rs.map((r) => r.x2)) + 0.012;
          const by1 = rs[0].y - 0.004;
          const by2 = rs[rs.length - 1].y + 0.006;
          if (by2 - by1 >= 0.03 && by2 - by1 <= 0.68) {
            boxes.push([bx1, by1, bx2, by2]);
          }
        }
      }
    }
  } catch {}
  return boxes;
}

export async function extractDocument(pdfDoc, onProgress) {
  const pdfjs = await loadPdfJs();
  const OPS = pdfjs.OPS;
  const numPages = pdfDoc.numPages;
  const page_sizes = [];
  const paragraphs = [];
  const sentences = [];
  let inReferences = false;
  let cjkCount = 0;
  let latinCount = 0;

  const rawPages = [];
  const allFonts = [];
  for (let p = 1; p <= numPages; p++) {
    if (onProgress) onProgress(p, numPages);
    const page = await pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const pw = viewport.width;
    const ph = viewport.height;
    page_sizes.push([Math.round(pw * 10) / 10, Math.round(ph * 10) / 10]);

    const [content, excludedBoxes] = await Promise.all([
      page.getTextContent({ includeMarkedContent: false }),
      detectExcludedRegions(page, pw, ph, OPS),
    ]);
    const items = [];
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = item.transform;
      // Drop rotated/vertical text (e.g. chart Y-axis labels, rotated figure annotations)
      if (Math.abs(tx[1]) > 0.06 || Math.abs(tx[2]) > 0.06) continue;
      const fontSize = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 10;
      const x = tx[4];
      const yBottom = ph - tx[5];
      const h = Math.max(item.height || fontSize, fontSize * 0.9);
      const y = yBottom - h * 0.85;
      const w = Math.max(item.width || fontSize * 0.4 * item.str.length, 2);
      if (w <= 0 || h <= 0) continue;
      const nx = clamp01(x / pw);
      const ny = clamp01(y / ph);
      const nw = clamp01(w / pw);
      const nh = clamp01(h / ph);
      // Drop text inside raster Figure boxes or Three-Line Table boxes
      const cx = nx + nw * 0.5;
      const cy = ny + nh * 0.5;
      if (excludedBoxes.some(([bx1, by1, bx2, by2]) => cx >= bx1 && cx <= bx2 && cy >= by1 && cy <= by2)) {
        continue;
      }
      items.push({
        str: item.str,
        x, y, w, h,
        yn: ny,
        fontSize,
        rect: [nx, ny, nw, nh],
      });
      if (p <= 4 && item.str.trim().length >= 4) allFonts.push(fontSize);
    }
    rawPages.push({ p, pw, ph, items });
  }

  const bodyFontSize = allFonts.length ? median(allFonts) : 10;
  for (const { p, pw, ph, items } of rawPages) {
    for (const lines of extractColumnZones(items, pw, ph)) {
      for (const para of groupParagraphs(lines, bodyFontSize, ph)) {
        if (para.kind === "heading" && /^(references|bibliography|参考文献|works cited)\b/i.test(para.text)) {
          inReferences = true;
        } else if (inReferences && para.kind === "heading" && /^(appendix|supplementary|附录)/i.test(para.text)) {
          inReferences = false;
        }
        const kind = inReferences && para.kind === "body" ? "reference" : para.kind;
        const slices = splitSentences(para.rawText, kind);
        const a = sentences.length;
        for (const sl of slices) {
          sentences.push({ p, t: sl.text, r: rectsForSlice(para.spans, sl.start, sl.end) });
          cjkCount += (sl.text.match(/[\u4e00-\u9fff]/g) || []).length;
          latinCount += (sl.text.match(/[A-Za-z]/g) || []).length;
        }
        const b = sentences.length;
        if (b > a) paragraphs.push({ p, k: kind, a, b });
      }
    }
  }

  return {
    pages: numPages,
    page_sizes,
    paragraphs,
    sentences,
    lang: cjkCount > latinCount * 0.35 ? "zh" : latinCount > 40 ? "en" : "auto",
  };
}
