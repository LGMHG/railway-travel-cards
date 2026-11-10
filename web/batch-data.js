export const labels = {
  type: "记录类型",
  date: "乘车或费用日期",
  train: "车次",
  departure: "出发站",
  arrival: "到达站",
  time: "开车时间",
  seatClass: "席别",
  coach: "车厢",
  seat: "座号",
  berth: "铺位",
  fare: "票价",
  fee: "改签费",
  related: "关联行程",
  name: "乘车人",
  identity: "打码证件号",
  departureEn: "出发站拼音",
  arrivalEn: "到达站拼音",
};
const str = (v) => (v == null ? "" : String(v).trim());
export const masked = (text) =>
  str(text).replace(/(?<!\d)(?:\d[ \t-]*){17}[\dXx](?!\d)/g, (value) => {
    const digits = value.replace(/[ \t-]/g, "");
    return digits.slice(0, 6) + "********" + digits.slice(-4);
  });
export const safeId = (s) =>
  !s || /^(?=.{4,32}$)[a-z\d]*\*{2,}[a-z\d]*$/i.test(s);
export const normalized = (s) =>
  str(s)
    .normalize("NFKC")
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "");
const seatClassPattern =
  /新空调(?:硬卧|硬座)|高级软卧|二等座|一等座|商务座|特等座|无座|硬卧|软卧|动卧|硬座|软座/;
