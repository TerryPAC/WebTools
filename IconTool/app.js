/**
 * 图片取色与颜色替换 — 纯前端 Canvas 实现（支持多图批量）
 */
(function () {
  "use strict";

  const fileInput = document.getElementById("fileInput");
  const uploadZone = document.getElementById("uploadZone");
  const uploadHint = document.getElementById("uploadHint");
  const imagesGridWrap = document.getElementById("imagesGridWrap");
  const imagesGrid = document.getElementById("imagesGrid");
  const globalPlaceholder = document.getElementById("globalPlaceholder");

  const btnDrawRect = document.getElementById("btnDrawRect");
  const btnClearRect = document.getElementById("btnClearRect");
  const rectStatus = document.getElementById("rectStatus");
  const modeHint = document.getElementById("modeHint");

  const pickedSwatch = document.getElementById("pickedSwatch");
  const pickedHex = document.getElementById("pickedHex");
  const pickedRgb = document.getElementById("pickedRgb");
  const toleranceEl = document.getElementById("tolerance");
  const toleranceValue = document.getElementById("toleranceValue");
  const selectionStats = document.getElementById("selectionStats");
  const btnCancelPick = document.getElementById("btnCancelPick");

  const replaceColor = document.getElementById("replaceColor");
  const hexTextInput = document.getElementById("hexTextInput");
  const rInput = document.getElementById("rInput");
  const gInput = document.getElementById("gInput");
  const bInput = document.getElementById("bInput");
  const btnReplace = document.getElementById("btnReplace");
  const btnDownload = document.getElementById("btnDownload");
  const panelEl = document.querySelector(".panel");
  const previewEl = document.querySelector(".preview");

  /** @type {{ r: number; g: number; b: number } | null} */
  let pickedColor = null;

  let idCounter = 0;
  function nextId() {
    return "img-" + ++idCounter;
  }

  /**
   * @typedef {{ x: number; y: number; w: number; h: number }} Rect
   * @typedef {{
   *   id: string;
   *   file: File;
   *   card: HTMLElement;
   *   wrap: HTMLElement;
   *   imageCanvas: HTMLCanvasElement;
   *   rectCanvas: HTMLCanvasElement;
   *   overlayCanvas: HTMLCanvasElement;
   *   ictx: CanvasRenderingContext2D;
   *   rctx: CanvasRenderingContext2D;
   *   octx: CanvasRenderingContext2D;
   *   rects: Rect[];
   *   selectionMask: Uint8Array | null;
   *   selectionCount: number;
   *   frozenMask: Uint8Array | null;
   *   frozenCount: number;
   *   width: number;
   *   height: number;
   * }} ImageItem
   */

  /** @type {ImageItem[]} */
  let images = [];
  /** @type {string | null} */
  let activeImageId = null;

  let rectDrawMode = false;
  let rectDragging = false;
  /** @type {ImageItem | null} */
  let rectDragItem = null;
  /** @type {{ x: number; y: number } | null} */
  let rectDragStart = null;
  /** @type {{ x: number; y: number } | null} */
  let rectDragCurrent = null;

  let ignorePickUntil = 0;

  const HIGHLIGHT = { r: 255, g: 0, b: 128, a: Math.round(0.45 * 255) };
  const MIN_RECT_SIZE = 3;
  function getActiveItem() {
    if (!activeImageId) return null;
    return images.find((i) => i.id === activeImageId) || null;
  }

  function setActiveImage(id) {
    if (id == null) {
      activeImageId = null;
      for (const item of images) {
        item.card.classList.remove("active");
      }
      updateRectUI();
      updateCursors();
      return;
    }
    if (!images.some((i) => i.id === id)) return;
    activeImageId = id;
    for (const item of images) {
      item.card.classList.toggle("active", item.id === id);
    }
    updateRectUI();
    updateCursors();
  }

  function updateGridClass() {
    const n = images.length;
    imagesGrid.classList.toggle("has-images", n > 0);
    imagesGrid.classList.toggle("grid-count-1", n === 1);
    imagesGrid.classList.toggle("grid-count-2", n === 2);
    imagesGrid.classList.toggle("grid-count-many", n >= 3);
    syncEmptyPreviewHeight();
  }

  /** 空状态：右侧预览区高度跟随左侧操作面板，避免撑满视口 */
  function syncEmptyPreviewHeight() {
    if (!panelEl || !previewEl) return;
    if (images.length > 0) {
      previewEl.style.removeProperty("min-height");
      return;
    }
    previewEl.style.minHeight = `${panelEl.offsetHeight}px`;
  }

  function updateRectUI(msg) {
    const active = getActiveItem();
    const hasRects = active && active.rects.length > 0;
    btnClearRect.disabled = !hasRects;
    if (msg) {
      rectStatus.textContent = msg;
    } else if (rectDrawMode) {
      rectStatus.textContent = "在选中图片上拖拽绘制矩形…";
    } else {
      const totalRects = images.reduce((sum, i) => sum + i.rects.length, 0);
      rectStatus.textContent = totalRects > 0 ? `共 ${totalRects} 个限定框` : "";
    }
  }

  function updateCursors() {
    for (const item of images) {
      item.wrap.classList.remove("cursor-pick", "cursor-rect");
      if (rectDrawMode && item.id === activeImageId) {
        item.wrap.classList.add("cursor-rect");
      } else {
        item.wrap.classList.add("cursor-pick");
      }
    }
  }

  function clientToBitmap(item, clientX, clientY) {
    const rect = item.imageCanvas.getBoundingClientRect();
    const sx = item.imageCanvas.width / rect.width;
    const sy = item.imageCanvas.height / rect.height;
    let bx = Math.floor((clientX - rect.left) * sx);
    let by = Math.floor((clientY - rect.top) * sy);
    bx = Math.max(0, Math.min(item.imageCanvas.width - 1, bx));
    by = Math.max(0, Math.min(item.imageCanvas.height - 1, by));
    return { bx, by };
  }

  /** @param {ImageItem} item @param {number} px @param {number} py */
  function isInAnyRect(item, px, py) {
    if (!item.rects.length) return true;
    for (const r of item.rects) {
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return true;
    }
    return false;
  }

  function normalizeRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    return { x, y, w, h };
  }

  /** @param {ImageItem} item */
  function clampRectToImage(item, rect) {
    let { x, y, w, h } = rect;
    const iw = item.width;
    const ih = item.height;
    x = Math.max(0, Math.min(x, iw - 1));
    y = Math.max(0, Math.min(y, ih - 1));
    w = Math.min(w, iw - x);
    h = Math.min(h, ih - y);
    return { x, y, w, h };
  }

  /** @param {ImageItem} item */
  function drawRectLayer(item) {
    const rctx = item.rctx;
    rctx.clearRect(0, 0, item.rectCanvas.width, item.rectCanvas.height);

    const drawOne = (rx, ry, rw, rh, preview) => {
      if (rw < 1 || rh < 1) return;
      rctx.save();
      rctx.fillStyle = preview ? "rgba(59, 158, 255, 0.08)" : "rgba(59, 158, 255, 0.12)";
      rctx.fillRect(rx, ry, rw, rh);
      rctx.strokeStyle = preview ? "rgba(120, 190, 255, 0.95)" : "rgba(59, 158, 255, 0.95)";
      rctx.lineWidth = 1;
      rctx.setLineDash([8, 6]);
      rctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);

      rctx.restore();
    };

    for (const r of item.rects) {
      if (r.w >= 1 && r.h >= 1) drawOne(r.x, r.y, r.w, r.h, false);
    }

    if (rectDragging && rectDragItem === item && rectDragStart && rectDragCurrent) {
      const n = normalizeRect(
        rectDragStart.x,
        rectDragStart.y,
        rectDragCurrent.x,
        rectDragCurrent.y
      );
      if (n.w >= 1 && n.h >= 1) drawOne(n.x, n.y, n.w, n.h, true);
    }

    // 拖拽中不重建按钮，避免频繁 DOM 操作
    if (!rectDragging) syncRectDeleteButtons(item);
  }

  /** @param {ImageItem} item */
  function syncRectDeleteButtons(item) {
    for (const btn of item._rectBtns) btn.remove();
    item._rectBtns = [];

    for (let idx = 0; idx < item.rects.length; idx++) {
      const r = item.rects[idx];
      const btn = document.createElement("button");
      btn.className = "btn-delete-rect";
      btn.title = "删除限定框";
      btn.innerHTML = `<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

      // 中心定位在矩形右上角，使用百分比坐标转换
      btn.style.left = `${((r.x + r.w) / item.width) * 100}%`;
      btn.style.top = `${(r.y / item.height) * 100}%`;

      const capturedIdx = idx;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        item.rects.splice(capturedIdx, 1);
        drawRectLayer(item);
        updateRectUI();
        if (pickedColor) refreshAllHighlights();
      });

      item.wrap.appendChild(btn);
      item._rectBtns.push(btn);
    }
  }

  /** @param {ImageItem} item */
  function clearOverlayHighlight(item) {
    item.octx.clearRect(0, 0, item.overlayCanvas.width, item.overlayCanvas.height);
  }

  /** @param {ImageItem} item */
  function refreshSelectionForItem(item) {
    clearOverlayHighlight(item);
    item.selectionMask = null;
    item.selectionCount = 0;

    if (!pickedColor || item.width === 0 || item.height === 0) {
      return;
    }

    const w = item.width;
    const h = item.height;
    const imgData = item.ictx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const mask = new Uint8Array(w * h);

    const t = Number(toleranceEl.value);
    const maxDist = (t / 100) * 441;
    const maxDistSq = maxDist * maxDist;

    const pr = pickedColor.r;
    const pg = pickedColor.g;
    const pb = pickedColor.b;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (!isInAnyRect(item, px, py)) continue;
        const i = (py * w + px) * 4;
        const dr = d[i] - pr;
        const dg = d[i + 1] - pg;
        const db = d[i + 2] - pb;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq <= maxDistSq) {
          const mi = py * w + px;
          mask[mi] = 1;
          item.selectionCount++;
        }
      }
    }

    item.selectionMask = mask;

    if (item.selectionCount === 0) return;

    const hi = item.octx.createImageData(w, h);
    const hd = hi.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const mi = py * w + px;
        if (!mask[mi]) continue;
        const oi = mi * 4;
        hd[oi] = HIGHLIGHT.r;
        hd[oi + 1] = HIGHLIGHT.g;
        hd[oi + 2] = HIGHLIGHT.b;
        hd[oi + 3] = HIGHLIGHT.a;
      }
    }
    item.octx.putImageData(hi, 0, 0);
  }

  function refreshAllHighlights() {
    let total = 0;
    for (const item of images) {
      refreshSelectionForItem(item);
      total += item.selectionCount;
    }
    if (!pickedColor || images.length === 0) {
      selectionStats.textContent = "已选中像素：—";
    } else {
      selectionStats.textContent = `已选中像素：${total.toLocaleString()}（${images.length} 张图）`;
    }
    updateReplaceButton();
  }

  function updateReplaceButton() {
    if (!pickedColor || images.length === 0) {
      btnReplace.disabled = true;
      return;
    }
    const any = images.some((i) => i.selectionCount > 0 || i.frozenCount > 0);
    btnReplace.disabled = !any;
  }

  function updatePickedUI() {
    if (!pickedColor) {
      pickedSwatch.style.background = "";
      pickedHex.textContent = "未取色";
      pickedRgb.textContent = "—";
      btnReplace.disabled = true;
      btnCancelPick.style.display = "none";
      return;
    }
    const { r, g, b } = pickedColor;
    pickedSwatch.style.background = `rgb(${r},${g},${b})`;
    pickedHex.textContent =
      "#" +
      [r, g, b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    pickedRgb.textContent = `RGB(${r}, ${g}, ${b})`;
    btnCancelPick.style.display = "inline-flex";
    updateReplaceButton();
  }

  /** @param {ImageItem} item */
  function pickAt(item, bx, by) {
    const d = item.ictx.getImageData(bx, by, 1, 1).data;
    pickedColor = { r: d[0], g: d[1], b: d[2] };
    // 只清除当前被取色图的冻结选区；其他图的冻结选区保持不变，
    // 这样用户对不同图片做独立替换后，再修改目标色时所有图都能继续参与
    item.frozenMask = null;
    item.frozenCount = 0;
    updatePickedUI();
    for (const im of images) {
      drawRectLayer(im);
    }
    refreshAllHighlights();
  }

  /** @param {ImageItem} item */
  function onOverlayClick(item, e) {
    if (performance.now() < ignorePickUntil) return;
    if (rectDrawMode || rectDragging) return;
    if (!item.width) return;

    const { bx, by } = clientToBitmap(item, e.clientX, e.clientY);

    if (item.id !== activeImageId) {
      // 点击非活跃图片时只切换选中，不取色
      setActiveImage(item.id);
      return;
    }
    pickAt(item, bx, by);
  }

  /** @param {ImageItem} item */
  function onOverlayPointerDown(item, e) {
    if (!item.width) return;
    if (!rectDrawMode) return;
    if (item.id !== activeImageId) return;
    e.preventDefault();
    rectDragging = true;
    rectDragItem = item;
    const p = clientToBitmap(item, e.clientX, e.clientY);
    rectDragStart = { x: p.bx, y: p.by };
    rectDragCurrent = { ...rectDragStart };
    item.overlayCanvas.setPointerCapture(e.pointerId);
    drawRectLayer(item);
  }

  /** @param {ImageItem} item */
  function onOverlayPointerMove(item, e) {
    if (rectDragging && rectDragItem === item && rectDragStart) {
      const p = clientToBitmap(item, e.clientX, e.clientY);
      rectDragCurrent = { x: p.bx, y: p.by };
      drawRectLayer(item);
      return;
    }

  }

  /** @param {ImageItem} item */
  function onOverlayPointerUp(item, e) {
    if (!rectDragging || rectDragItem !== item) return;
    rectDragging = false;
    try {
      item.overlayCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}

    let committed = false;
    let dragDist = 0;
    if (rectDragStart && rectDragCurrent) {
      dragDist = Math.hypot(
        rectDragCurrent.x - rectDragStart.x,
        rectDragCurrent.y - rectDragStart.y
      );
    }

    let msg = "";
    if (rectDragStart && rectDragCurrent) {
      let n = normalizeRect(
        rectDragStart.x,
        rectDragStart.y,
        rectDragCurrent.x,
        rectDragCurrent.y
      );
      n = clampRectToImage(item, n);
      if (n.w >= MIN_RECT_SIZE && n.h >= MIN_RECT_SIZE) {
        item.rects.push(n);
        committed = true;
      } else {
        msg = "框选过小，已忽略";
      }
    }

    if (dragDist > 4) {
      ignorePickUntil = performance.now() + 350;
    }
    rectDragStart = null;
    rectDragCurrent = null;
    rectDragItem = null;
    rectDrawMode = false;
    btnDrawRect.disabled = false;
    updateRectUI(msg);
    modeHint.textContent = committed
      ? "已追加限定范围。可继续取色或再绘制矩形框"
      : "请在图片上点击取色；或再次点击「绘制矩形框」限定范围";
    updateCursors();
    drawRectLayer(item);
    if (pickedColor) refreshAllHighlights();
  }

  btnDrawRect.addEventListener("click", () => {
    if (!images.length) return;
    if (!activeImageId) setActiveImage(images[0].id);
    rectDrawMode = true;
    btnDrawRect.disabled = true;
    updateRectUI();
    modeHint.textContent = "拖拽绘制矩形框，松开后自动回到取色";
    updateCursors();
  });

  btnClearRect.addEventListener("click", () => {
    const active = getActiveItem();
    if (!active) return;
    active.rects = [];
    updateRectUI();
    drawRectLayer(active);
    if (pickedColor) refreshAllHighlights();
  });

  rectStatus.addEventListener("click", () => {
    const totalRects = images.reduce((sum, i) => sum + i.rects.length, 0);
    if (totalRects > 0) {
      for (const item of images) {
        drawRectLayer(item);
      }
    }
  });

  btnCancelPick.addEventListener("click", () => {
    pickedColor = null;
    updatePickedUI();
    refreshAllHighlights();
  });

  function updateSliderFill() {
    const val = Number(toleranceEl.value);
    toleranceEl.style.setProperty("--fill", val + "%");
  }

  toleranceEl.addEventListener("input", () => {
    toleranceValue.textContent = toleranceEl.value;
    updateSliderFill();
    if (pickedColor) refreshAllHighlights();
  });

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return null;
    return {
      r: parseInt(m[1], 16),
      g: parseInt(m[2], 16),
      b: parseInt(m[3], 16),
    };
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  replaceColor.addEventListener("input", () => {
    const rgb = hexToRgb(replaceColor.value);
    if (!rgb) return;
    const hex = replaceColor.value.toUpperCase();
    rInput.value = String(rgb.r);
    gInput.value = String(rgb.g);
    bInput.value = String(rgb.b);
    hexTextInput.value = hex;
  });

  function onRgbInput() {
    let r = parseInt(rInput.value, 10);
    let g = parseInt(gInput.value, 10);
    let b = parseInt(bInput.value, 10);
    if (Number.isNaN(r)) r = 0;
    if (Number.isNaN(g)) g = 0;
    if (Number.isNaN(b)) b = 0;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    rInput.value = String(r);
    gInput.value = String(g);
    bInput.value = String(b);
    const hex = rgbToHex(r, g, b).toUpperCase();
    replaceColor.value = hex.toLowerCase();
    hexTextInput.value = hex;
  }

  [rInput, gInput, bInput].forEach((el) => el.addEventListener("input", onRgbInput));

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hex = btn.getAttribute("data-color");
      if (hex) {
        hexTextInput.value = hex.toUpperCase();
        const rgb = hexToRgb(hex);
        if (rgb) {
          rInput.value = String(rgb.r);
          gInput.value = String(rgb.g);
          bInput.value = String(rgb.b);
          replaceColor.value = hex.toLowerCase();
        }
      }
    });
  });

  hexTextInput.addEventListener("input", () => {
    let hex = hexTextInput.value.trim();
    if (hex.length > 0 && !hex.startsWith("#")) {
      hex = "#" + hex;
      hexTextInput.value = hex;
    }
    if (hex.length === 7) {
      const rgb = hexToRgb(hex);
      if (rgb) {
        rInput.value = String(rgb.r);
        gInput.value = String(rgb.g);
        bInput.value = String(rgb.b);
        replaceColor.value = rgbToHex(rgb.r, rgb.g, rgb.b).toLowerCase();
      }
    }
  });

  btnReplace.addEventListener("click", () => {
    if (!pickedColor || images.length === 0) return;

    const nr = parseInt(rInput.value, 10);
    const ng = parseInt(gInput.value, 10);
    const nb = parseInt(bInput.value, 10);
    const R = Math.max(0, Math.min(255, nr | 0));
    const G = Math.max(0, Math.min(255, ng | 0));
    const B = Math.max(0, Math.min(255, nb | 0));

    let totalReplaced = 0;

    for (const item of images) {
      // 无论是否有选区，都先清除矩形框显示与取色高亮，符合用户“替换后消失”的预期
      item.rctx.clearRect(0, 0, item.rectCanvas.width, item.rectCanvas.height);
      for (const btn of item._rectBtns) btn.remove();
      item._rectBtns = [];
      clearOverlayHighlight(item);

      // 优先用当前活跃选区；若该图已在前次替换后被其他图的取色操作清空选区，
      // 则回落到该图自己的冻结选区，保证多图各自独立替换后仍能继续参与
      const mask = item.selectionCount > 0 ? item.selectionMask : item.frozenMask;
      const count = item.selectionCount > 0 ? item.selectionCount : item.frozenCount;
      if (!mask || count === 0) continue;

      const w = item.width;
      const h = item.height;
      const imgData = item.ictx.getImageData(0, 0, w, h);
      const d = imgData.data;

      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const py = Math.floor(i / w);
        const px = i % w;
        if (!isInAnyRect(item, px, py)) continue;
        const oi = i * 4;
        d[oi] = R;
        d[oi + 1] = G;
        d[oi + 2] = B;
      }

      item.ictx.putImageData(imgData, 0, 0);

      // 将本次使用的 mask 持久化到 frozenMask，供后续修改颜色后继续替换
      item.frozenMask = mask === item.selectionMask ? mask.slice() : mask;
      item.frozenCount = count;
      totalReplaced += count;
    }

    selectionStats.textContent =
      totalReplaced > 0
        ? `已选中像素：${totalReplaced.toLocaleString()}（${images.length} 张图）`
        : "已选中像素：—";
    modeHint.textContent =
      "替换完成。可继续修改目标颜色后再次替换，或重新点击图片取色";
    updateReplaceButton();
  });

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  btnDownload.addEventListener("click", async () => {
    if (!images.length) return;

    if (images.length === 1) {
      const item = images[0];
      const base = item.file.name.replace(/\.[^.]+$/, "") || "image";
      const a = document.createElement("a");
      a.href = item.imageCanvas.toDataURL("image/png");
      a.download = base + "-edited.png";
      a.click();
      return;
    }

    btnDownload.disabled = true;
    const labelEl = document.getElementById("btnDownloadLabel");
    if (labelEl) labelEl.textContent = " 打包中…";

    try {
      const zip = new window.JSZip();
      await Promise.all(
        images.map(async (item) => {
          const base = item.file.name.replace(/\.[^.]+$/, "") || "image";
          const blob = await canvasToBlob(item.imageCanvas);
          zip.file(base + "-edited.png", blob);
        })
      );

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = "images-edited.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      btnDownload.disabled = false;
      updateDownloadButtonLabel();
    }
  });

  function removeImage(id) {
    const index = images.findIndex((i) => i.id === id);
    if (index === -1) return;

    const item = images[index];
    images.splice(index, 1);
    item.card.remove();

    updateGridClass();
    updateUploadHint();
    updateDownloadButtonLabel();
    btnDownload.disabled = images.length === 0;
    btnDrawRect.disabled = images.length === 0;

    if (activeImageId === id) {
      if (images.length > 0) {
        const nextActiveIndex = Math.min(index, images.length - 1);
        setActiveImage(images[nextActiveIndex].id);
      } else {
        setActiveImage(null);
      }
    }

    if (pickedColor) refreshAllHighlights();
    else {
      if (images.length === 0) {
        selectionStats.textContent = "已选中像素：—";
      }
      updateReplaceButton();
    }
  }

  /** @param {File} file @returns {Promise<ImageItem|null>} */
  function createItemFromFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        const card = document.createElement("div");
        card.className = "image-card";
        const id = nextId();
        card.dataset.id = id;

        const wrap = document.createElement("div");
        wrap.className = "image-canvas-wrap cursor-pick";
        wrap.style.aspectRatio = w + " / " + h;

        const imageCanvas = document.createElement("canvas");
        imageCanvas.className = "img-canvas";
        const rectCanvas = document.createElement("canvas");
        rectCanvas.className = "rect-canvas";
        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.className = "overlay-canvas";

        [imageCanvas, rectCanvas, overlayCanvas].forEach((c) => {
          c.width = w;
          c.height = h;
        });

        const btnDelete = document.createElement("button");
        btnDelete.className = "btn-delete-image";
        btnDelete.title = "删除图片";
        btnDelete.innerHTML = `
          <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        `;

        const footer = document.createElement("div");
        footer.className = "image-card-footer";
        footer.textContent = `${file.name} · ${w} × ${h} px`;

        wrap.appendChild(imageCanvas);
        wrap.appendChild(rectCanvas);
        wrap.appendChild(overlayCanvas);
        card.appendChild(wrap);
        card.appendChild(btnDelete);
        card.appendChild(footer);

        const ictx = imageCanvas.getContext("2d", { willReadFrequently: true });
        const rctx = rectCanvas.getContext("2d");
        const octx = overlayCanvas.getContext("2d", { willReadFrequently: true });

        ictx.drawImage(img, 0, 0);

        /** @type {ImageItem} */
        const item = {
          id,
          file,
          card,
          wrap,
          imageCanvas,
          rectCanvas,
          overlayCanvas,
          ictx,
          rctx,
          octx,
          rects: [],
          _rectBtns: [],
          selectionMask: null,
          selectionCount: 0,
          frozenMask: null,
          frozenCount: 0,
          width: w,
          height: h,
        };

        overlayCanvas.addEventListener("click", (e) => onOverlayClick(item, e));
        overlayCanvas.addEventListener("pointerdown", (e) => onOverlayPointerDown(item, e));
        overlayCanvas.addEventListener("pointermove", (e) => onOverlayPointerMove(item, e));
        overlayCanvas.addEventListener("pointerup", (e) => onOverlayPointerUp(item, e));
        overlayCanvas.addEventListener("pointercancel", (e) => onOverlayPointerUp(item, e));

        btnDelete.addEventListener("click", (e) => {
          e.stopPropagation();
          removeImage(item.id);
        });

        card.addEventListener("click", (e) => {
          const t = /** @type {HTMLElement} */ (e.target);
          if (t === overlayCanvas || t.closest(".btn-delete-image") || t.closest(".btn-delete-rect")) return;
          setActiveImage(item.id);
        });

        resolve(item);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function updateDownloadButtonLabel() {
    const el = document.getElementById("btnDownloadLabel");
    if (!el) return;
    el.textContent = images.length > 1 ? "下载所有图片" : "下载图片";
  }

  function updateUploadHint() {
    if (!images.length) {
      uploadZone.classList.remove("has-file");
      uploadHint.textContent = "支持多张 · PNG · JPG · WebP · GIF";
      return;
    }
    uploadZone.classList.add("has-file");
    uploadHint.textContent = `已加载 ${images.length} 张 · 可继续添加`;
  }

  /** @param {FileList|File[]} rawFiles */
  function isDuplicate(file) {
    return images.some(
      (item) =>
        item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified
    );
  }

  async function appendImages(rawFiles) {
    const list = Array.from(rawFiles || []).filter(
      (f) => f.type && f.type.startsWith("image/") && !isDuplicate(f)
    );
    if (!list.length) return;

    for (const file of list) {
      const item = await createItemFromFile(file);
      if (!item) {
        modeHint.textContent = "部分图片加载失败，已跳过";
        continue;
      }
      imagesGrid.appendChild(item.card);
      images.push(item);
    }

    updateGridClass();
    updateUploadHint();
    updateDownloadButtonLabel();
    btnDownload.disabled = images.length === 0;
    btnDrawRect.disabled = images.length === 0;

    if (images.length && !activeImageId) {
      setActiveImage(images[0].id);
    } else if (activeImageId && !getActiveItem()) {
      setActiveImage(images.length ? images[0].id : null);
    } else {
      updateRectUI();
      updateCursors();
    }

    if (pickedColor) refreshAllHighlights();
    else {
      selectionStats.textContent = "已选中像素：—";
      updateReplaceButton();
    }

    if (images.length) {
      modeHint.textContent = "请在任意图片上点击取色；选中一张图后可绘制限定框";
    }
  }

  fileInput.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files && files.length) appendImages(files);
    fileInput.value = "";
  });

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
  });

  uploadZone.addEventListener("dragleave", (e) => {
    if (!uploadZone.contains(/** @type {Node} */ (e.relatedTarget))) {
      uploadZone.classList.remove("drag-over");
    }
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const dt = e.dataTransfer && e.dataTransfer.files;
    if (dt && dt.length) appendImages(dt);
  });

  toleranceValue.textContent = toleranceEl.value;
  updateSliderFill();
  onRgbInput();
  updateCursors();
  if (panelEl && previewEl) {
    new ResizeObserver(() => syncEmptyPreviewHeight()).observe(panelEl);
  }
  window.addEventListener("resize", syncEmptyPreviewHeight);
  syncEmptyPreviewHeight();
  btnReplace.disabled = true;
  updateDownloadButtonLabel();
  btnDownload.disabled = true;
  btnDrawRect.disabled = true;
  btnClearRect.disabled = true;
  selectionStats.textContent = "已选中像素：—";
})();
