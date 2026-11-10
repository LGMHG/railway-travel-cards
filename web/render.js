import { drawTicket } from "./ticket.js";
export const WIDTH = 1586,
  HEIGHT = 992;
export const demo = {
  type: "trip",
  date: "2026-05-16",
  departure: "云桥",
  arrival: "南川",
  train: "G1234",
  time: "09:20",
  seatClass: "二等座",
  coach: "03",
  seat: "08A",
  fare: "68.00",
  name: "示例旅客",
  identity: "1100000000****0000",
};
export function canvas(width, height) {
  const result = document.createElement("canvas");
  result.width = Math.max(1, Math.round(width));
  result.height = Math.max(1, Math.round(height));
  return result;
}
export const station = (s) => (s ? s.replace(/站$/, "") + "站" : "");
export function title(r) {
  if (r.type === "pdf") return r.source.filename + " · 第 " + r.page + " 页";
  return (
    r.date +
    " · " +
    (r.type === "fee"
      ? "改签费"
      : r.train + "　" + station(r.departure) + " → " + station(r.arrival))
  );
}
export async function recordCanvas(record, width = WIDTH, maxHeight = 4096) {
  if (record.type === "pdf") {
    const page = await record.source.reader.getPage(record.page);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(width / base.width, maxHeight / base.height),
    });
    const out = canvas(viewport.width, viewport.height);
    await page.render({
      canvasContext: out.getContext("2d"),
      canvas: out,
      viewport,
    }).promise;
    return out;
  }
  return drawTicket(record, canvas, width);
}
export async function readPdf(file) {
  const pdfjs = await import("./vendor/pdfjs/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "./vendor/pdfjs/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    cMapUrl: "./vendor/pdfjs/cmaps/",
    cMapPacked: true,
    wasmUrl: "./vendor/pdfjs/wasm/",
    standardFontDataUrl: "./vendor/pdfjs/standard_fonts/",
    iccUrl: "./vendor/pdfjs/iccs/",
  });
  const reader = await task.promise;
  const source = { filename: file.name, bytes, reader };
  try {
    const records = [];
    for (let number = 1; number <= reader.numPages; number++) {
      const page = await reader.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      records.push({
        type: "pdf",
        source,
        page: number,
        ratio: width / height,
      });
    }
    return records;
  } catch (error) {
    await reader.destroy();
    throw error;
  }
}
