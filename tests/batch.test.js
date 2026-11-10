import test from "node:test";
import assert from "node:assert/strict";
import {
  displayIdentity,
  applyPassenger,
  parsePaste,
  parseScreenshot,
  legacy,
  problems,
  samePassengerTrip,
} from "../web/batch-data.js";
import { matchTrain, RailLookup, validQuery } from "../worker/index.js";

test("free text and Excel headers, optional blanks, identity masking", () => {
  const [a, b] = parsePaste(
    "2025-10-08 G1538 安顺西→武汉 二等座\n2026/3/4 K100 云桥至南川 硬卧 8车11号下铺",
  );
  assert.deepEqual(
    [a.record.train, a.record.arrival, b.record.date, b.record.berth],
    ["G1538", "武汉", "2026-03-04", "下铺"],
  );
  const [tab] = parsePaste(
    "日期\t车次\t出发站\t到达站\t票价\n2026-01-09\t4818\t云桥\t南川\t0",
  );
  assert.equal(tab.record.fare, "0");
  assert.deepEqual(problems(tab.record), []);
  const [entry] = parsePaste(
    "2026-01-01 DEMO01 云灯谷→星栖湾 110101199001010011",
  );
  assert.equal(entry.record.train, "DEMO01");
  assert.deepEqual(problems(entry.record), []);
  assert.equal(displayIdentity(entry.record.identity), "110101********0011");
  assert(!entry.sources[0].text.includes(entry.record.identity));
  assert(problems({ ...a.record, date: "2026-02-30" }).length);
});
const line = (text, y, x = 0.3) => ({ text, y, x, confidence: 95 });
test("multi-passenger order has separate amounts; order total is only a note", () => {
  const rows = parseScreenshot(
    {
      lines: [
        line("乘车日期:2026年01月01日", 0.1),
        line("订单号: 示例", 0.2),
        line("G100", 0.3, 0.5),
        line("云桥", 0.32, 0.2),
        line("南川", 0.32, 0.8),
        line("乘车人:李甲", 0.45),
        line("二等座 01车 03A号", 0.47),
        line("票价:65.5", 0.49),
        line("乘车人:李乙", 0.55),
        line("二等座 01车 03B号", 0.57),
        line("订单总额 ¥131", 0.67),
      ],
    },
    { label: "示例" },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].record.fare, "65.5");
  assert.equal(rows[1].record.fare, "");
  assert.match(rows[1].note, /131/);
  assert.equal(rows[1].record.seat, "03B");
  assert(!samePassengerTrip(rows[0].record, rows[1].record));
  assert(
    !samePassengerTrip(
      { ...rows[0].record, name: "" },
      { ...rows[0].record, name: "" },
    ),
  );
});
test("points expiry does not become trip date; points never become fare", () => {
  const [list] = parseScreenshot(
    {
      lines: [line("我的积分", 0.1), line("乘车积分 2027.11.08到期 +125", 0.4)],
    },
    {},
  );
  assert(problems(list.record).length);
  assert.match(list.note, /详情/);
  const [row] = parseScreenshot(
    {
      modal: true,
      lines: [
        line("订单号:示例", 0.15),
        line("K10", 0.32, 0.5),
        line("南川", 0.34, 0.2),
        line("云桥", 0.34, 0.8),
        line("2026年8月9日", 0.37, 0.5),
        line("硬座 2车3号", 0.56),
        line("积分有效期:2027年8月9日", 0.62),
      ],
    },
    {},
  );
  assert.equal(row.record.date, "2026-08-09");
  assert.equal(row.record.fare, "");
});
test("old JSON keeps fee, display identifiers, no-seat, source and masked id", () => {
  const r = legacy({
    record_type: "change_fee",
    date: "2025-12-01",
    fare: 2,
    train: "D8",
    departure: "南川",
    arrival: "云桥",
    serial: "EXAMPLE",
    id_number: "110101199001010011",
    provenance: { kind: "screenshot" },
  });
  assert.equal(r.fee, "2");
  assert.equal(r.serial, "EXAMPLE");
  assert.equal(r.provenance.kind, "screenshot");
  assert.equal(displayIdentity(r.identity), "110101********0011");
  assert.equal(displayIdentity(r.identity, "raw"), "110101199001010011");
  assert.deepEqual(problems(r), []);
  assert.equal(
    legacy({ standing: true, seat: "12", seat_class: "硬座" }).seat,
    "",
  );
});
test("passenger defaults fill blanks while preserving other travellers and masked source values", () => {
  const defaults = {
    name: "虚构甲",
    identity: "P12345678",
    identityMode: "raw",
  };
  const own = { name: "", identity: "" };
  applyPassenger(own, defaults);
  assert.deepEqual(own, defaults);
  const other = { name: "虚构乙", identity: "" };
  applyPassenger(other, defaults);
  assert.equal(other.identity, "");
  assert.equal(other.name, "虚构乙");
  const maskedSource = { name: defaults.name, identity: "P1****78" };
  applyPassenger(maskedSource, defaults);
  assert.equal(displayIdentity(maskedSource.identity, "raw"), "P1****78");
  assert.equal(displayIdentity(own.identity, "auto"), "P1****78");
  assert.equal(displayIdentity(own.identity, "hide"), "");
  for (const mode of ["auto", "raw", "hide"])
    assert.equal(displayIdentity("", mode), "");
});

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const q = {
  date: today,
  train: "G123",
  departure: "云桥",
  arrival: "南川",
  seatClass: "二等座",
  berth: "",
};
const upstream = {
  station: "云桥站",
  endstation: "南川",
  trainno: "G123",
  departuretime: "09:21",
  priceed: "65.00",
  priceyw1: "50",
  priceyw3: "90",
  pricewz: "0.0",
};
test("exact train and segment, historical evidence, berth specificity", () => {
  assert(validQuery(q));
  assert(!validQuery({ ...q, name: "泄露" }));
  assert.equal(matchTrain([upstream], q, today, today).fare, "65.00");
  assert.equal(
    matchTrain([upstream], { ...q, seatClass: "硬卧" }, today, today).fare,
    "",
  );
  assert.equal(
    matchTrain(
      [upstream],
      { ...q, seatClass: "硬卧", berth: "下铺" },
      today,
      today,
    ).fare,
    "90",
  );
  assert.equal(
    matchTrain([upstream], { ...q, date: "2020-01-01" }, "2020-01-01", today),
    null,
  );
  assert.equal(
    matchTrain([upstream], { ...q, date: "2020-01-01" }, today, today).kind,
    "现行参考值",
  );
  assert.equal(
    matchTrain([upstream], { ...q, departure: "云桥南" }, today, today),
    null,
  );
  assert.equal(
    matchTrain([upstream], { ...q, seatClass: "无座" }, today, today).fare,
    "",
  );
});
test("lookup reserves lifetime calls, groups concurrent requests, cache still works after exhaustion", async (t) => {
  const data = new Map();
  const storage = {
    get: async (k) => data.get(k),
    put: async (k, v) => data.set(k, v),
    transaction: (fn) => fn(storage),
  };
  const obj = new RailLookup(
    { storage },
    { FREE_CALL_LIMIT: "1", JISU_APPKEY: "test-only" },
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ status: 0, result: [upstream] });
  });
  const run = async (rows) =>
    (
      await (
        await obj.fetch(
          new Request("https://test/", {
            method: "POST",
            body: JSON.stringify({ rows }),
          }),
        )
      ).json()
    ).results;
  const [a, b] = await Promise.all([run([q, q]), run([q])]);
  assert.equal(calls, 1);
  assert.equal(a[0].time, "09:21");
  assert.equal(b[0].fare, "65.00");
  assert.match((await run([{ ...q, arrival: "东城" }]))[0].note, /额度/);
  assert.equal(calls, 1);
  assert.equal((await run([q]))[0].fare, "65.00");
});