const trainPattern = /(?<![A-Z0-9])([GDCZTKYSLA]\s*\d{1,5})(?![A-Z0-9])/i;
function parseDate(text) {
  const m = text.match(
    /(20\d{2})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})(?:日)?/,
  );
  return m
    ? m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0")
    : "";
}
const fullDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
export function problems(r) {
  const out = [];
  if (!fullDate(r.date)) out.push("日期");
  if (r.type !== "fee")
    for (const key of ["train", "departure", "arrival"])
      if (!str(r[key]).replace(/站$/, "")) out.push(labels[key]);
  if (r.type === "fee" && !str(r.fee)) out.push("改签费");
  for (const key of ["fare", "fee"])
    if (str(r[key]) && !/^\d+(?:\.\d{1,2})?$/.test(r[key]))
      out.push(labels[key]);
  if (r.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) out.push("开车时间");
  if (!safeId(r.identity)) out.push("打码证件号");
  return [...new Set(out)];
}
function seatFields(text) {
  const m = text.match(
    /(\d{1,3})\s*车(?:厢|廂)?\s*(\d{1,4}\s*[A-F]?)?(?:\s*号)?/i,
  );
  return {
    seatClass: text.match(seatClassPattern)?.[0] || "",
    coach: m?.[1] || "",
    seat: m?.[2]?.replace(/\s/g, "").toUpperCase() || "",
    berth: text.match(/[上中下]铺/)?.[0] || "",
  };
}
function fieldsFromText(raw) {
  const text = masked(raw).normalize("NFKC");
  const route = text.match(
    /([\u3400-\u9fff]{1,20})\s*(?:→|⇒|->|—|至|到|－|-)\s*([\u3400-\u9fff]{1,20})/,
  );
  const departure =
    text.match(/(?:出发站|发站|始发站)[：:\s]+([\u3400-\u9fff]+)/)?.[1] ||
    route?.[1] ||
    "";
  const arrival =
    text.match(/(?:到达站|到站|终点站)[：:\s]+([\u3400-\u9fff]+)/)?.[1] ||
    route?.[2] ||
    "";
  const isFee = text.includes("改签费");
  const amount =
    text.match(
      /(?:[¥￥]|票价\s*[:：]?|改签费\s*[:：]?)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/,
    )?.[1] || "";
  return {
    type: isFee ? "fee" : "trip",
    date: parseDate(text),
    train: (
      text.match(trainPattern)?.[1] ||
      text.match(/车次[:：\s]+(\d{3,5})/)?.[1] ||
      ""
    )
      .replace(/\s/g, "")
      .toUpperCase(),
    departure,
    arrival,
    time:
      text.match(/(?:^|[^\d])([012]?\d:\d{2})(?!\d)/)?.[1]?.padStart(5, "0") ||
      "",
    ...seatFields(text),
    fare: isFee ? "" : amount,
    fee: isFee ? amount : "",
    name:
      text.match(/(?:姓名|乘车人|旅客)[:：\s]+([\u3400-\u9fff·]{2,16})/)?.[1] ||
      "",
    identity: text.match(/[A-Za-z\d]*\*{2,}[A-Za-z\d]*/)?.[0] || "",
  };
}
export function legacy(row) {
  if (!row || typeof row !== "object" || Array.isArray(row))
    throw Error("JSON 中每条记录必须是对象");
  const data = JSON.parse(masked(JSON.stringify(row)));
  const out = {};
  for (const k of [...Object.keys(labels), "id", "serial", "footer"])
    out[k] = masked(data[k]);
  out.type =
    row.record_type === "change_fee" ||
    row.seat_class === "改签费" ||
    row.type === "fee"
      ? "fee"
      : "trip";
  out.date = parseDate(out.date) || out.date;
  out.train = out.train.toUpperCase();
  out.seatClass = str(row.seat_class || out.seatClass);
  out.identity = masked(row.id_number || out.identity);
  if (out.identity && !safeId(out.identity)) out.identity = "";
  out.departureEn = str(row.departure_en || out.departureEn);
  out.arrivalEn = str(row.arrival_en || out.arrivalEn);
  out.standing = row.standing === true || out.seatClass === "无座";
  if (out.standing) out.seat = "";
  if (out.type === "fee") {
    out.fee = out.fee || out.fare;
    out.related =
      out.related ||
      [out.train, [out.departure, out.arrival].filter(Boolean).join(" → ")]
        .filter(Boolean)
        .join(" · ");
  }
  out.provenance = data.provenance || {};
  return out;
}
export function draft(record, source, note = "") {
  return {
    record,
    sources: [source],
    note,
    selected: true,
    added: false,
    pending: {},
    evidence: {},
  };
}
export function parsePaste(input) {
  const lines = masked(input)
    .split(/\r?\n/)
    .filter((s) => s.trim());
  const keys = Object.fromEntries(
    Object.entries(labels).map(([key, label]) => [label, key]),
  );
  Object.assign(keys, {
    日期: "date",
    乘车日期: "date",
    金额: "fare",
    发车时间: "time",
    姓名: "name",
    座位: "seat",
    到站: "arrival",
    发站: "departure",
  });
  const header = lines[0]?.split("\t").map((s) => keys[s.trim()]);
  const columns =
    header?.includes("train") && header.includes("date") ? header : null;
  if (columns) lines.shift();
  return lines.map((line, i) => {
    const cells = line.split("\t").map((s) => s.trim());
    let record = fieldsFromText(line);
    if (
      columns ||
      (cells.length >= 4 &&
        parseDate(cells[0]) &&
        /^[a-z]?\d{1,5}$/i.test(cells[1]))
    ) {
      const map = columns || [
        "date",
        "train",
        "departure",
        "arrival",
        "seatClass",
        "time",
        "fare",
        "coach",
        "seat",
        "name",
        "identity",
      ];
      cells.forEach((val, n) => {
        if (map[n] && val) record[map[n]] = val;
      });
      record.date = parseDate(record.date);
      record.type =
        record.type === "改签费" || record.type === "fee" ? "fee" : "trip";
    }
    return draft(record, {
      kind: "粘贴文字",
      label: "文字第 " + (i + 1) + " 行",
      text: line,
    });
  });
}
const stationName = (s) =>
  /^[\u3400-\u9fff]{1,16}$/.test(s) &&
  !/车票|积分|订单|开车|到达|日期|出站|乘客|旅客|座|支付|改签|乘车|有效/.test(
    s,
  );
