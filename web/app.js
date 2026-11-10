import { initBatch } from "./batch.js";
import { demo, recordCanvas, readPdf, title } from "./render.js";
import { a4Preview, collage, makePdf, png, singlePng, save } from "./output.js";

const $ = (id) => document.getElementById(id);
const form = $("form"),
  fields = form.elements,
  format = $("format"),
  dialog = $("dialog");
const items = [];
let mode = "manual",
  editing = null,
  proofVersion = 0,
  sheetVersion = 0,
  previewPage = 0,
  busy = false;
let sheetRecords = [],
  sheetFormat = "",
  previousSelectionKind = "";
const selected = () => items.filter((item) => item.checked);
const notify = (text) => {
  $("status").textContent = text;
};
function renderInto(target, image) {
  target.width = image.width;
  target.height = image.height;
  target.getContext("2d").drawImage(image, 0, 0);
}
function visibility() {
  const trip = fields.type.value === "trip";
  for (const e of document.querySelectorAll("[data-trip]")) e.hidden = !trip;
  for (const e of document.querySelectorAll("[data-fee]")) e.hidden = trip;
  for (const key of ["train", "departure", "arrival"])
    fields[key].required = trip;
  fields.fee.required = !trip;
  $("date-label").textContent = trip ? "乘车日期 *" : "费用日期 *";
  $("seat-field").hidden = !trip || fields.seatClass.value === "无座";
  $("berth-field").hidden = !trip || !fields.seatClass.value.includes("卧");
  for (const el of form.querySelectorAll("input,select"))
    el.disabled = !!el.closest("[hidden]");
}
function readForm() {
  const values = Object.fromEntries(
    [...new FormData(form)].map(([k, v]) => [k, v.trim()]),
  );
  if (values.train) values.train = values.train.toUpperCase();
  return values;
}
function validate(r) {
  if (!r.date) return "请选择日期";
  if (
    r.type === "trip" &&
    (!r.train ||
      !r.departure?.replace(/站$/, "") ||
      !r.arrival?.replace(/站$/, ""))
  )
    return "请填写车次、出发站和到达站";
  if (r.type === "fee" && !r.fee) return "请填写改签费用";
  if (
    r.identity &&
    !/^(?=.{4,32}$)[A-Za-z0-9]*\*{2,}[A-Za-z0-9]*$/.test(r.identity)
  )
    return "证件号请只填打码文本，中间至少使用两个 *";
  if (
    [...form.querySelectorAll("input")].some(
      (el) => !el.disabled && !el.validity.valid,
    )
  )
    return "请检查日期、时间和金额";
  return "";
}
async function proof(r, label, caption) {
  const version = ++proofVersion;
  try {
    const image = await recordCanvas(r, 850, 1100);
    if (version === proofVersion) {
      renderInto($("proof"), image);
      $("proof-label").textContent = label;
      $("proof-caption").textContent = caption;
    }
  } catch (error) {
    if (version === proofVersion) notify("预览失败：" + error.message);
  }
}
function draft() {
  const r = readForm();
  if (!validate(r)) return proof(r, "当前填写", title(r));
  return proof(demo, "示例票面", "虚构行程示例 · 填写必填项后显示你的票面");
}
function showItem(r) {
  return proof(r, r.type === "pdf" ? "导入页面" : "已添加", title(r));
}
function switchMode(next) {
  mode = next;
  $("manual-tab").setAttribute("aria-pressed", String(next === "manual"));
  $("import-tab").setAttribute("aria-pressed", String(next === "import"));
  $("batch-tab").setAttribute("aria-pressed", String(next === "batch"));
  $("batch-panel").hidden = next !== "batch";
  form.hidden = next !== "manual";
  $("import-panel").hidden = next !== "import";
  if (next === "manual") {
    visibility();
    draft();
  } else if (next === "import") {
    const row = items.find((i) => i.type === "pdf");
    if (row) showItem(row);
    else proof(demo, "示例票面", "选择官方 PDF 后显示页面预览");
  }
}
function resetForm() {
  form.reset();
  editing = null;
  $("add").textContent = "＋ 添加到清单";
  $("cancel-edit").hidden = true;
  visibility();
}
function edit(r) {
  switchMode("manual");
  resetForm();
  editing = r;
  for (const [key, v] of Object.entries(r)) {
    const el = fields.namedItem(key);
    if (el && "value" in el) el.value = v;
  }
  visibility();
  $("add").textContent = "保存修改";
  $("cancel-edit").hidden = false;
  draft();
  form.scrollIntoView({ block: "center" });
  fields.date.focus();
}
function action(text, fn, label = text) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.onclick = fn;
  return btn;
}
function updateControls() {
  const list = selected(),
    n = list.length;
  const kind =
    n === 0 ? "empty" : list.every((x) => x.type === "pdf") ? "pdf" : "trips";
  if (kind !== previousSelectionKind && kind !== "empty")
    format.value = kind === "pdf" ? "original" : "a4";
  previousSelectionKind = kind;
  for (const option of format.options)
    option.disabled =
      (option.value === "original" && kind !== "pdf") ||
      (option.value === "single" && n !== 1) ||
      (option.value === "collage" && n < 2);
  if (n && format.selectedOptions[0].disabled)
    format.value = kind === "pdf" ? "original" : "a4";
  $("count").textContent = "已选 " + n + " / " + items.length;
  $("download").disabled = $("layout").disabled = !n || busy;
  $("files").disabled = busy;
  $("guide").textContent = {
    a4: "A4 纵向 · 两列五行 · 每张票面宽 85.6 毫米。打印时选择 A4、实际大小／100%。",
    original:
      "按原页面尺寸输出。打印时按文件页面大小选纸，缩放选择实际大小／100%。",
    single: "导出当前勾选的单张图片。手填票面为 1586 × 992 像素。",
    collage: "按清单顺序从左至右双列拼接，最后一行自动留白。",
  }[format.value];
}
function refresh() {
  const root = $("rows");
  root.replaceChildren();
  $("empty").hidden = !!items.length;
  for (const [i, r] of items.entries()) {
    const row = document.createElement("div");
    row.className = "row";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = r.checked;
    check.setAttribute("aria-label", "选择 " + title(r));
    check.onchange = () => {
      r.checked = check.checked;
      updateControls();
    };
    const name = action(title(r), () => showItem(r), "预览 " + title(r));
    name.className = "row-title";
    const move = (offset) => {
      [items[i], items[i + offset]] = [items[i + offset], items[i]];
      refresh();
    };
    const up = action("↑", () => move(-1), "上移"),
      down = action("↓", () => move(1), "下移");
    up.disabled = i === 0;
    down.disabled = i === items.length - 1;
    row.append(check, name, up, down);
    if (r.type !== "pdf") row.append(action("编辑", () => edit(r)));
    row.append(
      action("删除", () => {
        items.splice(i, 1);
        if (editing === r) resetForm();
        if (items.length) showItem(items[Math.min(i, items.length - 1)]);
        else if (mode === "manual") draft();
        else switchMode("import");
        refresh();
        notify("已删除记录");
      }),
    );
    root.append(row);
  }
  updateControls();
}
form.oninput = () => {
  visibility();
  draft();
};
form.onsubmit = (e) => {
  e.preventDefault();
  const r = readForm(),
    error = validate(r);
  if (error) {
    notify(error);
    return;
  }
  const index = editing ? items.indexOf(editing) : -1;
  const row = {
    ...r,
    standing:
      r.seatClass === "无座" ||
      !!(editing?.standing && r.seatClass === editing.seatClass && !r.seat),
    checked: index >= 0 ? items[index].checked : true,
  };
  if (editing) {
    for (const key of ["id", "serial", "footer"])
      if (editing[key]) row[key] = editing[key];
    if (editing.provenance) {
      row.provenance = { ...editing.provenance };
      for (const key of ["fare", "time"])
        if (row[key] !== editing[key])
          row.provenance[key] = { kind: "用户修改" };
    }
  }
  if (index >= 0) items[index] = row;
  else items.push(row);
  resetForm();
  refresh();
  showItem(row);
  notify(index >= 0 ? "已保存修改" : "已添加到排印清单");
};
$("cancel-edit").onclick = () => {
  resetForm();
  draft();
};
initBatch((records) => {
  items.push(...records);
  refresh();
  if (records.length) showItem(records[0]);
}, notify);
$("batch-tab").onclick = () => switchMode("batch");
$("manual-tab").onclick = () => switchMode("manual");
$("import-tab").onclick = () => switchMode("import");
$("files").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  busy = true;
  updateControls();
  notify("正在读取 PDF…");
  const added = [];
  const errors = [];
  for (const file of files) {
    try {
      added.push(...(await readPdf(file)));
    } catch (error) {
      errors.push(
        file.name +
          "：" +
          (error.name === "PasswordException"
            ? "文件有密码，请选择已解锁的 PDF。"
            : "无法读取 PDF，请检查文件。"),
      );
    }
  }
  for (const r of added) items.push({ ...r, checked: true });
  e.target.value = "";
  busy = false;
  refresh();
  if (added.length) showItem(added[0]);
  notify(["已导入 " + added.length + " 页", ...errors].join("　"));
};
const numPages = () =>
  sheetFormat === "a4"
    ? Math.ceil(sheetRecords.length / 10)
    : sheetFormat === "original"
      ? sheetRecords.length
      : 1;
