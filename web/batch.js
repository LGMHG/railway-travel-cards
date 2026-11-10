import {
  labels,
  masked,
  safeId,
  legacy,
  draft,
  parsePaste,
  parseScreenshot,
  problems,
  samePassengerTrip,
} from "./batch-data.js";

const $ = (id) => document.getElementById(id);
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
};
function button(text, fn) {
  const node = el("button", text);
  node.type = "button";
  node.onclick = fn;
  return node;
}
const reviewKeys = Object.keys(labels);
const queryKeys = [
  "date",
  "train",
  "departure",
  "arrival",
  "seatClass",
  "berth",
];
const queryOf = (r) =>
  Object.fromEntries(queryKeys.map((k) => [k, String(r[k] || "")]));
const evidenceLabel = (entry, fallback) => {
  if (!entry) return fallback;
  if (typeof entry === "string") return entry;
  const kind = entry.kind || fallback;
  return (
    {
      screenshot: "订单原值",
      "screenshot-displayed-price": "订单原值",
      "recent-public-reference": "现行参考值",
      "current-public-reference": "现行参考值",
      "user-provided": "用户提供",
      "legacy-public-timetable-reference": "历史公开参考",
    }[kind] || kind
  );
};

export function initBatch(addToQueue, notify) {
  const rows = [],
    files = new Map();
  let recognizing = false,
    querying = false;
  const remaining = () => rows.filter((r) => r.selected && !r.added);
  const ready = () => remaining().filter((r) => !problems(r.record).length);
  const pending = () =>
    remaining().filter((r) => Object.keys(r.pending).length);
  function draw() {
    $("batch-review").hidden = !rows.length;
    const tbody = $("batch-body");
    tbody.replaceChildren();
    for (const [idx, row] of rows.entries()) {
      const r = row.record,
        tr = el("tr"),
        choose = el("input");
      choose.type = "checkbox";
      choose.checked = row.selected && !row.added;
      choose.disabled = row.added;
      choose.setAttribute("aria-label", "选择第 " + (idx + 1) + " 条");
      choose.onchange = () => {
        row.selected = choose.checked;
        draw();
      };
      const td = el("td");
      td.append(choose);
      tr.append(td);
      for (const value of [
        row.sources.map((s) => s.label).join(" / "),
        r.date || "待补",
        r.train || (r.type === "fee" ? "改签费" : "待补"),
        [r.departure, r.arrival].filter(Boolean).join(" → ") ||
          r.related ||
          "—",
      ])
        tr.append(el("td", value));
      for (const key of ["time", r.type === "fee" ? "fee" : "fare"]) {
        const candidate = row.pending[key],
          value = r[key] || candidate?.value;
        const td = el("td", value || "—");
        if (value) {
          const source = sourceInfo(row, key);
          const fallback =
            row.sources[0].kind === "订单截图"
              ? "订单原值"
              : row.sources[0].kind;
          td.append(
            el(
              "small",
              candidate
                ? "待采用 · " + candidate.kind
                : evidenceLabel(source, fallback),
            ),
          );
        }
        tr.append(td);
      }
      const issues = problems(r);
      const state = row.added
        ? "已加入"
        : issues.length
          ? "待补 " + issues.join("、")
          : Object.keys(row.pending).length
            ? "有查询结果"
            : "已就绪";
      const status = el("td", state);
      if (!row.added && row.note) status.append(el("small", row.note));
      tr.append(status);
      const actions = el("td");
      actions.append(button("核对", () => open(row)));
      if (!row.added) {
        const match = rows.find(
          (other) =>
            other !== row &&
            !other.added &&
            samePassengerTrip(r, other.record) &&
            row.sources.some((a) =>
              other.sources.some((b) => a.kind !== b.kind),
            ),
        );
        if (match)
          actions.append(button("比较合并", () => compare(row, match)));
        actions.append(
          button("移除", () => {
            rows.splice(rows.indexOf(row), 1);
            draw();
          }),
        );
      }
      tr.append(actions);
      tbody.append(tr);
    }
    const live = rows.filter((r) => !r.added);
    $("select-batch").checked =
      live.length > 0 && live.every((r) => r.selected);
    $("select-batch").indeterminate =
      live.some((r) => r.selected) && !$("select-batch").checked;
    $("batch-commit").textContent =
      "将已就绪的 " + ready().length + " 条加入排印";
    $("batch-commit").disabled = !ready().length || querying;
    $("batch-accept").disabled = !pending().length || querying;
    $("batch-accept").textContent =
      "采用所选查询结果（" + pending().length + " 条）";
    $("batch-search").disabled =
      querying ||
      !remaining().some(
        (r) =>
          r.record.type !== "fee" &&
          (!r.record.time || !r.record.fare) &&
          !problems(r.record).length,
      );
    $("batch-identify").disabled = !remaining().length;
    $("batch-summary").textContent =
      rows.length +
      " 条 · 已加入 " +
      rows.filter((r) => r.added).length +
      " 条";
  }
  function add(list) {
    rows.push(...list);
    draw();
  }
  const sourceInfo = (row, key) =>
    row.evidence[key] || row.record.provenance?.[key];
  function sourceDetails(root, row) {
    for (const source of row.sources) {
      const group = el("details");
      group.open = row.sources.length === 1;
      group.append(el("summary", source.kind + " · " + source.label));
      if (source.image) {
        const im = el("img");
        im.src = source.image;
        im.alt = "来源截图";
        group.append(im);
      }
      if (source.text) group.append(el("pre", source.text));
      root.append(group);
    }
    if (row.record.provenance && Object.keys(row.record.provenance).length) {
      const details = el("details");
      details.append(
        el("summary", "原始来源说明"),
        el("pre", JSON.stringify(row.record.provenance, null, 2)),
      );
      root.append(details);
    }
    for (const k of ["time", "fare"]) {
      const info = sourceInfo(row, k),
        candidate = row.pending[k];
      const current = row.record[k]
        ? evidenceLabel(
            info,
            row.sources[0].kind === "订单截图"
              ? "订单原值"
              : row.sources[0].kind,
          )
        : "待补";
      root.append(el("p", labels[k] + " · " + current));
      for (const entry of [info, candidate]) {
        if (!entry || typeof entry !== "object") continue;
        const line = el(
          "p",
          [
            entry.value,
            entry.kind,
            entry.valueDate || entry.value_date,
            entry.queryDate || entry.query_date,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        if (/^https?:\/\//i.test(entry.url || "")) {
          const link = el("a", "查看来源");
          link.href = entry.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          line.append(" ", link);
        }
        root.append(line);
      }
    }
  }
  function inputFor(key, value) {
    let node = el("input");
    if (key === "type") {
      node = el("select");
      for (const [v, label] of [
        ["trip", "乘车记录"],
        ["fee", "改签费"],
      ]) {
        const op = el("option", label);
        op.value = v;
        node.append(op);
      }
    }
    if (key === "date" || key === "time") node.type = key;
    node.name = key;
    node.value = value || "";
    return node;
  }
  function prepareDialog(title) {
    $("batch-dialog-title").textContent = title;
    $("batch-editor").replaceChildren();
    $("batch-source").replaceChildren();
    $("batch-msg").textContent = "";
    $("batch-save").hidden = false;
  }
  function open(row) {
    prepareDialog("核对行程");
    for (const k of reviewKeys) {
      const label = el("label", labels[k]),
        input = inputFor(k, row.record[k]);
      input.disabled = row.added;
      if (k === "identity")
        input.oninput = () => {
          input.value = masked(input.value);
        };
      label.append(input);
      $("batch-editor").append(label);
    }
    sourceDetails($("batch-source"), row);
    if (!row.added && row.suggestedName && !row.record.name)
      $("batch-source").append(
        button("采用待核姓名 · " + row.suggestedName, () => {
          $("batch-editor").querySelector("[name=name]").value =
            row.suggestedName;
        }),
      );
    $("batch-save").hidden = row.added;
    $("batch-save").onclick = () => {
      const before = JSON.stringify(queryOf(row.record)),
        next = { ...row.record };
      for (const field of $("batch-editor").querySelectorAll("[name]"))
        next[field.name] = masked(field.value);
      if (!safeId(next.identity)) {
        $("batch-msg").textContent = "请使用已遮挡的证件号";
        return;
      }
      for (const k of reviewKeys)
        if (next[k] !== row.record[k]) {
          row.evidence[k] = { kind: next[k] ? "用户修改" : "待补" };
          delete row.pending[k];
        }
      if (before !== JSON.stringify(queryOf(next))) {
        row.pending = {};
        for (const k of ["time", "fare"])
          if (["当日公开资料", "现行参考值"].includes(row.evidence[k]?.kind)) {
            next[k] = "";
            delete row.evidence[k];
          }
      }
      if (next.seatClass !== row.record.seatClass)
        next.standing = next.seatClass === "无座";
      row.record = next;
      row.note = "";
      $("batch-dialog").close();
      draw();
    };
    $("batch-dialog").showModal();
  }
  function compare(a, b) {
    prepareDialog("核对重复行程");
    const root = $("batch-editor"),
      decisions = new Map();
    for (const k of reviewKeys.filter((k) => a.record[k] || b.record[k])) {
      const label = el("label", labels[k]),
        select = el("select");
      for (const [side, r] of [
        ["a", a],
        ["b", b],
      ]) {
        const option = el(
          "option",
          r.sources[0].kind + " · " + (r.record[k] || "空"),
        );
        option.value = side;
        select.append(option);
      }
      select.value = !a.record[k] && b.record[k] ? "b" : "a";
      label.append(select);
      root.append(label);
      decisions.set(k, select);
    }
    sourceDetails($("batch-source"), a);
    sourceDetails($("batch-source"), b);
    $("batch-save").onclick = () => {
      for (const [k, choice] of decisions)
        if (choice.value === "b") {
          a.record[k] = b.record[k];
          a.evidence[k] = sourceInfo(b, k) || { kind: b.sources[0].kind };
        }
      a.sources.push(...b.sources);
      a.pending = {};
      a.note = "已人工合并";
      rows.splice(rows.indexOf(b), 1);
      $("batch-dialog").close();
      draw();
    };
    $("batch-dialog").showModal();
  }
  $("batch-close").onclick = () => $("batch-dialog").close();

  $("batch-paste").onclick = () => {
    const list = parsePaste($("batch-text").value);
    if (!list.length) {
      notify("请先粘贴行程");
      return;
    }
    add(list);
    $("batch-text").value = "";
    notify("已读取 " + list.length + " 行");
  };
  $("batch-json").onchange = async (e) => {
    const selected = [...e.target.files];
    e.target.value = "";
    const errors = [];
    let n = 0;
    for (const file of selected)
      try {
        const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
        const list = (Array.isArray(data) ? data : [data]).map((raw, i) =>
          draft(legacy(raw), {
            kind: "已有记录",
            label: file.name + " #" + (i + 1),
          }),
        );
        add(list);
        n += list.length;
      } catch {
        errors.push(file.name + " 无法读取");
      }
    notify(["已读取 " + n + " 条", ...errors].join("；"));
  };
  function fileList() {
    const root = $("image-jobs");
    root.replaceChildren();
    for (const job of files.values()) {
      const line = el("li", job.file.name + " · " + job.status);
      if (job.failed) {
        const retry = button("重试", () => scan([job]));
        retry.disabled = recognizing;
        line.append(" ", retry);
      }
      root.append(line);
    }
  }
  async function scan(jobs) {
    if (recognizing || !jobs.length) return;
    recognizing = true;
    $("batch-images").disabled = true;
    let worker, job;
    try {
      const { openOcr, recognizeImage } = await import("./ocr.js");
      worker = await openOcr((m) => {
        if (!job || m.status !== "recognizing text") return;
        $("image-progress").textContent = job.file.name + " · 正在识别";
      });
      for (const [i, item] of jobs.entries()) {
        job = item;
        job.failed = false;
        job.status = "识别中";
        fileList();
        $("image-progress").textContent =
          "识别 " + (i + 1) + " / " + jobs.length;
        try {
          const result = await recognizeImage(worker, job.file);
          if (!result.lines.length) throw Error("未识别出文字");
          const list = parseScreenshot(result, {
            label: job.file.name,
            image: job.url,
          });
          add(list);
          job.status = "已读取 " + list.length + " 条";
        } catch {
          job.failed = true;
          job.status = "读取失败，可重试或换清晰截图";
        }
        fileList();
      }
    } catch {
      for (const item of jobs) {
        item.failed = true;
        item.status = "OCR 加载失败，可重试";
      }
    } finally {
      try {
        await worker?.terminate();
      } finally {
        recognizing = false;
        $("batch-images").disabled = false;
        fileList();
        $("image-progress").textContent = "本次识别结束";
      }
    }
  }
  $("batch-images").onchange = async (e) => {
    const picks = [...e.target.files];
    e.target.value = "";
    e.target.disabled = true;
    const jobs = [];
    let duplicate = 0;
    try {
      for (const file of picks) {
        const bytes = new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        );
        const hash = Array.from(bytes, (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        if (files.has(hash)) {
          duplicate++;
          continue;
        }
        const job = {
          file,
          url: URL.createObjectURL(file),
          status: "等待识别",
        };
        files.set(hash, job);
        jobs.push(job);
      }
      if (duplicate) notify("已跳过 " + duplicate + " 张重复截图");
      fileList();
      if (jobs.length) $("image-progress").textContent = "准备本机 OCR…";
      await scan(jobs);
    } catch {
      notify("无法读取所选图片");
    } finally {
      e.target.disabled = false;
    }
  };
  $("select-batch").onchange = (e) => {
    for (const r of rows) if (!r.added) r.selected = e.target.checked;
    draw();
  };
  $("batch-identify").onclick = () => {
    const name = $("batch-name").value.trim(),
      identity = masked($("batch-id").value);
    if (!name && !identity) {
      notify("请填写需要统一设置的姓名或打码证件号");
      return;
    }
    if (!safeId(identity)) {
      notify("请填写已遮挡的证件号");
      return;
    }
    for (const r of remaining()) {
      if (name) r.record.name = name;
      if (identity) r.record.identity = identity;
    }
    $("batch-id").value = identity;
    draw();
    notify("所选记录已更新");
  };
  $("batch-search").onclick = async () => {
    const target = remaining().filter(
      (r) =>
        r.record.type !== "fee" &&
        (!r.record.time || !r.record.fare) &&
        !problems(r.record).length,
    );
    querying = true;
    draw();
    try {
      const { url } = await (
        await fetch("./lookup-config.json", { cache: "no-store" })
      ).json();
      if (!url) throw Error("站点尚未配置免费查询服务。可继续核对并加入排印。");
      for (let i = 0; i < target.length; i += 30) {
        const part = target.slice(i, i + 30),
          queries = part.map((r) => queryOf(r.record));
        const response = await fetch(url, {
          method: "POST",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: queries }),
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw Error("查询服务暂不可用，可重试");
        const { results } = await response.json();
        if (!Array.isArray(results) || results.length !== part.length)
          throw Error("查询结果不完整");
        part.forEach((r, j) => {
          if (
            r.added ||
            JSON.stringify(queryOf(r.record)) !== JSON.stringify(queries[j])
          )
            return;
          const item = results[j];
          r.pending = {};
          r.note = item.note || "";
          for (const k of ["time", "fare"])
            if (!r.record[k] && item[k])
              r.pending[k] = item.fields?.[k] || {
                kind: item.kind,
                value: item[k],
                url: item.url,
                queryDate: item.queryDate,
                valueDate: item.valueDate,
              };
        });
      }
      notify("查询完成，核对后可批量采用");
    } catch (e) {
      notify(e.message);
    } finally {
      querying = false;
      draw();
    }
  };
  $("batch-accept").onclick = () => {
    for (const row of pending()) {
      for (const [k, info] of Object.entries(row.pending))
        if (!row.record[k]) {
          row.record[k] = info.value;
          row.evidence[k] = info;
        }
      row.pending = {};
    }
    draw();
    notify("已采用所选记录的查询结果");
  };
  $("batch-commit").onclick = () => {
    const list = ready();
    if (!list.length) return;
    addToQueue(
      list.map((row) => ({
        ...row.record,
        provenance: { ...row.record.provenance, ...row.evidence },
        checked: true,
      })),
    );
    list.forEach((r) => {
      r.added = true;
      r.selected = false;
    });
    draw();
    notify("已将 " + list.length + " 条加入排印清单");
  };
  draw();
}
