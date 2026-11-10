import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const output = "dist";
await mkdir(output, { recursive: true });
await cp("web", output, { recursive: true });
const vendor = output + "/vendor";
await mkdir(vendor + "/fonts/files", { recursive: true });
await cp("node_modules/pinyin-pro/dist/esm", vendor + "/pinyin/esm", {
  recursive: true,
});
await cp("node_modules/pinyin-pro/LICENSE", vendor + "/pinyin/LICENSE");
const pdfjs = "node_modules/pdfjs-dist/";
for (const asset of [
  "build/pdf.min.mjs",
  "build/pdf.worker.min.mjs",
  "cmaps",
  "wasm",
  "iccs",
  "standard_fonts",
  "LICENSE",
]) {
  await cp(pdfjs + asset, vendor + "/pdfjs/" + asset, { recursive: true });
}
await cp(
  "node_modules/pdf-lib/dist/pdf-lib.min.js",
  vendor + "/pdf-lib.min.js",
);
await cp("node_modules/pdf-lib/LICENSE.md", vendor + "/pdf-lib-LICENSE.md");
const fonts = "node_modules/@fontsource/noto-serif-sc/";
await cp(fonts + "LICENSE", vendor + "/fonts/LICENSE");
const css = (await readFile(fonts + "400.css", "utf8")).replace(
  /, url\([^)]*\.woff\) format\('woff'\)/g,
  "",
);
await writeFile(vendor + "/fonts/font.css", css);
for (const match of css.matchAll(/url\(\.\/(files\/[^)]+)\)/g)) {
  await cp(fonts + match[1], vendor + "/fonts/" + match[1]);
}
await cp("LICENSE", output + "/LICENSE");
await writeFile(output + "/.nojekyll", "");

const ocr = vendor + "/ocr";
await mkdir(ocr + "/core", { recursive: true });
await mkdir(ocr + "/lang", { recursive: true });
for (const file of [
  "tesseract.esm.min.js",
  "worker.min.js",
  "worker.min.js.LICENSE.txt",
  "tesseract.min.js.LICENSE.txt",
]) {
  await cp("node_modules/tesseract.js/dist/" + file, ocr + "/" + file);
}
await cp("node_modules/tesseract.js/LICENSE.md", ocr + "/LICENSE.md");
await cp("node_modules/tesseract.js-core/LICENSE", ocr + "/core/LICENSE");
for (const variant of ["", "-simd", "-relaxedsimd"]) {
  const file = "tesseract-core" + variant + "-lstm.wasm.js";
  await cp("node_modules/tesseract.js-core/" + file, ocr + "/core/" + file);
}
for (const lang of ["chi_sim", "eng"]) {
  await cp(
    "node_modules/@tesseract.js-data/" +
      lang +
      "/4.0.0_best_int/" +
      lang +
      ".traineddata.gz",
    ocr + "/lang/" + lang + ".traineddata.gz",
  );
}
await cp(
  "node_modules/tesseract.js-core/LICENSE",
  ocr + "/lang/LICENSE-Apache-2.0",
);
await writeFile(
  output + "/lookup-config.json",
  JSON.stringify({ url: process.env.RAIL_LOOKUP_URL || "" }),
);
