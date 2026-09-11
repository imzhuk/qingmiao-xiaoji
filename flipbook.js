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

pageFlip.loadFromHTML(pages);

/*
 * 两处针对触屏的手感修补（都在 loadFromHTML 之后，因为此时内部实例才存在）：
 *
 * 1. 跟手延迟：库内部固定 250ms 才让页面开始跟手指移动，快速滑动还会被当成点击。
 *    这里降到 40ms。
 *
 * 2. 松手判定：库默认要求把书角拖过“整整一页的宽度”（折叠进度 ≥50%）才算翻页，
 *    手机上几乎不可能一次滑这么远，所以滑一半就弹回去，感觉特别别扭。
 *    这里把阈值降到 28%，轻轻一滑就能翻页，拖不够则原样弹回。
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
};
