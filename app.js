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

  const replaceColor = document.getElementById("replaceColor");
  const hexTextInput = document.getElementById("hexTextInput");
  const rInput = document.getElementById("rInput");
  const gInput = document.getElementById("gInput");
  const bInput = document.getElementById("bInput");
  const btnReplace = document.getElementById("btnReplace");
  const btnDownload = document.getElementById("btnDownload");

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
      updateClearRectButton();
      updateCursors();
      return;
    }
    if (!images.some((i) => i.id === id)) return;
    activeImageId = id;
    for (const item of images) {
      item.card.classList.toggle("active", item.id === id);
    }
    updateClearRectButton();
    updateCursors();
  }

  function updateGridClass() {
    const n = images.length;
    imagesGrid.classList.toggle("has-images", n > 0);
    imagesGrid.classList.toggle("grid-count-1", n === 1);
    imagesGrid.classList.toggle("grid-count-2", n === 2);
    imagesGrid.classList.toggle("grid-count-many", n >= 3);
  }

  function updateClearRectButton() {
    const active = getActiveItem();
    btnClearRect.disabled = !active || active.rects.length === 0;
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
      rctx.lineWidth = 2;
      rctx.setLineDash([8, 6]);
      rctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
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
    const any = images.some((i) => i.selectionCount > 0);
    btnReplace.disabled = !any;
  }

  function updatePickedUI() {
    if (!pickedColor) {
      pickedSwatch.style.background = "";
      pickedHex.textContent = "未取色";
      pickedRgb.textContent = "—";
      btnReplace.disabled = true;
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
    updateReplaceButton();
  }

  /** @param {ImageItem} item */
  function pickAt(item, bx, by) {
    const d = item.ictx.getImageData(bx, by, 1, 1).data;
    pickedColor = { r: d[0], g: d[1], b: d[2] };
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
    setActiveImage(item.id);
    const { bx, by } = clientToBitmap(item, e.clientX, e.clientY);
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
    if (!rectDragging || rectDragItem !== item || !rectDragStart) return;
    const p = clientToBitmap(item, e.clientX, e.clientY);
    rectDragCurrent = { x: p.bx, y: p.by };
    drawRectLayer(item);
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
        rectStatus.textContent = `当前图已 ${item.rects.length} 个限定框`;
        updateClearRectButton();
      } else {
        rectStatus.textContent = "框选过小，已忽略";
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
    rectStatus.textContent = "在选中图片上拖拽绘制矩形…";
    modeHint.textContent = "拖拽绘制矩形框，松开后自动回到取色";
    updateCursors();
  });

  btnClearRect.addEventListener("click", () => {
    const active = getActiveItem();
    if (!active) return;
    active.rects = [];
    btnClearRect.disabled = true;
    rectStatus.textContent = "";
    drawRectLayer(active);
    if (pickedColor) refreshAllHighlights();
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

    for (const item of images) {
      const mask = item.selectionMask;
      if (!mask || item.selectionCount === 0) continue;

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
      item.rctx.clearRect(0, 0, item.rectCanvas.width, item.rectCanvas.height);
      clearOverlayHighlight(item);
    }

    for (const item of images) {
      drawRectLayer(item);
    }

    modeHint.textContent =
      "替换完成。可继续修改目标颜色后再次替换，或重新点击图片取色";
    if (pickedColor) refreshAllHighlights();
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
    const origText = btnDownload.querySelector("svg").nextSibling;
    const label = origText ? origText.textContent : "";
    if (origText) origText.textContent = " 打包中…";

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
      if (origText) origText.textContent = label;
    }
  });

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

        const footer = document.createElement("div");
        footer.className = "image-card-footer";
        footer.textContent = `${file.name} · ${w} × ${h} px`;

        wrap.appendChild(imageCanvas);
        wrap.appendChild(rectCanvas);
        wrap.appendChild(overlayCanvas);
        card.appendChild(wrap);
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
          selectionMask: null,
          selectionCount: 0,
          width: w,
          height: h,
        };

        overlayCanvas.addEventListener("click", (e) => onOverlayClick(item, e));
        overlayCanvas.addEventListener("pointerdown", (e) => onOverlayPointerDown(item, e));
        overlayCanvas.addEventListener("pointermove", (e) => onOverlayPointerMove(item, e));
        overlayCanvas.addEventListener("pointerup", (e) => onOverlayPointerUp(item, e));
        overlayCanvas.addEventListener("pointercancel", (e) => onOverlayPointerUp(item, e));

        card.addEventListener("click", (e) => {
          const t = /** @type {HTMLElement} */ (e.target);
          if (t === overlayCanvas) return;
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
    btnDownload.disabled = images.length === 0;
    btnDrawRect.disabled = images.length === 0;

    if (images.length && !activeImageId) {
      setActiveImage(images[0].id);
    } else if (activeImageId && !getActiveItem()) {
      setActiveImage(images.length ? images[0].id : null);
    } else {
      updateClearRectButton();
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
  btnReplace.disabled = true;
  btnDownload.disabled = true;
  btnDrawRect.disabled = true;
  btnClearRect.disabled = true;
  selectionStats.textContent = "已选中像素：—";
})();
