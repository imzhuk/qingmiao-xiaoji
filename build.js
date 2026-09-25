#!/usr/bin/env node
/**
 * 青苗小记 · 静态页面生成器
 *
 * 读取 content.json（内容数据），生成 index.html（最终网页）。
 * 页面结构、class 名称与样式完全沿用原设计，只是内容改为从数据生成。
 *
 * 用法：
 *   node build.js            # 生成 index.html
 *   node build.js --dry      # 只校验数据，不写文件
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const CONTENT_PATH = path.join(ROOT, "content.json");
const OUTPUT_PATH = path.join(ROOT, "index.html");
const MANIFEST_PATH = path.join(ROOT, "assets", "photos", "manifest.json");

/* ------------------------------------------------------------ 中文字体 */

const FONT_SRC =
  process.env.CJK_FONT_SRC || path.join(ROOT, "editor", "fonts-src", "LXGWWenKai-Regular.ttf");
const FONT_OUT = path.join(ROOT, "style", "fonts", "album-cjk.woff2");
const FONT_CACHE = path.join(ROOT, "style", "fonts", "album-cjk.chars.txt");

/* 除正文里的字，额外保留英文数字与常用标点，避免标点缺字回退到系统字体 */
const EXTRA_CHARS =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  "、。〈〉《》「」『』【】〔〕〖〗—…‥·～￥“”‘’•※←→↑↓°±×÷　！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝";

