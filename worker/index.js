const provider = "https://m.jisuapi.com/api/train/";
const keys = ["date", "train", "departure", "arrival", "seatClass", "berth"];
const prices = {
  二等座: "priceed",
  一等座: "priceyd",
  商务座: "pricesw",
  特等座: "pricetd",
  无座: "pricewz",
  硬座: "priceyz",
  软座: "pricerz",
  动卧: "pricedw",
};
const normalize = (s) =>
  String(s ?? "")
    .trim()
    .replace(/站$/, "");
const chinaDate = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function validQuery(q) {
  if (
    !q ||
    typeof q !== "object" ||
    Object.keys(q).some((k) => !keys.includes(k))
  )
    return false;
  if (
    keys.some(
      (k) =>
        q[k] !== undefined && (typeof q[k] !== "string" || q[k].length > 40),
    )
  )
    return false;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(q.date) &&
    Number.isFinite(Date.parse(q.date)) &&
    new Date(q.date).toISOString().startsWith(q.date + "T") &&
    /^[A-Z]?\d{1,5}$/.test(q.train) &&
    [q.departure, q.arrival].every((s) =>
      /^[\u3400-\u9fffA-Za-z·]{1,24}$/.test(s || ""),
    )
  );
}
export function matchTrain(rows, q, date, today) {
  const matches = rows.filter(
    (row) =>
      normalize(row.station) === normalize(q.departure) &&
      normalize(row.endstation) === normalize(q.arrival) &&
      String(row.trainno).toUpperCase() === q.train,
  );
  // Old queries sometimes return today's timetable, without a service date.
  if (date < today && !matches.some((row) => row.date === date)) return null;
  const exact = matches.filter((row) =>
    !row.date ? date >= today : row.date === date,
  );
  if (exact.length !== 1) return null;
  const row = exact[0],
    seat = (q.seatClass || "").replace(/^新空调/, "");
  let field = prices[seat];
  const berthFields = {
    硬卧: { 上铺: "priceyw1", 中铺: "priceyw2", 下铺: "priceyw3" },
    软卧: { 上铺: "pricerw1", 下铺: "pricerw2" },
    高级软卧: { 上铺: "pricegr1", 下铺: "pricegr2" },
  };
  if (Object.hasOwn(berthFields, seat)) field = berthFields[seat][q.berth];
  const raw = field && row[field];
  const fare =
    /^\d+(?:\.\d{1,2})?$/.test(String(raw)) && Number(raw) > 0
      ? String(raw)
      : "";
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.departuretime)
    ? row.departuretime
    : "";
  return {
    time,
    fare,
    kind: date === q.date ? "当日公开资料" : "现行参考值",
    valueDate: date,
    queryDate: today,
    url: provider,
    note: !field
      ? "请选择席别及适用铺位后再查票价"
      : !fare
        ? "该席别暂无可靠报价"
        : "",
  };
}
export class RailLookup {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
    this.inflight = new Map();
  }
  async fetch(request) {
    const { rows } = await request.json();
    if (
      !Array.isArray(rows) ||
      rows.length < 1 ||
      rows.length > 30 ||
      !rows.every(validQuery)
    )
      return json({ error: "查询格式无效" }, 400);
    const today = chinaDate(),
      results = [],
      batchCache = new Map();
    for (const q of rows) {
      try {
        const fields = {};
        let note = "";
        for (const date of new Set(
          q.date < today ? [q.date, today] : [q.date],
        )) {
          const key = JSON.stringify([
            date,
            normalize(q.departure),
            normalize(q.arrival),
          ]);
          let list;
          try {
            if (!batchCache.has(key))
              batchCache.set(key, this.group(q, date, today));
            list = await batchCache.get(key);
          } catch (error) {
            note = error.message;
            break;
          }
          const match = matchTrain(list, q, date, today);
          if (!match) continue;
          note = match.note;
          for (const k of ["time", "fare"])
            if (match[k] && !fields[k]) {
              fields[k] = {
                value: match[k],
                kind: match.kind,
                url: match.url,
                valueDate: match.valueDate,
                queryDate: today,
              };
            }
          if (
            fields.time &&
            (fields.fare || !q.seatClass || note.startsWith("请选择"))
          )
            break;
        }
        results.push({
          time: fields.time?.value || "",
          fare: fields.fare?.value || "",
          fields,
          note:
            note ||
            (!Object.keys(fields).length ? "查无匹配车次、日期或区间" : ""),
        });
      } catch (e) {
        results.push({ note: e.message });
      }
    }
    return json({ results });
  }
  async group(q, date, today) {
    const key = JSON.stringify([
      normalize(q.departure),
      normalize(q.arrival),
      date,
    ]);
    const cached = await this.storage.get(key);
    if (cached?.queried === today) return cached.rows;
    if (!this.inflight.has(key)) {
      const call = this.query(q, date, key, today).finally(() =>
        this.inflight.delete(key),
      );
      this.inflight.set(key, call);
    }
    return this.inflight.get(key);
  }
  async query(q, date, key, today) {
    if (!this.env.JISU_APPKEY) throw Error("查询服务尚未配置密钥");
    const budget = Number(this.env.FREE_CALL_LIMIT);
    if (!Number.isInteger(budget) || budget <= 0 || budget > 50)
      throw Error("免费额度尚未配置或已用完");
    await this.storage.transaction(async (tx) => {
      const used = (await tx.get("calls")) || 0;
      if (used >= budget) throw Error("免费查询额度已用完，可继续手动填写");
      await tx.put("calls", used + 1);
    });
    const body = new URLSearchParams({
      appkey: this.env.JISU_APPKEY,
      start: normalize(q.departure),
      end: normalize(q.arrival),
      date,
    });
    let data;
    try {
      const response = await fetch("https://api.jisuapi.com/train/station2s", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) throw Error();
      data = await response.json();
    } catch {
      throw Error("上游查询暂不可用");
    }
    if (String(data.status) === "104") {
      await this.storage.put("calls", budget);
      throw Error("供应商免费额度已用完");
    }
    if (!["0", "203"].includes(String(data.status)))
      throw Error("供应商未返回数据，请稍后再试");
    const rows = Array.isArray(data.result) ? data.result : [];
    // Large station pairs can exceed the Durable Object's per-value limit.
    // They are still shared inside this batch and between concurrent calls.
    if (new TextEncoder().encode(JSON.stringify(rows)).length < 100_000)
      await this.storage.put(key, { queried: today, rows });
    return rows;
  }
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== env.SITE_ORIGIN)
      return json({ error: "来源不匹配" }, 403);
    const headers = {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    };
    if (new URL(request.url).pathname !== "/lookup")
      return new Response(null, { status: 404, headers });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers });
    let body;
    try {
      const text = await request.text();
      if (text.length > 20000) throw Error();
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400, headers });
    }
    if (
      !Array.isArray(body?.rows) ||
      body.rows.length < 1 ||
      body.rows.length > 30 ||
      !body.rows.every(validQuery)
    )
      return new Response(null, { status: 400, headers });
    const store = env.LOOKUP.get(env.LOOKUP.idFromName("rail-free-total"));
    const result = await store.fetch("https://lookup.internal/", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return new Response(result.body, {
      status: result.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  },
};
