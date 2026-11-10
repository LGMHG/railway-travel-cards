import { draft, displayIdentity, normalized } from "./batch-data.js";
import { recordCanvas } from "./render.js";

function xmlInvoice(bytes) {
  const xml = new DOMParser().parseFromString(
    new TextDecoder().decode(bytes),
    "application/xml",
  );
  const fact = (key) =>
    xml.getElementsByTagNameNS("*", key)[0]?.textContent.trim() || "";
  const number = fact("ElectronicInvoiceRailwayETicketNumber");
  if (!number && !fact("TrainNumber")) return null;
  const seat = fact("Seat");
  return {
    number,
    record: {
      type: "trip",
      date: fact("TravelDate"),
      train: fact("TrainNumber"),
      departure: fact("DepartureStation"),
      arrival: fact("DestinationStation"),
      departureEn: fact("PhonicsOfDepartureStation"),
      arrivalEn: fact("PhonicsOfDestinationStation"),
      time: fact("DepartureTime").slice(0, 5),
      fare: fact("Fare"),
      seatClass: [fact("AirConditioningCharacteristics"), fact("SeatLevel")]
        .filter(Boolean)
        .join(""),
      coach: fact("Carriage").replace(/车厢?$/, ""),
      seat: seat.replace(/号|[上中下]铺/g, "").trim(),
      berth: seat.match(/[上中下]铺/)?.[0] || "",
      name: fact("Name"),
      identity: fact("IdNumber"),
    },
  };
}

