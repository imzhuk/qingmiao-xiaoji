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

const ROOT = __dirname;
const CONTENT_PATH = path.join(ROOT, "content.json");
const OUTPUT_PATH = path.join(ROOT, "index.html");

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

function bodyPage(page, index) {
  const side = sideOf(index);
  if (page.type === "chapter") {
    return `<article class="book-page art-page paper ${side}" aria-label="Page ${index}">
          <div class="chapter-block"><p class="chapter-no">${text(page.no)}</p><h2>${text(page.title)}</h2><p>${text(page.text)}</p></div>
        </article>`;
  }
  const plateClass = ["plate", page.size, "has-caption"].filter(Boolean).join(" ");
  const alt = page.alt ? ` alt="${escapeHtml(page.alt)}"` : ' alt=""';
  return `<article class="book-page art-page paper ${side}" aria-label="Page ${index}">
          <figure class="${plateClass}"><img src="${escapeHtml(page.src)}"${alt}><figcaption class="plate-caption">${text(page.caption)}</figcaption></figure>
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

function buildHtml(content) {
  const site = content.site || {};
  const blocks = [];
  const pages = content.pages || [];
  let index = 0;

  blocks.push(coverPage(content, index++));      // 封面（硬壳、右页）
  blocks.push(endpaperPage(index++));            // 环衬
  blocks.push(epigraphPage(content, index++));   // 题记
  for (const page of pages) {
    blocks.push(bodyPage(page, index++));        // 章节页 / 图片页
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

/** 生成 index.html，返回 { pageCount, html } */
function build({ content, contentPath, outputPath } = {}) {
  const data = content || loadContent(contentPath || CONTENT_PATH);
  validate(data);
  const html = buildHtml(data);
  if (outputPath !== false) {
    fs.writeFileSync(outputPath || OUTPUT_PATH, html, "utf8");
  }
  return { pageCount: 3 + (data.pages || []).length + 3, html, content: data };
}

module.exports = { build, buildHtml, loadContent, validate, ROOT, CONTENT_PATH, OUTPUT_PATH };

if (require.main === module) {
  try {
    const dry = process.argv.includes("--dry");
    const result = build({ outputPath: dry ? false : undefined });
    console.log(dry ? "✅ 数据校验通过" : `✅ 已生成 index.html（共 ${result.pageCount} 页）`);
  } catch (error) {
    console.error("❌ " + error.message);
    process.exit(1);
  }
}