const PYTHON_CANDIDATES = [
  process.env.PYTHON_EXE,
  path.join(process.env.USERPROFILE || "", ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe"),
  "python",
  "python3",
].filter(Boolean);

/** 收集 content.json 里出现的所有字符 */
function collectCharacters(content) {
  const chars = new Set([...EXTRA_CHARS]);
  const walk = (value) => {
    if (typeof value === "string") {
      for (const ch of value) if (ch.codePointAt(0) > 0x2000) chars.add(ch);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(content);
  return chars;
}

function readCachedChars() {
  if (!fs.existsSync(FONT_CACHE)) return new Set();
  return new Set([...fs.readFileSync(FONT_CACHE, "utf8")]);
}

function findPython() {
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate === "python" || candidate === "python3") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 按当前内容裁剪中文字体，生成 style/fonts/album-cjk.woff2。
 * 内容新增了字就重新裁剪；没有新增则跳过（避免每次保存都跑一遍）。
 * 缺少 Python/fonttools/字体源时不会报错，只是保留现有字体文件。
 */
function refreshFontSubset(content, { force = false } = {}) {
  const needed = collectCharacters(content);
  const cached = readCachedChars();
  const missing = [...needed].filter((ch) => !cached.has(ch));
  if (!force && !missing.length && fs.existsSync(FONT_OUT)) {
    return { ok: true, skipped: true, chars: needed.size };
  }
  if (!fs.existsSync(FONT_SRC)) {
    return { ok: false, skipped: true, reason: `找不到字体源文件 ${path.relative(ROOT, FONT_SRC)}，已保留现有字体` };
  }
  const python = findPython();
  if (!python) return { ok: false, skipped: true, reason: "找不到 Python，已保留现有字体" };

  const charFile = path.join(ROOT, "." + "cjk-subset-chars.tmp");
  fs.writeFileSync(charFile, [...needed].join(""), "utf8");
  try {
    execFileSync(
      python,
      [
        "-m",
        "fontTools.subset",
        FONT_SRC,
        `--text-file=${charFile}`,
        `--output-file=${FONT_OUT}`,
        "--flavor=woff2",
        "--no-hinting",
        "--layout-features=kern,liga,vert,vrt2",
      ],
      { stdio: "pipe" }
    );
    fs.writeFileSync(FONT_CACHE, [...needed].join(""), "utf8");
    return { ok: true, chars: needed.size, added: missing.length };
  } catch (error) {
    const detail = (error.stderr ? error.stderr.toString() : "") || error.message;
    return { ok: false, skipped: true, reason: "字体裁剪失败：" + detail.split("\n")[0] };
  } finally {
    if (fs.existsSync(charFile)) fs.unlinkSync(charFile);
  }
}

const PLATE_SIZES = ["small", "medium", "large", "portrait", "high", "low", "aside"];

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 文本转 HTML：转义后把换行变成 <br> */
function text(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/**
 * 读取图片清单（每张图的宽高 + 缩略图路径），由 tools/optimize-images.py 生成。
 * 文件不存在时返回空对象，页面会退化成"直接加载原图"，功能不受影响。
 */
function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}

function loadContent(contentPath = CONTENT_PATH) {
  const raw = fs.readFileSync(contentPath, "utf8");
  const data = JSON.parse(raw);
  validate(data);
  return data;
}

function validate(data) {
  const problems = [];
  if (!data || typeof data !== "object") problems.push("content.json 不是有效的对象");
  if (!data.cover || typeof data.cover.title !== "string") problems.push("缺少 cover.title");
  if (!Array.isArray(data.pages)) problems.push("pages 必须是数组");
  else {
    data.pages.forEach((page, index) => {
      const at = `第 ${index + 1} 个内容页`;
      if (!page || typeof page !== "object") return problems.push(`${at} 数据格式错误`);
      if (page.type === "chapter") {
        if (!page.title) problems.push(`${at}（章节页）缺少章节标题`);
      } else if (page.type === "photo") {
        if (!page.src) problems.push(`${at}（图片页）缺少图片路径`);
        if (page.size && !PLATE_SIZES.includes(page.size)) {
          problems.push(`${at} 的版式 "${page.size}" 不是可用值`);
        }
      } else {
        problems.push(`${at} 的类型 "${page.type}" 未知，只能是 chapter 或 photo`);
      }
    });
  }
  if (problems.length) {
    const error = new Error("content.json 校验失败：\n- " + problems.join("\n- "));
    error.problems = problems;
    throw error;
  }
}

/** 按页码奇偶决定左右页：偶数 = 右页(recto)，奇数 = 左页(verso) */
function sideOf(index) {
  return index % 2 === 0 ? "recto" : "verso";
}

function coverPage(content, index) {
  return `<article class="book-page art-page cloth ${sideOf(index)}" data-density="hard" aria-label="封面">
          <h2 class="cover-title">${text(content.cover && content.cover.title)}</h2><p class="cover-subtitle">${text(content.cover && content.cover.subtitle)}</p>
        </article>`;
}

function endpaperPage(index) {
  return `<article class="book-page art-page endpaper ${sideOf(index)}" aria-label="Page ${index}"></article>`;
}

function epigraphPage(content, index) {
  return `<article class="book-page art-page paper ${sideOf(index)}" aria-label="Page ${index}">
          <p class="epigraph">${text(content.epigraph)}</p>
        </article>`;
}

function bodyPage(page, index, manifest) {
  const side = sideOf(index);
  if (page.type === "chapter") {
    return `<article class="book-page art-page paper ${side}" aria-label="Page ${index}">
          <div class="chapter-block"><p class="chapter-no">${text(page.no)}</p><h2>${text(page.title)}</h2><p>${text(page.text)}</p></div>
        </article>`;
  }
  const plateClass = ["plate", page.size, "has-caption"].filter(Boolean).join(" ");
  const alt = page.alt ? ` alt="${escapeHtml(page.alt)}"` : ' alt=""';

  /*
   * 图片不直接给 src，而是把两级地址都挂在 data-* 上，交给 flipbook.js 按需分配：
   *  - data-thumb：小尺寸缩略图（几十 KB），翻到附近就先显示它
   *  - data-src  ：原图，等页真的翻到了才下载
   *  - width/height 取自 manifest.json，让浏览器在图片到达前就确定版式，
   *    否则 <img> 撑开的瞬间会把图注挤得到处跳
   * 翻书本身就完全依赖 JS，所以不写 src 不会带来额外的降级风险。
   * 找不到清单信息时退回"直接加载原图"，与旧行为一致。
   */
  const stem = path.basename(page.src).replace(/\.[^.]+$/, "");
  const info = manifest[stem];
  /*
   * 以清单为准而不是以 content.json 的 src 为准：
   * 转码时若判定"原文件已经足够小"（某些 JPG 转 WebP 反而更大），清单里的 src 会指回原文件。
   * 跟着清单走，就不会引用到根本没生成的 .webp。
   */
  const fullSrc = (info && info.src) || page.src;
  const thumb = page.thumb || (info && info.thumb);
  const size = info ? ` width="${info.w}" height="${info.h}"` : "";
  const img = thumb
    ? `<img data-thumb="${escapeHtml(thumb)}" data-src="${escapeHtml(fullSrc)}"${size}${alt}>`
    : `<img src="${escapeHtml(fullSrc)}"${size}${alt}>`;
  return `<article class="book-page art-page paper ${side}" aria-label="Page ${index}">
          <figure class="${plateClass}">${img}<figcaption class="plate-caption">${text(page.caption)}</figcaption></figure>
        </article>`;
}

function colophonPage(content, index) {
  const lines = (content.colophon && content.colophon.lines) || [];
  const body = lines.map((line) => `<p>${text(line)}</p>`).join("");
  return `<article class="book-page art-page paper ${sideOf(index)}" aria-label="Page ${index}">
          <div class="colophon">${body}</div>
        </article>`;
}

function backCoverPage(content, index) {
  return `<article class="book-page art-page cloth ${sideOf(index)}" data-density="hard" aria-label="封底">
          <span class="back-mark">${text(content.backCover && content.backCover.mark)}</span>
        </article>`;
}

function buildHtml(content, manifest = loadManifest()) {
  const site = content.site || {};
  const blocks = [];
  const pages = content.pages || [];
  let index = 0;

  blocks.push(coverPage(content, index++));      // 封面（硬壳、右页）
  blocks.push(endpaperPage(index++));            // 环衬
  blocks.push(epigraphPage(content, index++));   // 题记
  for (const page of pages) {
    blocks.push(bodyPage(page, index++, manifest)); // 章节页 / 图片页
  }
  blocks.push(colophonPage(content, index++));   // 版权页
  blocks.push(endpaperPage(index++));            // 环衬
  blocks.push(backCoverPage(content, index++));  // 封底（硬壳、右页）

  const body = blocks.join("\n        ");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${text(site.pageTitle)}</title>
  <link rel="preload" href="style/fonts/album-cjk.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="room">
  <header class="book-header">
    <span>${text(site.headerTag)}</span><h1>${text(site.headerTitle)}</h1>
  </header>
  <section class="stage" aria-label="Interactive photo book">
    <div class="book-rig">
      <div id="book" class="book" data-page-width="512" data-page-height="640">
        ${body}
      </div>
    </div>
  </section>
  <footer class="controls" aria-label="Book controls">
    <button id="previous" type="button" aria-label="上一页">←</button>
    <div class="status" aria-live="polite"><span id="page-status">封面</span><small>${text(site.footerHint)}</small></div>
    <button id="next" type="button" aria-label="下一页">→</button>
  </footer>
</main>
<script src="vendor/page-flip.browser.js"></script>
<script src="flipbook.js"></script>
</body>
</html>
`;
}

/** 生成 index.html，返回 { pageCount, html, font } */
function build({ content, contentPath, outputPath, skipFont = false } = {}) {
  const data = content || loadContent(contentPath || CONTENT_PATH);
  validate(data);
  const html = buildHtml(data);
  const font = skipFont ? { ok: true, skipped: true } : refreshFontSubset(data);
  if (outputPath !== false) {
    fs.writeFileSync(outputPath || OUTPUT_PATH, html, "utf8");
  }
  return { pageCount: 3 + (data.pages || []).length + 3, html, content: data, font };
}

module.exports = { build, buildHtml, loadContent, validate, refreshFontSubset, ROOT, CONTENT_PATH, OUTPUT_PATH };

if (require.main === module) {
  try {
    const dry = process.argv.includes("--dry");
    const forceFont = process.argv.includes("--font");
    const result = build({ outputPath: dry ? false : undefined, skipFont: dry });
    console.log(dry ? "✅ 数据校验通过" : `✅ 已生成 index.html（共 ${result.pageCount} 页）`);
    if (result.font && !result.font.skipped) {
      const size = fs.existsSync(FONT_OUT) ? (fs.statSync(FONT_OUT).size / 1024).toFixed(0) + "KB" : "?";
      console.log(`✅ 中文字体已裁剪：收录 ${result.font.chars} 个字（${size}）`);
    } else if (result.font && result.font.reason) {
      console.log("⚠️  " + result.font.reason);
    }
    if (dry && forceFont) console.log(JSON.stringify(refreshFontSubset(loadContent(), { force: true })));
  } catch (error) {
    console.error("❌ " + error.message);
    process.exit(1);
  }
}
