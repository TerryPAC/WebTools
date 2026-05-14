/**
 * 图片取色与颜色替换 — 纯前端 Canvas 实现
 */
(function () {
  "use strict";

  const fileInput = document.getElementById("fileInput");
  const uploadZone = document.getElementById("uploadZone");
  const uploadHint = document.getElementById("uploadHint");
  const canvasWrap = document.getElementById("canvasWrap");
  const imageCanvas = document.getElementById("imageCanvas");
  const rectCanvas = document.getElementById("rectCanvas");
  const overlayCanvas = document.getElementById("overlayCanvas");
  const ictx = imageCanvas.getContext("2d", { willReadFrequently: true });
  const rctx = rectCanvas.getContext("2d");
  const octx = overlayCanvas.getContext("2d", { willReadFrequently: true });

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
  const rInput = document.getElementById("rInput");
  const gInput = document.getElementById("gInput");
  const bInput = document.getElementById("bInput");
  const btnReplace = document.getElementById("btnReplace");
  const btnDownload = document.getElementById("btnDownload");

  /** @type {{ r: number; g: number; b: number } | null} */
  let pickedColor = null;
  /** @type {Uint8Array | null} 长度 w*h，1 表示选中 */
  let selectionMask = null;
  let selectionCount = 0;

  /** @type {{ x: number; y: number; w: number; h: number } | null} 图像像素坐标 */
  let regionRect = null;

  let rectDrawMode = false;
  let rectDragging = false;
  /** @type {{ x: number; y: number } | null} */
  let rectDragStart = null;
  /** @type {{ x: number; y: number } | null} */
  let rectDragCurrent = null;

  let ignorePickUntil = 0;
  let imageWidth = 0;
  let imageHeight = 0;

  const HIGHLIGHT = { r: 255, g: 0, b: 128, a: Math.round(0.45 * 255) };
  const MIN_RECT_SIZE = 3;

  function setWrapCursor(mode) {
    canvasWrap.classList.remove("cursor-pick", "cursor-rect");
    canvasWrap.classList.add(mode === "rect" ? "cursor-rect" : "cursor-pick");
  }

  function clientToBitmap(clientX, clientY) {
    const rect = imageCanvas.getBoundingClientRect();
    const sx = imageCanvas.width / rect.width;
    const sy = imageCanvas.height / rect.height;
    let bx = Math.floor((clientX - rect.left) * sx);
    let by = Math.floor((clientY - rect.top) * sy);
    bx = Math.max(0, Math.min(imageCanvas.width - 1, bx));
    by = Math.max(0, Math.min(imageCanvas.height - 1, by));
    return { bx, by };
  }

  function isInRegion(px, py) {
    if (!regionRect) return true;
    const r = regionRect;
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }

  function normalizeRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    return { x, y, w, h };
  }

  function clampRectToImage(rect) {
    let { x, y, w, h } = rect;
    x = Math.max(0, Math.min(x, imageWidth - 1));
    y = Math.max(0, Math.min(y, imageHeight - 1));
    w = Math.min(w, imageWidth - x);
    h = Math.min(h, imageHeight - y);
    return { x, y, w, h };
  }

  function drawRectLayer() {
    rctx.clearRect(0, 0, rectCanvas.width, rectCanvas.height);
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

    if (regionRect && regionRect.w >= 1 && regionRect.h >= 1) {
      drawOne(regionRect.x, regionRect.y, regionRect.w, regionRect.h, false);
    }
    if (rectDragging && rectDragStart && rectDragCurrent) {
      const n = normalizeRect(
        rectDragStart.x,
        rectDragStart.y,
        rectDragCurrent.x,
        rectDragCurrent.y
      );
      if (n.w >= 1 && n.h >= 1) drawOne(n.x, n.y, n.w, n.h, true);
    }
  }

  function clearOverlayHighlight() {
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  /**
   * 根据当前取色与容忍度计算 mask 并绘制高亮
   */
  function refreshSelectionAndHighlight() {
    clearOverlayHighlight();
    selectionMask = null;
    selectionCount = 0;

    if (!pickedColor || imageWidth === 0 || imageHeight === 0) {
      selectionStats.textContent = "已选中像素：—";
      return;
    }

    const w = imageWidth;
    const h = imageHeight;
    const imgData = ictx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const mask = new Uint8Array(w * h);

    const t = Number(toleranceEl.value);
    const maxDist = (t / 100) * 441;
    const maxDistSq = maxDist * maxDist;

    const pr = pickedColor.r;
    const pg = pickedColor.g;
    const pb = pickedColor.b;

    let x0 = 0;
    let y0 = 0;
    let x1 = w;
    let y1 = h;
    if (regionRect) {
      x0 = Math.max(0, Math.floor(regionRect.x));
      y0 = Math.max(0, Math.floor(regionRect.y));
      x1 = Math.min(w, Math.ceil(regionRect.x + regionRect.w));
      y1 = Math.min(h, Math.ceil(regionRect.y + regionRect.h));
    }

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (!isInRegion(px, py)) continue;
        const i = (py * w + px) * 4;
        const dr = d[i] - pr;
        const dg = d[i + 1] - pg;
        const db = d[i + 2] - pb;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq <= maxDistSq) {
          const mi = py * w + px;
          mask[mi] = 1;
          selectionCount++;
        }
      }
    }

    selectionMask = mask;
    selectionStats.textContent = `已选中像素：${selectionCount.toLocaleString()}`;

    if (selectionCount === 0) return;

    const hi = octx.createImageData(w, h);
    const hd = hi.data;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const mi = py * w + px;
        if (!mask[mi]) continue;
        const oi = mi * 4;
        hd[oi] = HIGHLIGHT.r;
        hd[oi + 1] = HIGHLIGHT.g;
        hd[oi + 2] = HIGHLIGHT.b;
        hd[oi + 3] = HIGHLIGHT.a;
      }
    }
    octx.putImageData(hi, 0, 0);
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
    btnReplace.disabled = false;
  }

  function pickAt(bx, by) {
    const d = ictx.getImageData(bx, by, 1, 1).data;
    pickedColor = { r: d[0], g: d[1], b: d[2] };
    updatePickedUI();
    refreshSelectionAndHighlight();
  }

  function onOverlayClick(e) {
    if (performance.now() < ignorePickUntil) return;
    if (rectDrawMode || rectDragging) return;
    if (!imageWidth) return;
    const { bx, by } = clientToBitmap(e.clientX, e.clientY);
    pickAt(bx, by);
  }

  function onOverlayPointerDown(e) {
    if (!imageWidth) return;
    if (!rectDrawMode) return;
    e.preventDefault();
    rectDragging = true;
    const p = clientToBitmap(e.clientX, e.clientY);
    rectDragStart = { x: p.bx, y: p.by };
    rectDragCurrent = { ...rectDragStart };
    overlayCanvas.setPointerCapture(e.pointerId);
    drawRectLayer();
  }

  function onOverlayPointerMove(e) {
    if (!rectDragging || !rectDragStart) return;
    const p = clientToBitmap(e.clientX, e.clientY);
    rectDragCurrent = { x: p.bx, y: p.by };
    drawRectLayer();
  }

  function onOverlayPointerUp(e) {
    if (!rectDragging) return;
    rectDragging = false;
    try {
      overlayCanvas.releasePointerCapture(e.pointerId);
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
      n = clampRectToImage(n);
      if (n.w >= MIN_RECT_SIZE && n.h >= MIN_RECT_SIZE) {
        regionRect = n;
        committed = true;
        btnClearRect.disabled = false;
        rectStatus.textContent = `已限定：${n.w}×${n.h} 像素`;
      } else {
        rectStatus.textContent = "框选过小，已忽略";
      }
    }

    if (dragDist > 4) {
      ignorePickUntil = performance.now() + 350;
    }
    rectDragStart = null;
    rectDragCurrent = null;
    rectDrawMode = false;
    btnDrawRect.disabled = false;
    modeHint.textContent = committed
      ? "已更新限定范围。可继续点击图片取色"
      : "请在图片上点击取色；或再次点击「绘制矩形框」限定范围";
    setWrapCursor("pick");
    drawRectLayer();
    if (pickedColor) refreshSelectionAndHighlight();
  }

  btnDrawRect.addEventListener("click", () => {
    if (!imageWidth) return;
    rectDrawMode = true;
    btnDrawRect.disabled = true;
    rectStatus.textContent = "在图片上拖拽绘制矩形…";
    modeHint.textContent = "拖拽绘制矩形框，松开后自动回到取色";
    setWrapCursor("rect");
  });

  btnClearRect.addEventListener("click", () => {
    regionRect = null;
    btnClearRect.disabled = true;
    rectStatus.textContent = "";
    drawRectLayer();
    if (pickedColor) refreshSelectionAndHighlight();
  });

  function updateSliderFill() {
    const val = Number(toleranceEl.value);
    toleranceEl.style.setProperty("--fill", val + "%");
  }

  toleranceEl.addEventListener("input", () => {
    toleranceValue.textContent = toleranceEl.value;
    updateSliderFill();
    if (pickedColor) refreshSelectionAndHighlight();
  });

  overlayCanvas.addEventListener("click", onOverlayClick);
  overlayCanvas.addEventListener("pointerdown", onOverlayPointerDown);
  overlayCanvas.addEventListener("pointermove", onOverlayPointerMove);
  overlayCanvas.addEventListener("pointerup", onOverlayPointerUp);
  overlayCanvas.addEventListener("pointercancel", onOverlayPointerUp);

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
    rInput.value = String(rgb.r);
    gInput.value = String(rgb.g);
    bInput.value = String(rgb.b);
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
    replaceColor.value = rgbToHex(r, g, b);
  }

  [rInput, gInput, bInput].forEach((el) => el.addEventListener("input", onRgbInput));

  btnReplace.addEventListener("click", () => {
    if (!selectionMask || !pickedColor || imageWidth === 0) return;

    const nr = parseInt(rInput.value, 10);
    const ng = parseInt(gInput.value, 10);
    const nb = parseInt(bInput.value, 10);
    const R = Math.max(0, Math.min(255, nr | 0));
    const G = Math.max(0, Math.min(255, ng | 0));
    const B = Math.max(0, Math.min(255, nb | 0));

    const w = imageWidth;
    const h = imageHeight;
    const imgData = ictx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const mask = selectionMask;

    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const py = Math.floor(i / w);
      const px = i % w;
      if (!isInRegion(px, py)) continue;
      const oi = i * 4;
      d[oi] = R;
      d[oi + 1] = G;
      d[oi + 2] = B;
      /* d[oi+3] alpha 不变 */
    }

    ictx.putImageData(imgData, 0, 0);
    if (pickedColor) {
      refreshSelectionAndHighlight();
    } else {
      clearOverlayHighlight();
      selectionMask = null;
      selectionCount = 0;
      selectionStats.textContent = "已选中像素：—";
    }
    modeHint.textContent =
      "替换完成。可继续调整容忍度、修改目标颜色后再次替换，或重新取色";
  });

  btnDownload.addEventListener("click", () => {
    if (!imageWidth) return;
    const a = document.createElement("a");
    a.href = imageCanvas.toDataURL("image/png");
    a.download = "edited-image.png";
    a.click();
  });

  function loadImageFromFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      imageWidth = img.naturalWidth;
      imageHeight = img.naturalHeight;
      uploadZone.classList.add("has-file");
      uploadHint.textContent = `${imageWidth} × ${imageHeight} px`;

      [imageCanvas, rectCanvas, overlayCanvas].forEach((c) => {
        c.width = imageWidth;
        c.height = imageHeight;
      });

      canvasWrap.style.aspectRatio = `${imageWidth} / ${imageHeight}`;
      canvasWrap.classList.add("has-image");

      ictx.drawImage(img, 0, 0);
      rctx.clearRect(0, 0, imageWidth, imageHeight);
      octx.clearRect(0, 0, imageWidth, imageHeight);

      regionRect = null;
      pickedColor = null;
      selectionMask = null;
      selectionCount = 0;
      rectDrawMode = false;
      rectDragging = false;
      btnClearRect.disabled = true;
      btnDrawRect.disabled = false;
      rectStatus.textContent = "";
      toleranceValue.textContent = toleranceEl.value;
      updatePickedUI();
      selectionStats.textContent = "已选中像素：—";
      btnDownload.disabled = false;
      modeHint.textContent = "请在图片上点击取色";
      setWrapCursor("pick");
      drawRectLayer();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      modeHint.textContent = "图片加载失败，请重试";
    };
    img.src = url;
  }

  fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadImageFromFile(f);
  });

  // Drag-and-drop upload
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
  });

  uploadZone.addEventListener("dragleave", (e) => {
    if (!uploadZone.contains(e.relatedTarget)) {
      uploadZone.classList.remove("drag-over");
    }
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) {
      loadImageFromFile(f);
    }
  });

  toleranceValue.textContent = toleranceEl.value;
  updateSliderFill();
  onRgbInput();
  setWrapCursor("pick");
  btnReplace.disabled = true;
  btnDownload.disabled = true;
})();
