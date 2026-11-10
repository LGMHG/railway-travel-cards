import { pinyin } from "./vendor/pinyin/esm/index.mjs";

let template;
function loadTemplate() {
  if (!template)
    template = (async () => {
      const url = new URL("./ticket/layout.json", import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error("无法读取票面版式");
      const layout = await response.json();
      const image = new Image();
      image.src = new URL(layout.base, url).href;
      await image.decode();
      return { layout, image };
    })().catch((error) => {
      template = null;
      throw error;
    });
  return template;
}

function romanize(station) {
  const text = pinyin(station.replace(/站$/, ""), {
    toneType: "none",
    type: "array",
  }).join("");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function seatText(r) {
  const coach = r.coach ? r.coach.padStart(2, "0") + "车" : "";
  if (r.standing || r.seatClass === "无座") return coach + "无座";
  if (!r.seat) return coach + (r.berth || "");
  let seat = r.seat.replace(/^0+(?=\d)/, "");
  if (/^\d+$/.test(seat)) seat = seat.padStart(r.berth ? 2 : 3, "0");
  else
    seat = seat.replace(
      /^(\d+)([A-F])$/i,
      (_, n, letter) => n.padStart(2, "0") + letter.toUpperCase(),
    );
  return coach + seat + "号" + (r.berth || "");
}
export async function ticketFields(r) {
  const fee = r.type === "fee";
  const departure = (r.departure || "").replace(/站$/, "");
  const arrival = (r.arrival || "").replace(/站$/, "");
  const dataKey =
    r.id ||
    [r.type, r.date, r.train, departure, arrival, r.related]
      .filter(Boolean)
      .join("_");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(dataKey),
  );
  const code = String(new DataView(digest).getUint32(0) % 1000000).padStart(
    6,
    "0",
  );
  const amount = fee ? r.fee : r.fare;
  const amountText =
    amount == null || amount === ""
      ? ""
      : Number(amount).toFixed(
          Number.isInteger(Math.round(Number(amount) * 100) / 10) ? 1 : 2,
        );
  const date = r.date.replace(/^(\d+)-(\d+)-(\d+)$/, "$1年$2月$3日");
  return {
    serial: r.serial || "Z30M" + code,
    footer: r.footer || "16805301041001M" + code + " JM",
    departure: fee ? "改签费" : departure + "站",
    arrival: fee ? r.related || "" : arrival + "站",
    departure_en: fee ? "" : r.departureEn || romanize(departure),
    arrival_en: fee ? "" : r.arrivalEn || romanize(arrival),
    train: fee ? "" : r.train,
    datetime: date + (!fee && r.time ? " " + r.time + "开" : ""),
    seat: fee ? "" : seatText(r),
    seat_class: fee ? "改签费" : r.seatClass || "",
    fare: amountText ? "￥" + amountText + "元" : "",
    passenger: [r.identity, r.name].filter(Boolean).join("  "),
  };
}

const fonts = {
  cn: '"SimSun","宋体","Noto Serif SC",serif',
  latin: '"Times New Roman","Noto Serif SC",serif',
  latin_bold: '"Times New Roman","Noto Serif SC",serif',
  sans: 'Arial,"Noto Serif SC",sans-serif',
};
// Like the Pillow renderer, measure individual glyphs, crop to their ink,
// uniformly shrink to the published field box, then align inside it.
function paint(ctx, value, spec) {
  if (!value) return;
  const [x0, y0, x1, y1] = spec.box,
    w = x1 - x0,
    h = y1 - y0;
  const glyphs = Array.from(value, (char) => {
    const ascii = char.charCodeAt(0) < 128;
    const face = ascii ? spec.ascii_font || spec.font : spec.font;
    const size =
      char === "站" && spec.spread
        ? spec.station_suffix_size || spec.size
        : ascii
          ? spec.ascii_size || spec.size
          : spec.size;
    const font =
      (face === "latin_bold" ? "bold " : "") + size + "px " + fonts[face];
    ctx.font = font;
    return { char, font, m: ctx.measureText(char) };
  });
  const total = glyphs.reduce((sum, g) => sum + g.m.width, 0);
  const gap = spec.spread
    ? Math.max(0, (w - total) / Math.max(1, glyphs.length - 1))
    : 0;
  let pen = 0,
    left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  const stroke = spec.stroke || 0;
  for (const g of glyphs) {
    g.x = pen;
    if (g.char.trim()) {
      left = Math.min(left, pen - g.m.actualBoundingBoxLeft - stroke);
      right = Math.max(right, pen + g.m.actualBoundingBoxRight + stroke);
      top = Math.min(top, -g.m.actualBoundingBoxAscent - stroke);
      bottom = Math.max(bottom, g.m.actualBoundingBoxDescent + stroke);
    }
    pen += g.m.width + gap;
  }
  if (!(right > left && bottom > top)) return;
  const scale = Math.min(1, w / (right - left), h / (bottom - top));
  const x =
    x0 + (spec.align === "center" ? (w - (right - left) * scale) / 2 : 0);
  const y = y0 + (h - (bottom - top) * scale) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.translate(x - left * scale, y - top * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = ctx.strokeStyle = spec.color || "#101010";
  ctx.lineWidth = stroke * 2;
  ctx.lineJoin = "round";
  for (const g of glyphs) {
    ctx.font = g.font;
    if (stroke) ctx.strokeText(g.char, g.x, 0);
    ctx.fillText(g.char, g.x, 0);
  }
  ctx.restore();
}
export async function drawTicket(r, makeCanvas, width) {
  const [{ layout, image }, fields] = await Promise.all([
    loadTemplate(),
    ticketFields(r),
  ]);
  const text = Object.values(fields).join("") + "个人行程记录";
  await document.fonts.load('48px "Noto Serif SC"', text);
  const [w, h] = layout.canvas,
    out = makeCanvas(width, (width * h) / w);
  const c = out.getContext("2d");
  c.scale(out.width / w, out.height / h);
  c.drawImage(image, 0, 0, w, h);
  for (const [key, spec] of Object.entries(layout.fields))
    paint(c, fields[key], spec);
  paint(c, "个人行程记录", {
    box: [1130, 82, 1460, 136],
    font: "cn",
    size: 42,
    color: "#415965",
    align: "center",
  });
  return out;
}
