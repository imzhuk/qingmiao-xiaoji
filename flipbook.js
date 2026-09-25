const bookElement = document.querySelector("#book");
const pages = bookElement.querySelectorAll(".book-page");
const previousButton = document.querySelector("#previous");
const nextButton = document.querySelector("#next");
const pageStatus = document.querySelector("#page-status");
const pageWidth = Number(bookElement.dataset.pageWidth) || 512;
const pageHeight = Number(bookElement.dataset.pageHeight) || 640;
document.documentElement.style.setProperty("--page-ratio", pageWidth / pageHeight);

/*
 * 手机/触屏设备上翻页要更轻快：
 *  - 库内部默认触摸后要等 250ms 才开始跟手，且 250ms 内的短按完全不响应，手感很迟钝
 *  - 这里把等待时间降到 40ms（几乎零延迟），并关掉只在鼠标悬停时有意义的页角效果
 *  - 动画时长、阴影浓度也一并调轻，减少手机上的掉帧
 */
const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
const isNarrowScreen = window.matchMedia("(max-width: 700px)").matches;
const compactMode = isTouchDevice || isNarrowScreen;
const TOUCH_DELAY = compactMode ? 40 : 250;

const pageFlip = new St.PageFlip(bookElement, {
  width: pageWidth,
  height: pageHeight,
  size: "stretch",
  minWidth: Math.max(1, Math.round(pageWidth * 0.56)),
  maxWidth: Math.max(1, Math.round(pageWidth * 1.04)),
  minHeight: Math.max(1, Math.round(pageHeight * 0.56)),
  maxHeight: Math.max(1, Math.round(pageHeight * 1.04)),
  drawShadow: true,
  flippingTime: compactMode ? 520 : 760,
  usePortrait: true,
  startZIndex: 10,
  autoSize: true,
  maxShadowOpacity: compactMode ? 0.28 : 0.42,
  showCover: true,
  mobileScrollSupport: false,
  clickEventForward: true,
  useMouseEvents: true,
  swipeDistance: 24,
  showPageCorners: !compactMode,
  disableFlipByClick: false,
});

let currentPage = 0;
let isTurning = false;

function updateControls() {
  const pageCount = pageFlip.getPageCount();
  const lastPage = pageCount - 1;
  bookElement.dataset.edge = currentPage === 0 ? "front" : currentPage === lastPage ? "back" : "inside";

  previousButton.disabled = currentPage === 0 || isTurning;
  nextButton.disabled = currentPage === lastPage || isTurning;

  if (currentPage === 0) {
    pageStatus.textContent = "封面";
  } else if (currentPage === lastPage) {
    pageStatus.textContent = "封底";
  } else {
    pageStatus.textContent = `${String(currentPage + 1).padStart(2, "0")} / ${String(pageCount).padStart(2, "0")}`;
  }
}

pageFlip.on("flip", (event) => {
  currentPage = Number(event.data);
  updateControls();
  hydrateImages();
});

pageFlip.on("changeState", (event) => {
  isTurning = event.data !== "read";
  updateControls();
});

pageFlip.on("init", (event) => {
  bookElement.dataset.layout = event.data.mode;
});
pageFlip.on("changeOrientation", (event) => {
  bookElement.dataset.layout = event.data;
});

/*
 * 按页加载图片。
 *
 * index.html 里的 <img> 不带 src，两级地址分别挂在 data-thumb（缩略图）和 data-src（原图）上。
 * 翻页时按距离分配：
 *   - 当前页往后 3 页 / 往前 1 页：加载原图
 *   - 再往外几页：先挂上缩略图
 *   - 更远的页：什么都不下载
 * 于是打开这本书几乎不产生图片流量，翻到哪儿才下哪儿，而不是一上来就吞掉 37MB。
 * 缩略图和原图宽高比一致，替换瞬间版式不会跳动。
 *
 * 页码语义要注意：双页模式下 currentPage 是「左页」索引，实际可见的是
 * currentPage 与 currentPage+1 两页，所以往后必须留得比往前多 —— 往后 3 页
 * 正好覆盖「再翻一次之后能看到的那两页」。
 */
const FULL_BEFORE = 1; // 往前几页开始加载原图
const FULL_AFTER = 3;  // 往后几页开始加载原图
const THUMB_BEFORE = 3;
const THUMB_AFTER = 6;

const photoSlots = [];
pages.forEach((pageEl, index) => {
  const img = pageEl.querySelector("img[data-src]");
  if (!img) return;
  photoSlots.push({
    index,
    img,
    full: img.getAttribute("data-src"),
    thumb: img.getAttribute("data-thumb"),
    fullLoading: false,
    fullDone: false,
  });
});

/** 先让缩略图顶上，保证翻过去的一瞬间不是空白 */
function loadThumbImage(slot) {
  if (slot.img.getAttribute("src") || !slot.thumb) return;
  slot.img.src = slot.thumb;
}

function loadFullImage(slot) {
  if (slot.fullLoading || slot.fullDone) return;
  loadThumbImage(slot);
  slot.fullLoading = true;
  const loader = new Image();
  loader.decoding = "async";
  loader.onload = () => {
    slot.fullLoading = false;
    slot.fullDone = true;
    slot.img.src = slot.full;
  };
  loader.onerror = () => {
    slot.fullLoading = false; // 失败就维持缩略图，下次翻回来再试
  };
  loader.src = slot.full;
}

