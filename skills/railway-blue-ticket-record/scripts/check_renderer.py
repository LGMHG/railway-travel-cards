"""Check the installed skill with a virtual trip, including the public CLI."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageDraw

from render_tickets import ASSETS, LAYOUT, prepare, render


def main():
    demo = json.loads((ASSETS / "demo-trip.json").read_text(encoding="utf-8"))
    image, _ = render(demo)
    assert image.size == (1586, 992)
    assert not ImageChops.difference(image, render(demo)[0]).getbbox()
    base = Image.open(ASSETS / LAYOUT["base"]).convert("RGB")
    delta = ImageChops.difference(base, image)
    assert delta.crop((1130, 82, 1460, 136)).getbbox()
    pen = ImageDraw.Draw(delta)
    for x, y, right, bottom in [s["box"] for s in LAYOUT["fields"].values()] + [[1130, 82, 1460, 136]]:
        pen.rectangle((x, y, right-1, bottom-1), fill="black")
    assert delta.getbbox() is None, "Static artwork changed outside ticket fields"

    minimal = {k: demo[k] for k in ("train", "date", "departure", "arrival")}
    fields = prepare(minimal)[1]
    assert all(not fields[k] for k in ("seat", "fare", "passenger"))
    assert fields["datetime"] == "2026年05月16日"
    assert prepare({**minimal, "coach": "3"})[1]["seat"] == "03车"
    assert prepare({**demo, "seat_class": "无座"})[1]["seat"] == "03车无座"
    assert prepare({**demo, "seat": "11", "berth": "上铺"})[1]["seat"] == "03车11号上铺"
    assert prepare({**minimal, "record_type": "change_fee", "fare": "0.00"})[1]["fare"] == "￥0.00元"
    assert prepare({**minimal, "record_type": "change_fee", "fare": 5})[1]["departure"] == "改签费"

    number = "110000" + "00000000" + "0000"
    private = {**demo, "id_number": number, "provenance": {"note": number}}
    for mode, expected in (("auto", "110000********0000"), ("raw", number), ("hide", "")):
        record, fields = prepare({**private, "identityMode": mode})
        assert record["id_number"] == record["provenance"]["note"] == expected
        assert fields["passenger"] == "  ".join(filter(None, (expected, demo["name"])))
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "batch.json"
        source.write_text(json.dumps([private, minimal], ensure_ascii=False), encoding="utf-8")
        command = [sys.executable, str(Path(__file__).with_name("render_tickets.py")),
                   str(source), "--out-dir", str(root / "out")]
        subprocess.run(command, check=True, capture_output=True)
        png = root / "out" / (demo["id"] + ".png")
        digest = hashlib.sha256(png.read_bytes()).hexdigest()
        with Image.open(png) as output:
            assert all(abs(dpi-300) < .01 for dpi in output.info["dpi"])
        note = png.with_suffix(".record.json").read_text(encoding="utf-8")
        assert number not in note and json.loads(note)["image_sha256"] == digest
        assert len(list(png.parent.glob("*.png"))) == 2
        assert subprocess.run(command, capture_output=True).returncode != 0
        assert hashlib.sha256(png.read_bytes()).hexdigest() == digest
    print("PASS: v03 artwork, seat and fee fields, identity modes, batch PNGs, DPI, hashes and overwrite protection")


if __name__ == "__main__":
    main()