// Rebuild horizontal lines before associating fields. PDF drawing order can place
// the invoice date, ticket price label, or purchaser ahead of the travel details.
function linesFrom(words) {
  const lines = [];
  for (const w of words.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const prev = lines.at(-1);
    if (prev && Math.abs(prev.y - w.y) < Math.min(prev.h, w.h) * 0.6)
      prev.words.push(w);
    else lines.push({ y: w.y, h: w.h, words: [w] });
  }
  return lines.map(({ words }) =>
    normalized(
      words
        .sort((a, b) => a.x - b.x)
        .map((w) => w.text)
        .join(" "),
    ),
  );
}
function textFields(lines) {
  const clean = lines.map((s) =>
    normalized(s).replace(/\s*([年月日时分车号:：])\s*/g, "$1"),
  );
  const trip = clean.filter(
    (s) => !/开票|购买方|税|电子客票号|发票号码|原票/.test(s),
  );
  const text = trip.join("\n");
  const train =
    /(?<![A-Za-z0-9])((?:DEMO|[GDCZTKYSLA])\s*\d{1,5}|\d{3,5})(?![A-Za-z0-9])/i;
  const route = trip.find(
    (s) =>
      train.test(s) &&
      !/票价|车厢|号|年|￥|¥/.test(s) &&
      /[\u3400-\u9fff]/.test(s.split(train)[0]) &&
      /[\u3400-\u9fff]/.test(s.split(train).at(-1)),
  );
  const sides = route?.split(train) || [];
  const standalone = trip.find((s) =>
    /^(?:DEMO|[GDCZTKYSLA])\s*\d{1,5}$/i.test(s.trim()),
  );
  const station = (s) =>
    (s || "")
      .match(/[\u3400-\u9fff]+/g)
      ?.join("")
      .replace(/站$/, "") || "";
  const travelLine = trip.find(
    (s) => /乘车日期|\d{1,2}:\d{2}开/.test(s) && /20\d{2}/.test(s),
  );
  const date = (
    travelLine || trip.slice(route ? trip.indexOf(route) + 1 : 0).join("\n")
  ).match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/);
  const seat = text.match(/(\d{1,3})车(?:厢)?\s*(\d{1,4}[A-F]?)?\s*(?:号)?/i);
  const person = trip.find((s) =>
    /(?:[\d*]{6,}[\d*Xx]+)\s*[\u3400-\u9fff·]{2,}/.test(s),
  );
  const nameId = person?.match(/([\d*]{6,}[\d*Xx]+)\s*([\u3400-\u9fff·]{2,})/);
  const pinyin =
    trip.find((s) => /^[A-Za-z]+[ \t]+[A-Za-z]+$/.test(s))?.split(/\s+/) || [];
  const time = text.match(/(\d{1,2}:\d{2})\s*开/);
  return {
    type: "trip",
    train: (
      sides[1] ||
      standalone ||
      text.match(/车次[:：]?\s*([A-Z]+\d+|\d+)/i)?.[1] ||
      ""
    ).replace(/\s/g, ""),
    departure: station(sides[0]),
    arrival: station(sides[2]),
    departureEn: pinyin[0] || "",
    arrivalEn: pinyin[1] || "",
    date: date
      ? date[1] +
        "-" +
        date[2].padStart(2, "0") +
        "-" +
        date[3].padStart(2, "0")
      : "",
    time: time?.[1].padStart(5, "0") || "",
    coach: seat?.[1] || "",
    seat: seat?.[2] || "",
    seatClass:
      text
        .replace(/\s/g, "")
        .match(
          /(?:新空调)?(?:高级软卧|硬座|硬卧|软卧|软座|动卧|二等座|一等座|商务座|特等座|无座)/,
        )?.[0] || "",
    berth: text.match(/[上中下]铺/)?.[0] || "",
    fare:
      text.match(/(?:票价[:：]?\s*[￥¥]?|[￥¥])\s*(\d+(?:\.\d{1,2})?)/)?.[1] ||
      "",
    identity: nameId?.[1] || "",
    name: nameId?.[2] || "",
  };
}
export async function invoiceDrafts(file, pages, notify) {
  const reader = pages[0].source.reader;
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", pages[0].source.bytes),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  let worker;
  const out = [];
  try {
    const attachments = await reader.getAttachments().catch(() => null);
    const invoices = Object.values(attachments || {})
      .filter((a) => /\.xml$/i.test(a.filename))
      .map((a) => xmlInvoice(a.content))
      .filter(Boolean);
    for (const item of pages) {
      const source = {
        kind: "电子发票",
        label: file.name + " · 第 " + item.page + " 页",
        file,
        page: item.page,
        pageKey: fingerprint + ":" + item.page,
      };
      let lines = [],
        invoice =
          pages.length === 1 && invoices.length === 1 ? invoices[0] : null;
      try {
        if (
          !invoice ||
          ![
            "date",
            "train",
            "departure",
            "arrival",
            "fare",
            "time",
            "seatClass",
          ].every((k) => invoice.record[k])
        ) {
          const page = await reader.getPage(item.page);
          const view = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          lines = linesFrom(
            content.items
              .filter((w) => w.str?.trim())
              .map((w) => {
                const [x, y] = view.convertToViewportPoint(
                  w.transform[4],
                  w.transform[5],
                );
                return { x, y, h: Math.abs(w.height) || 1, text: w.str };
              }),
          );
          if (
            !textFields(lines).train &&
            !lines.some(
              (s) =>
                /发票号码/.test(s) &&
                invoices.some(
                  (i) => i.number && s.replace(/\s/g, "").includes(i.number),
                ),
            )
          ) {
            notify("本机识别扫描发票 · 第 " + item.page + " 页");
            const { openOcr } = await import("./ocr.js");
            worker ||= await openOcr(() => {});
            const image = await recordCanvas(item, 2000, 3000);
            const result = await worker.layout.recognize(
              image,
              {},
              { blocks: true },
            );
            const segments = (result.data.blocks || []).flatMap((b) =>
              b.paragraphs.flatMap((p) => p.lines),
            );
            lines.push(
              ...linesFrom(
                segments.map((w) => ({
                  text: w.text,
                  x: w.bbox.x0,
                  y: w.bbox.y1,
                  h: w.bbox.y1 - w.bbox.y0,
                })),
              ),
            );
          }
        }
        const number =
          lines
            .join("")
            .replace(/\s/g, "")
            .match(/发票号码[:：]?(\d{20})/)?.[1] || "";
        invoice ||= number && invoices.find((x) => x.number === number);
        source.invoiceNumber = invoice?.number || number;
      } catch {
        source.note = "本页文字未能完整读取，请对照原件核对";
      }
      const record = textFields(lines);
      if (invoice)
        for (const [k, v] of Object.entries(invoice.record))
          if (v) record[k] = v;
      const desc = [
        record.date,
        record.train,
        record.departure,
        record.arrival,
        record.time,
        record.coach && record.coach + "车",
        record.seat && record.seat + "号",
        record.seatClass,
        record.fare && "¥" + record.fare,
        record.name,
        displayIdentity(record.identity),
      ];
      source.text = desc.filter(Boolean).join(" · ");
      out.push(
        draft(
          record,
          source,
          source.note || (!record.train ? "请对照来源页补填行程" : ""),
        ),
      );
    }
  } finally {
    try {
      await worker?.terminate();
    } finally {
      await reader.destroy();
    }
  }
  return out;
}
