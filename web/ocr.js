// OCR assets are loaded from the same site only after an image is selected.
const asset = (name) => new URL("./vendor/ocr/" + name, import.meta.url).href;

export async function openOcr(progress) {
  const { default: Tesseract } = await import(asset("tesseract.esm.min.js"));
  const options = {
    workerPath: asset("worker.min.js"),
    corePath: asset("core"),
    langPath: asset("lang"),
    workerBlobURL: false,
    logger: progress,
  };
  const worker = await Tesseract.createWorker("chi_sim+eng", 1, options);
  await worker.setParameters({
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  let chinese;
  return {
    layout: worker,
    async refine() {
      if (!chinese) {
        chinese = await Tesseract.createWorker("chi_sim", 1, options);
        await chinese.setParameters({ tessedit_pageseg_mode: "7" });
      }
      return chinese;
    },
    async terminate() {
      await Promise.all([worker.terminate(), chinese?.terminate()]);
    },
  };
}

// A points detail sheet is a bright, nearly full-width rectangle on a dark scrim.
function modalBounds(pixels, w, h) {
  const light = (x, y) => pixels[(Math.floor(y) * w + Math.floor(x)) * 4];
  let start = -1,
    last = -1;
  for (let y = 0; y <= h; y += 2) {
    const inside =
      y < h &&
      [0.07, 0.08, 0.91, 0.93].filter((x) => light(x * w, y) > 215).length >=
        3 &&
      light(w * 0.015, y) < 170 &&
      light(w * 0.985, y) < 170;
    if (inside) {
      if (start < 0) start = y;
      last = y;
    }
    if (!inside && start >= 0 && (y - last > h * 0.025 || y + 2 >= h)) {
      if (y - start > h * 0.15 && start > h * 0.09)
        return [
          Math.floor(0.04 * w),
          start,
          Math.ceil(0.92 * w),
          last - start + 2,
        ];
      start = -1;
    }
  }
  return null;
}

export async function recognizeImage(worker, file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1700 / bitmap.width, 4500 / bitmap.height);
  const image = document.createElement("canvas");
  image.width = Math.round(bitmap.width * scale);
  image.height = Math.round(bitmap.height * scale);
  const ctx = image.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, image.width, image.height);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  const modal = modalBounds(data.data, image.width, image.height);
  // Lift contrast on the grey text of completed railway orders.
  for (let i = 0; i < data.data.length; i += 4) {
    const grey =
      data.data[i] * 0.299 +
      data.data[i + 1] * 0.587 +
      data.data[i + 2] * 0.114;
    data.data[i] =
      data.data[i + 1] =
      data.data[i + 2] =
        Math.max(0, Math.min(255, (grey - 152) * 3 + 65));
  }
  ctx.putImageData(data, 0, 0);
  const [left, top, width, height] = modal || [0, 0, image.width, image.height];
  const result = await worker.layout.recognize(
    image,
    { rectangle: { left, top, width, height } },
    { blocks: true, text: true },
  );
  const lines = [];
  for (const block of result.data.blocks || [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const { x0, x1, y0, y1 } = line.bbox;
        lines.push({
          text: line.text.trim(),
          x: (x0 + x1) / 2 / image.width,
          y: (y0 + y1) / 2 / image.height,
          left: x0 / image.width,
          right: x1 / image.width,
          top: y0 / image.height,
          bottom: y1 / image.height,
          confidence: line.confidence,
        });
      }
  try {
    for (const line of lines) {
      const ambiguous =
        modal ||
        /本人|座|车厢|车廂/.test(line.text) ||
        (line.x > 0.3 && line.x < 0.7 && /^[0-9]{3,5}$/.test(line.text));
      if (!ambiguous || line.text.includes("订单号")) continue;
      const cw = Math.ceil((line.right - line.left) * bitmap.width),
        ch = Math.ceil((line.bottom - line.top) * bitmap.height);
      if (ch < 2 || cw < 2) continue;
      const tile = document.createElement("canvas");
      tile.height = 84;
      tile.width = Math.min(2600, Math.ceil((64 * cw) / ch) + 24);
      const tc = tile.getContext("2d");
      tc.fillStyle = "white";
      tc.fillRect(0, 0, tile.width, 84);
      tc.drawImage(
        bitmap,
        line.left * bitmap.width - 2,
        line.top * bitmap.height - 2,
        cw + 4,
        ch + 4,
        12,
        10,
        tile.width - 24,
        64,
      );
      const result = await (await worker.refine()).recognize(tile);
      const text = result.data.text.trim().normalize("NFKC");
      // Compact Chinese names sometimes split into an upper and a lower text line.
      // Try square glyphs only in the short left-hand row directly above the seat.
      const nameSlot =
        modal &&
        line.left < 0.25 &&
        lines.some(
          (other) =>
            other.y - line.y > 0.012 &&
            other.y - line.y < 0.045 &&
            /座|卧/.test(other.text),
        );
      if (
        nameSlot &&
        !(
          result.data.confidence >= 65 &&
          /^[\u3400-\u9fff]{2,6}$/.test(text.replace(/\s/g, ""))
        )
      ) {
        const count = Math.round(cw / ch);
        if (count >= 2 && count <= 5) {
          const letters = [];
          for (let n = 0; n < count; n++) {
            const glyph = document.createElement("canvas");
            glyph.width = glyph.height = 80;
            const gc = glyph.getContext("2d");
            gc.fillStyle = "#fff";
            gc.fillRect(0, 0, 80, 80);
            gc.drawImage(
              bitmap,
              line.left * bitmap.width + (cw * n) / count - 2,
              line.top * bitmap.height - 2,
              cw / count + 4,
              ch + 4,
              8,
              8,
              64,
              64,
            );
            const read = await (await worker.refine()).recognize(glyph);
            const char = read.data.text.trim();
            if (!/^[\u3400-\u9fff]$/.test(char)) break;
            letters.push(char);
          }
          if (letters.length === count) line.nameCandidate = letters.join("");
        }
      }
      if (text && result.data.confidence >= 60 && !text.includes("\n")) {
        line.text = text;
        line.confidence = result.data.confidence;
      }
    }
  } finally {
    bitmap.close();
  }
  return {
    lines: lines.sort((a, b) => a.y - b.y || a.x - b.x),
    modal: !!modal,
  };
}