async function showSheet(page) {
  previewPage = page;
  const version = ++sheetVersion;
  $("page-info").textContent = "第 " + (page + 1) + " / " + numPages() + " 页";
  $("prev").disabled = page === 0;
  $("next").disabled = page === numPages() - 1;
  const sheet = $("sheet");
  sheet.hidden = true;
  try {
    const image =
      sheetFormat === "a4"
        ? await a4Preview(sheetRecords.slice(page * 10, page * 10 + 10))
        : sheetFormat === "collage"
          ? await collage(sheetRecords, true)
          : await recordCanvas(sheetRecords[page], 850, 1150);
    if (version === sheetVersion) {
      renderInto(sheet, image);
      sheet.hidden = false;
    }
  } catch (error) {
    if (version === sheetVersion) {
      dialog.close();
      notify("排版预览失败：" + error.message);
    }
  }
}
$("layout").onclick = () => {
  sheetRecords = selected();
  sheetFormat = format.value;
  dialog.showModal();
  showSheet(0);
};
$("prev").onclick = () => showSheet(previewPage - 1);
$("next").onclick = () => showSheet(previewPage + 1);
$("close").onclick = () => dialog.close();
dialog.onclose = () => {
  sheetVersion++;
  sheetRecords = [];
};
format.onchange = updateControls;
$("download").onclick = async () => {
  const rows = selected(),
    type = format.value;
  if (!rows.length || busy) return;
  busy = true;
  updateControls();
  notify("正在生成文件…");
  try {
    if (type === "single") save(await singlePng(rows[0]), "单张记录.png");
    else if (type === "collage")
      save(await png(await collage(rows)), "多张拼图.png");
    else
      save(
        await makePdf(rows, type === "original"),
        type === "original" ? "原尺寸排印.pdf" : "A4十张排印.pdf",
      );
    notify("文件已生成");
  } catch (error) {
    notify("导出失败：" + error.message);
  } finally {
    busy = false;
    updateControls();
  }
};
visibility();
refresh();
draft();
if (location.hash === "#batch") switchMode("batch");