function cardRows(lines, context, source) {
  const texts = lines.map((l) => l.text),
    full = texts.join("\n");
  const passengers = lines.filter((l) =>
    /(?:乘车人|乘客|旅客|姓名)[:：]\s*[\u3400-\u9fff]/.test(l.text),
  );
  const common = passengers.length
    ? lines.filter((l) => l.y < passengers[0].y)
    : lines;
  const header = common.map((l) => l.text).join("\n");
  const rec = fieldsFromText(header);
  const trainLine = common.find(
    (l) =>
      l.x > 0.25 &&
      l.x < 0.75 &&
      /^(?:[GDCZTKYSLA]\d{1,5}|\d{3,5})$/i.test(l.text.replace(/\s/g, "")),
  );
  if (trainLine) rec.train = trainLine.text.replace(/\s/g, "").toUpperCase();
  const d = common
    .filter(
      (l) => !/(?:积分有效|到期|到账|支付日期|下单|订单日期)/.test(l.text),
    )
    .map((l) => parseDate(l.text))
    .find(Boolean);
  rec.date = d || context.date || "";
  if (trainLine) {
    const from = common.filter(
      (l) =>
        l.x < 0.38 &&
        Math.abs(l.y - trainLine.y) < 0.075 &&
        stationName(l.text),
    );
    const to = common.filter(
      (l) =>
        l.x > 0.62 &&
        Math.abs(l.y - trainLine.y) < 0.075 &&
        stationName(l.text),
    );
    const pairs = from
      .flatMap((a) =>
        to.filter((b) => Math.abs(a.y - b.y) < 0.018).map((b) => [a, b]),
      )
      .sort(
        (a, b) =>
          Math.abs(a[0].y - trainLine.y) - Math.abs(b[0].y - trainLine.y),
      );
    if (pairs.length) {
      rec.departure = pairs[0][0].text;
      rec.arrival = pairs[0][1].text;
    }
    const times = common.filter(
      (l) =>
        /^\d{1,2}:\d{2}$/.test(l.text) && Math.abs(l.y - trainLine.y) < 0.035,
    );
    rec.time =
      times.find((l) => l.x < 0.4)?.text ||
      common
        .map(
          (l) =>
            l.text.match(
              /(?:发车|开车|出发)(?:时间)?[:：\s]*(\d{2}:\d{2})/,
            )?.[1],
        )
        .find(Boolean) ||
      "";
  }
  rec.name = rec.name || context.name || "";
  const total = texts
    .filter((t) => /合计|订单总额|总价|共支付/.test(t))
    .join(" ");
  const scopes = passengers.length
    ? passengers.map((p, i) =>
        lines.filter(
          (l) =>
            l.y >= p.y - 0.002 &&
            (!passengers[i + 1] || l.y < passengers[i + 1].y - 0.002),
        ),
      )
    : [lines];
  return scopes.map((scope) => {
    const text = scope.map((l) => l.text).join("\n");
    const seat = seatFields(text);
    const row = { ...rec, ...seat };
    if (passengers.length)
      row.name =
        text.match(
          /(?:乘车人|乘客|旅客|姓名)[:：]\s*([\u3400-\u9fff·]+)/,
        )?.[1] || "";
    if (context.points && !row.name) {
      const seatLine = scope.find((l) => seatClassPattern.test(l.text));
      const person = scope
        .filter(
          (l) =>
            l.x < 0.5 &&
            l.confidence >= 65 &&
            l.y < (seatLine?.y || 0) &&
            l.y > (trainLine?.y || 0) + 0.035 &&
            /^[\u3400-\u9fff·]{2,6}$/.test(l.text),
        )
        .at(-1);
      if (person) row.name = person.text;
    }
    const totals = lines.filter((l) =>
      /合计|订单总额|总价|共支付/.test(l.text),
    );
    const amountLines = scope.filter(
      (l) =>
        !/(积分有效|到期|积分余额)/.test(l.text) &&
        !totals.some(
          (t) =>
            Math.abs(t.y - l.y) < 0.009 ||
            (lines[lines.indexOf(l) - 1] === t &&
              !/\d/.test(t.text) &&
              /^\s*[¥￥Y]?\s*\d/.test(l.text)),
        ),
    );
    const amounts = amountLines.flatMap((l) =>
      [
        ...l.text.matchAll(
          /(?:[¥￥]|(?:票价|改签费|实付金额)\s*[:：]?\s*[¥￥]?|(?<=^|\s)Y(?=\d))\s*(\d+(?:\.\d{1,2})?)/g,
        ),
      ].map((m) => m[1]),
    );
    const value = amounts.length === 1 ? amounts[0] : "";
    row.fare = row.type === "fee" ? "" : value;
    if (row.type === "fee") row.fee = value;
    if (passengers.length) row.identity = fieldsFromText(text).identity;
    const note = [
      total,
      /积分支付/.test(full) ? "积分支付，票价为票面显示金额" : "",
      context.points && !row.name ? "乘车人待核对" : "",
      amounts.length > 1 ? "金额有多个候选，需核对" : "",
    ]
      .filter(Boolean)
      .join("；");
    const entry = draft(
      row,
      {
        ...source,
        kind: context.points ? "积分详情" : "订单截图",
        text: masked(text),
      },
      note,
    );
    entry.suggestedName = row.name
      ? ""
      : scope.find((l) => l.nameCandidate)?.nameCandidate;
    return entry;
  });
}
export function parseScreenshot(result, source) {
  const lines = result.lines.map((l) => ({
    ...l,
    text: normalized(
      masked(l.text).replace(
        /(?<=[\u3400-\u9fff])\s+[一—]\s+(?=[\u3400-\u9fff])/g,
        "→",
      ),
    )
      .replace(/(?<=\d)\s+(?=[年月日车号])/g, "")
      .replace(/(?<=[年月])\s+(?=\d)/g, ""),
  }));
  const text = lines.map((l) => l.text).join("\n");
  const points = /积分有效期|积分明细|我的积分|乘车积分/.test(text);
  if (points && !result.modal && !/积分有效期/.test(text))
    return [
      draft(
        { type: "trip" },
        { ...source, kind: "积分列表", text },
        "请补充行程详情弹窗",
      ),
    ];
  const first = lines.findIndex((l) => /订单号/.test(l.text));
  const header = lines
    .slice(0, first < 0 ? lines.length : first)
    .map((l) => l.text)
    .join("\n");
  const name =
    header.match(/本人\s*["'“「]\s*([\u3400-\u9fff·]{2,12})\s*["'”」]/)?.[1] ||
    "";
  let group = [],
    date = "",
    rows = [];
  const flush = () => {
    if (group.length)
      rows.push(
        ...cardRows(
          group,
          { date, name, points: points || result.modal },
          source,
        ),
      );
    group = [];
  };
  const hasOrders = first >= 0;
  let active = !hasOrders;
  for (const line of lines) {
    if (/乘车日期/.test(line.text) && parseDate(line.text)) {
      if (
        group.some(
          (l) =>
            trainPattern.test(l.text) || /^[0-9]{3,5}$/.test(l.text.trim()),
        )
      ) {
        flush();
        active = !hasOrders;
      }
      date = parseDate(line.text);
      continue;
    }
    if (/订单号/.test(line.text)) {
      flush();
      active = true;
    }
    if (active) group.push(line);
  }
  flush();
  return rows.length
    ? rows
    : [
        draft(
          { type: "trip" },
          { ...source, text },
          "未能提取行程，请核对原图",
        ),
      ];
}
export function samePassengerTrip(a, b) {
  if (
    a.type !== "trip" ||
    b.type !== "trip" ||
    !a.name ||
    a.name !== b.name ||
    (a.identity && b.identity && a.identity !== b.identity)
  )
    return false;
  return ["date", "train", "departure", "arrival"].every(
    (k) =>
      str(a[k]) &&
      (k === "departure" || k === "arrival"
        ? str(a[k]).replace(/站$/, "") === str(b[k]).replace(/站$/, "")
        : a[k] === b[k]),
  );
}
