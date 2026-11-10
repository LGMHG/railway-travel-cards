"""Render individual v03 travel records from a JSON object or array, offline."""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parents[1] / "assets"
LAYOUT = json.loads((ASSETS / "layout.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=32)
def get_font(key, size):
    names = {
        "cn": ("simsun.ttc", "Songti.ttc", "NotoSerifCJK-Regular.ttc", "NotoSansCJK-Regular.ttc"),
        "latin": ("times.ttf", "Times New Roman.ttf", "DejaVuSerif.ttf"),
        "latin_bold": ("timesbd.ttf", "Times New Roman Bold.ttf", "DejaVuSerif-Bold.ttf"),
        "sans": ("arial.ttf", "Arial.ttf", "DejaVuSans.ttf"),
    }
    for name in names[key]:
        try:
            # Noto CJK collection face 2 is Simplified Chinese.
            return ImageFont.truetype(name, size, index=2 if "CJK" in name else 0)
        except OSError:
            continue
    if key != "cn":
        return get_font("cn", size)
    raise ValueError("找不到中文字体。请安装 Noto Serif CJK SC 或 Noto Sans CJK SC 的 TTC 字体包。")


def text(value):
    return "" if value is None else str(value).strip()


def display_id(value, mode):
    if mode not in ("auto", "raw", "hide"):
        raise ValueError("identityMode 须为 auto、raw 或 hide")
    if mode == "hide" or not value:
        return ""
    if mode == "raw" or any(c in value for c in "*＊•●"):
        return value
    compact = re.sub(r"[\s-]", "", value)
    if re.fullmatch(r"\d{17}[\dXx]", compact):
        return compact[:6] + "********" + compact[-4:]
    return compact[:2] + "****" + compact[-2:] if len(compact) > 4 else "****"


def amount_text(value):
    if not text(value):
        return ""
    try:
        amount = Decimal(text(value))
        if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.01")):
            raise ValueError("金额须为非负数，最多两位小数")
    except InvalidOperation as error:
        raise ValueError("金额格式有误") from error
    digits = 2 if amount.as_tuple().exponent <= -2 or amount * 10 % 1 else 1
    return f"￥{amount:.{digits}f}元"


def seat_text(item):
    coach = text(item.get("coach"))
    prefix = coach.zfill(2) + "车" if coach else ""
    if item.get("standing") or item.get("seat_class") == "无座":
        return prefix + "无座"
    berth = text(item.get("berth"))
    if berth and berth not in ("上铺", "中铺", "下铺"):
        raise ValueError("铺位须为上铺、中铺或下铺")
    seat = text(item.get("seat")).upper()
    if not seat:
        return prefix + berth
    if seat.isdigit():
        seat = str(int(seat)).zfill(2 if berth else 3)
    elif match := re.fullmatch(r"(\d+)([A-F])", seat):
        seat = str(int(match[1])).zfill(2) + match[2]
    return prefix + seat + "号" + berth


def prepare(record):
    if not isinstance(record, dict):
        raise ValueError("每条行程须为 JSON 对象")
    item = dict(record)
    fee = (item.get("record_type") == "change_fee" or item.get("type") == "fee"
           or item.get("seat_class") == "改签费")
    day = datetime.strptime(text(item.get("date")), "%Y-%m-%d")
    date_label = day.strftime("%Y年%m月%d日")
    train = text(item.get("train")).upper()
    departure = text(item.get("departure")).removesuffix("站")
    arrival = text(item.get("arrival")).removesuffix("站")
    if not fee and not all((train, departure, arrival)):
        raise ValueError("乘车记录需要车次、出发站和到达站")
    time = text(item.get("time"))
    if time and not fee:
        date_label += datetime.strptime(time, "%H:%M").strftime(" %H:%M开")
    price = amount_text(item.get("fee", item.get("fare")) if fee else item.get("fare"))
    if fee and not price:
        raise ValueError("请填写改签费用")
    if fee:
        item["record_type"] = "change_fee"
    if not text(item.get("id")):
        key = [day.date().isoformat(), train, departure, arrival, item.get("name"), item.get("seat"), fee, time, price]
        item["id"] = day.strftime("%Y%m%d") + "_" + hashlib.sha256(
            json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:12]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", str(item["id"])):
        raise ValueError("id 仅可含 ASCII 字母、数字、下划线和短横线")
    item["id"] = str(item["id"])
    serial_seed = int.from_bytes(hashlib.sha256(item["id"].encode()).digest()[:4], "big") % 1000000
    item["serial"] = text(item.get("serial")) or f"Z30M{serial_seed:06d}"
    item["footer"] = text(item.get("footer")) or f"16805301041001M{serial_seed:06d} JM"
    identity = text(item.pop("identity", ""))
    identity = text(item.get("id_number")) or identity
    mode = item.get("identityMode", "auto")
    shown = display_id(identity, mode)
    item["id_number"] = shown
    # Legacy notes can repeat the supplied ID. Apply the same choice to those strings.
    if identity and identity != shown:
        def redact(value):
            if isinstance(value, str):
                return value.replace(identity, shown)
            if isinstance(value, list):
                return [redact(v) for v in value]
            if isinstance(value, dict):
                return {k: redact(v) for k, v in value.items()}
            return value
        if "provenance" in item:
            item["provenance"] = redact(item["provenance"])
    related = text(item.get("related")) or " · ".join(filter(None, (train, " → ".join(filter(None, (departure, arrival))))))
    fields = dict(
        serial=item["serial"], footer=item["footer"], train="" if fee else train,
        departure="改签费" if fee else departure + "站", arrival=related if fee else arrival + "站",
        departure_en="" if fee else text(item.get("departure_en")),
        arrival_en="" if fee else text(item.get("arrival_en")),
        datetime=date_label, fare=price, seat="" if fee else seat_text(item),
        seat_class="改签费" if fee else text(item.get("seat_class")),
        passenger="  ".join(filter(None, (shown, text(item.get("name"))))),
    )
    return item, fields


def paint(image, value, spec):
    if not value:
        return
    x0, y0, x1, y1 = spec["box"]
    font = get_font(spec["font"], spec["size"])
    ascii_font = get_font(spec.get("ascii_font", spec["font"]), spec.get("ascii_size", spec["size"]))
    suffix_font = get_font(spec["font"], spec.get("station_suffix_size", spec["size"]))
    stroke = spec.get("stroke", 0)
    color = spec.get("color", "#101010")
    glyphs = [(char, suffix_font if char == "站" and spec.get("spread") else ascii_font if char.isascii() else font) for char in value]
    width = sum(selected.getlength(char) for char, selected in glyphs)
    gap = max(0, (x1-x0-width) / max(1, len(value)-1)) if spec.get("spread") else 0
    ascent = max(selected.getmetrics()[0] for _, selected in glyphs)
    descent = max(selected.getmetrics()[1] for _, selected in glyphs)
    tile = Image.new("RGBA", (int(width+gap*max(0,len(value)-1))+12, ascent+descent+12))
    pen, offset = ImageDraw.Draw(tile), 6.0
    for char, selected in glyphs:
        pen.text((offset, ascent+6), char, font=selected, fill=color, stroke_width=stroke, anchor="ls")
        offset += selected.getlength(char) + gap
    tile = tile.crop(tile.getbbox())
    scale = min(1, (x1-x0)/tile.width, (y1-y0)/tile.height)
    if scale < 1:
        tile = tile.resize((max(1, round(tile.width*scale)), max(1, round(tile.height*scale))), Image.Resampling.LANCZOS)
    x = x0 + ((x1-x0-tile.width)//2 if spec.get("align") == "center" else 0)
    y = y0 + (y1-y0-tile.height)//2
    image.paste(tile, (x, y), tile)


def render(record):
    item, fields = prepare(record)
    with Image.open(ASSETS / LAYOUT["base"]) as template:
        image = template.convert("RGB")
    for field, spec in LAYOUT["fields"].items():
        paint(image, fields[field], spec)
    paint(image, "个人行程记录", dict(box=[1130, 82, 1460, 136], font="cn",
                                   size=42, color="#415965", align="center"))
    return image, item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="UTF-8 JSON 对象或数组")
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8-sig"))
    records = data if isinstance(data, list) else [data]
    ids = [prepare(record)[0]["id"] for record in records]
    if len(set(map(os.path.normcase, ids))) != len(ids):
        raise ValueError("批内文件名重复，请给重复的记录指定不同 id")
    paths = [(args.out_dir / (i + ".png"), args.out_dir / (i + ".record.json")) for i in ids]
    for png, note in paths:
        for path in (png, note):
            if path.exists():
                raise FileExistsError(path)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        for record, (png, note) in zip(records, paths):
            image, item = render(record)
            with png.open("xb") as out:
                created.append(png)
                image.save(out, format="PNG", dpi=(300, 300))
            item["layout_version"] = LAYOUT["version"]
            item["image_sha256"] = hashlib.sha256(png.read_bytes()).hexdigest()
            item["print_identifiers"] = "Personal reconstruction values; not authenticated railway issuance data"
            with note.open("x", encoding="utf-8") as out:
                created.append(note)
                json.dump(item, out, ensure_ascii=False, indent=2)
    except BaseException:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise
    for png, _ in paths:
        print(png)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(str(error))