let hydratedPage = -1;
function hydrateImages(force = false) {
  if (!force && hydratedPage === currentPage) return;
  hydratedPage = currentPage;
  const wantFull = [];
  for (const slot of photoSlots) {
    const offset = slot.index - currentPage;
    if (offset >= -FULL_BEFORE && offset <= FULL_AFTER) wantFull.push(slot);
    else if (offset >= -THUMB_BEFORE && offset <= THUMB_AFTER) loadThumbImage(slot);
  }
  // 近的页先发请求，别让远处的图把带宽抢走
  wantFull.sort((a, b) => Math.abs(a.index - currentPage) - Math.abs(b.index - currentPage));
  for (const slot of wantFull) loadFullImage(slot);
}
hydrateImages(true);

pageFlip.loadFromHTML(pages);

/*
 * 两处针对触屏的手感修补（都在 loadFromHTML 之后，因为此时内部实例才存在）：
 *
 * 1. 跟手延迟：库内部固定 250ms 才让页面开始跟手指移动，快速滑动还会被当成点击。
 *    这里降到 40ms。
 *
 * 2. 松手判定：库默认要求把书角拖过“整整一页的宽度”（折叠进度 ≥50%）才算翻页，
 *    手机上几乎不可能一次滑这么远，所以滑一半就弹回去，感觉特别别扭。
 *    这里把阈值降到 20%（约拖动四成页宽），轻轻一滑就能翻页，拖不够则原样弹回。
 */
if (compactMode) {
  const ui = pageFlip.getUI();
  if (ui) ui.swipeTimeout = TOUCH_DELAY;
}

const flipController = pageFlip.getFlipController();
if (flipController && typeof flipController.stopMove === "function") {
  const nativeStopMove = flipController.stopMove.bind(flipController);
  const COMPLETE_THRESHOLD = 20; // 折叠进度达到 20%（约拖动 40% 页宽）即判定翻页
  flipController.stopMove = function patchedStopMove() {
    const calc = this.calc;
    if (!calc || typeof calc.getFlippingProgress !== "function") return nativeStopMove();
    const progress = calc.getFlippingProgress();
    if (progress < 2 || progress > 98) return nativeStopMove();
    const bounds = this.getBoundsRect();
    const position = calc.getPosition();
    const targetY = calc.getCorner() === "bottom" ? bounds.height : 0;
    if (progress >= COMPLETE_THRESHOLD) {
      return this.animateFlippingTo(position, { x: -bounds.pageWidth, y: targetY }, true);
    }
    return this.animateFlippingTo(position, { x: bounds.pageWidth, y: targetY }, false);
  };
}

updateControls();

const requestedPage = Number(new URLSearchParams(location.search).get("page"));
if (Number.isInteger(requestedPage) && requestedPage >= 0 && requestedPage < pages.length) {
  pageFlip.turnToPage(requestedPage);
}

/* 极快的点按（比跟手延迟还短）库不会处理，这里补上，保证手机点哪儿都能翻页 */
if (compactMode) {
  let touchStart = null;
  bookElement.addEventListener(
    "touchstart",
    (event) => {
      if (event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    },
    { passive: true }
  );
  bookElement.addEventListener(
    "touchend",
    (event) => {
      if (!touchStart || event.changedTouches.length !== 1) {
        touchStart = null;
        return;
      }
      const touch = event.changedTouches[0];
      const moved = Math.abs(touch.clientX - touchStart.x) > 12 || Math.abs(touch.clientY - touchStart.y) > 12;
      const elapsed = Date.now() - touchStart.time;
      touchStart = null;
      if (moved || elapsed >= TOUCH_DELAY - 10 || isTurning) return;
      const rect = bookElement.getBoundingClientRect();
      if (touch.clientX < rect.left + rect.width / 2) pageFlip.flipPrev("bottom");
      else pageFlip.flipNext("bottom");
    },
    { passive: true }
  );
}

previousButton.addEventListener("click", () => {
  if (!isTurning) pageFlip.flipPrev("bottom");
});

nextButton.addEventListener("click", () => {
  if (!isTurning) pageFlip.flipNext("bottom");
});

window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || isTurning) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    pageFlip.flipPrev("bottom");
  }

  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    pageFlip.flipNext("bottom");
  }

  if (event.key === "Home") pageFlip.turnToPage(0);
  if (event.key === "End") pageFlip.turnToPage(pageFlip.getPageCount() - 1);
});

// 暴露给本地可视化编辑器用于联动翻页（对网站本身没有任何影响）
window.__qingmiaoBook = {
  turnTo: (page) => pageFlip.turnToPage(page),
  getPageCount: () => pageFlip.getPageCount(),
  current: () => currentPage,
  touchDelay: () => {
    const ui = pageFlip.getUI();
    return ui ? ui.swipeTimeout : null;
  },
  // 每张图当前挂的是缩略图还是原图，便于排查与自测
  imageState: () =>
    photoSlots.map((slot) => ({
      page: slot.index,
      showing: slot.img.getAttribute("src") ? slot.img.getAttribute("src").split("/").pop() : null,
      isFull: slot.fullDone,
    })),
};
