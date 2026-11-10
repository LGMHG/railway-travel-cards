import { canvas, recordCanvas, WIDTH, HEIGHT } from "./render.js";

const cellWidth = 85.6,
  cellHeight = (cellWidth * HEIGHT) / WIDTH,
  gap = 2;
const mm = 72 / 25.4;
const ratio = (record) =>
  record.type === "pdf" ? record.ratio : WIDTH / HEIGHT;
function contain(aspect, x, y, w, h) {
  const width = Math.min(w, h * aspect),
    height = width / aspect;
  return { x: x + (w - width) / 2, y: y + (h - height) / 2, width, height };
}
export function a4Box(record, index) {
  const x = (210 - cellWidth * 2 - gap) / 2 + (index % 2) * (cellWidth + gap);
  const y =
    (297 - cellHeight * 5 - gap * 4) / 2 +
    Math.floor(index / 2) * (cellHeight + gap);
  return contain(ratio(record), x, y, cellWidth, cellHeight);
}
function white(width, height) {
  const out = canvas(width, height),
    ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  return [out, ctx];
}
export async function a4Preview(records) {
  const scale = 3,
    [out, ctx] = white(210 * scale, 297 * scale);
  for (const [i, record] of records.entries()) {
    const b = a4Box(record, i);
    const tile = await recordCanvas(
      record,
      Math.ceil(b.width * scale),
      Math.ceil(b.height * scale),
    );
    ctx.drawImage(
      tile,
      b.x * scale,
      b.y * scale,
      b.width * scale,
      b.height * scale,
    );
  }
  return out;
}
export async function collage(records, preview = false) {
  const rows = Math.ceil(records.length / 2);
  const rowHeights = Array.from({ length: rows }, (_, i) =>
    Math.max(
      ...records.slice(i * 2, i * 2 + 2).map((r) => Math.min(2, 1 / ratio(r))),
    ),
  );
  const padding = 0.025;
  const totalHeight =
    rowHeights.reduce((a, b) => a + b, 0) + (rows + 1) * padding;
  const totalWidth = 2 + 3 * padding;
  // Bound the final browser canvas while keeping all selected items in the image.
  const unit = Math.min(
    preview ? 500 : WIDTH,
    16000 / totalHeight,
    Math.sqrt((preview ? 2e6 : 32e6) / (totalWidth * totalHeight)),
  );
  const [out, ctx] = white(totalWidth * unit, totalHeight * unit);
  let y = padding;
  for (let i = 0; i < records.length; i++) {
    const row = Math.floor(i / 2),
      record = records[i];
    const b = contain(
      ratio(record),
      (i % 2) * (1 + padding) + padding,
      y,
      1,
      rowHeights[row],
    );
    const tile = await recordCanvas(
      record,
      Math.ceil(b.width * unit),
      Math.ceil(b.height * unit),
    );
    ctx.drawImage(
      tile,
      b.x * unit,
      b.y * unit,
      b.width * unit,
      b.height * unit,
    );
    if (i % 2 === 1) y += rowHeights[row] + padding;
  }
  return out;
}
export function png(image) {
  return new Promise((resolve, reject) =>
    image.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("图片导出失败，请减少勾选数量。")),
      "image/png",
    ),
  );
}
export async function singlePng(record) {
  const blob = await png(await recordCanvas(record));
  if (record.type === "pdf") return blob;
  // PNG pHYs chunk: 11,811 pixels/metre on each axis (300 DPI), including CRC.
  const density = Uint8Array.of(
    0,
    0,
    0,
    9,
    112,
    72,
    89,
    115,
    0,
    0,
    46,
    35,
    0,
    0,
    46,
    35,
    1,
    120,
    165,
    63,
    118,
  );
  const data = await blob.arrayBuffer(),
    view = new DataView(data);
  for (let offset = 8; offset < data.byteLength; ) {
    const size = view.getUint32(offset) + 12,
      type = view.getUint32(offset + 4);
    if (type === 0x70485973 || type === 0x49444154) {
      const end = type === 0x70485973 ? offset + size : offset;
      return new Blob([blob.slice(0, offset), density, blob.slice(end)], {
        type: "image/png",
      });
    }
    offset += size;
  }
  throw new Error("PNG 文件缺少图像数据");
}
export async function makePdf(records, original) {
  if (
    original &&
    records.every(
      (r, i) => r.source === records[0].source && r.page === i + 1,
    ) &&
    records.length === records[0].source.reader.numPages
  ) {
    return new Blob([records[0].source.bytes], { type: "application/pdf" });
  }
  const { PDFDocument } = globalThis.PDFLib;
  const doc = await PDFDocument.create(),
    sources = new Map();
  let page;
  for (const [i, r] of records.entries()) {
    if (original) {
      if (!sources.has(r.source))
        sources.set(r.source, await PDFDocument.load(r.source.bytes));
      const [copy] = await doc.copyPages(sources.get(r.source), [r.page - 1]);
      doc.addPage(copy);
    } else {
      if (i % 10 === 0) page = doc.addPage([210 * mm, 297 * mm]);
      const b = a4Box(r, i % 10);
      const tile = await recordCanvas(
        r,
        r.type === "pdf" ? Math.ceil((b.width * 300) / 25.4) : WIDTH,
        r.type === "pdf" ? Math.ceil((b.height * 300) / 25.4) : HEIGHT,
      );
      const image = await doc.embedPng(await (await png(tile)).arrayBuffer());
      page.drawImage(image, {
        x: b.x * mm,
        y: (297 - b.y - b.height) * mm,
        width: b.width * mm,
        height: b.height * mm,
      });
    }
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}
export function save(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
