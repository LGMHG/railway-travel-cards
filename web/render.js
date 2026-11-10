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
function line(ctx, points, color, width = 2) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}
function ticket(r, width) {
  const out = canvas(width, (width * HEIGHT) / WIDTH);
  const c = out.getContext("2d");
  c.scale(out.width / WIDTH, out.height / HEIGHT);
  c.beginPath();
  c.roundRect(0, 0, WIDTH, HEIGHT, 45);
  c.clip();
  const gradient = c.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#e0f3fa");
  gradient.addColorStop(0.55, "#c9e5f1");
  gradient.addColorStop(1, "#afd3e4");
  c.fillStyle = gradient;
  c.fillRect(0, 0, WIDTH, HEIGHT);
  for (let y = -200; y < HEIGHT + 80; y += 14) {
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(450, y + 210, 980, y - 140, WIDTH, y + 75);
    c.strokeStyle = "#6097b021";
    c.lineWidth = 1.5;
    c.stroke();
  }
  c.fillStyle = "#80b2ca";
  c.fillRect(0, HEIGHT - 19, WIDTH, 19);
  function field(
    value,
    left,
    top,
    right,
    bottom,
    size,
    color = "#183a4b",
    align = "left",
    wrap = false,
  ) {
    if (!value) return;
    c.font = size + 'px "Noto Serif SC", serif';
    const available = right - left;
    const advance = c.measureText(value).width;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    const x = align === "center" ? (left + right) / 2 : left;
    if (wrap && advance > 2 * available) {
      const letters = Array.from(value),
        split = Math.ceil(letters.length / 2);
      const lines = [
        letters.slice(0, split).join(""),
        letters.slice(split).join(""),
      ];
      const lineSize = Math.min(
        (bottom - top) / 2,
        (size * available) /
          Math.max(...lines.map((text) => c.measureText(text).width)),
      );
      c.font = lineSize + 'px "Noto Serif SC", serif';
      lines.forEach((text, i) =>
        c.fillText(text, x, top + ((bottom - top) * (i + 0.5)) / 2, available),
      );
    } else {
      c.font =
        Math.min(size, (size * available) / advance) +
        'px "Noto Serif SC", serif';
      c.fillText(value, x, (top + bottom) / 2, available);
    }
  }
  field("个人行程记录", 130, 72, 630, 146, 56, "#376778");
  const fee = r.type === "fee";
  if (!fee) {
    field(
      station(r.departure),
      157,
      157,
      582,
      262,
      96,
      "#183a4b",
      "left",
      true,
    );
    field(r.train, 675, 164, 960, 252, 78, "#183a4b", "center");
    field(
      station(r.arrival),
      1052,
      157,
      1435,
      262,
      96,
      "#183a4b",
      "center",
      true,
    );
    line(
      c,
      [
        [685, 280],
        [950, 280],
        [926, 268],
      ],
      "#477689",
      4,
    );
  } else {
    field("改签费", 157, 157, 660, 262, 98);
    field(r.related, 678, 157, 1435, 262, 58);
  }
  const date = r.date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
  field(
    date + (!fee && r.time ? "　" + r.time + " 开" : ""),
    125,
    331,
    845,
    397,
    54,
  );
  if (!fee) {
    const coach = r.coach ? r.coach + "车" : "";
    const position =
      r.seatClass === "无座"
        ? "无座"
        : [r.seat ? r.seat + "号" : "", /卧/.test(r.seatClass) ? r.berth : ""]
            .filter(Boolean)
            .join("");
    field(coach + position, 1025, 331, 1435, 397, 54);
    field(r.seatClass, 1060, 410, 1430, 486, 61, "#183a4b", "center");
  }
  const amount = fee ? r.fee : r.fare;
  if (amount !== "" && amount != null)
    field("￥" + amount + " 元", 125, 410, 625, 486, 63);
  line(
    c,
    [
      [125, 571],
      [1462, 571],
    ],
    "#74a0b0",
    2,
  );
  field(
    [r.identity, r.name].filter(Boolean).join("　"),
    132,
    635,
    1115,
    703,
    60,
  );
  // A route diagram drawn for this project, independent of railway issuance marks.
  const dots = [
    [1100, 774],
    [1190, 774],
    [1252, 712],
    [1410, 712],
    [1463, 659],
  ];
  line(c, dots, "#83abbc", 6);
  dots.forEach(([x, y]) => {
    c.beginPath();
    c.arc(x, y, 9, 0, Math.PI * 2);
    c.fillStyle = "#dbecf4";
    c.fill();
    c.stroke();
  });
  field("行 程 留 念", 125, 862, 720, 940, 48, "#497185");
  return out;
}
const fontMemory = new Set();
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
  const chars = [
    ...new Set(
      "个人行程记录改签费年月日开无座号车站元￥行程留念" +
        Object.values(record)
          .filter((x) => typeof x === "string")
          .join(""),
    ),
  ].filter((x) => !fontMemory.has(x));
  if (chars.length) {
    await document.fonts.load('48px "Noto Serif SC"', chars.join(""));
    chars.forEach((x) => fontMemory.add(x));
  }
  return ticket(record, width);
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
