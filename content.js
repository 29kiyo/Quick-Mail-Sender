// content.js - 部分スクリーンショットの範囲選択オーバーレイ
// executeScript で動的に注入されるため、二重実行を防ぐガードを置く

if (!window.__qmsContentLoaded) {
  window.__qmsContentLoaded = true;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "qms-start-partial-screenshot") {
      startSelectionOverlay();
    }
  });
}

function startSelectionOverlay() {
  if (document.getElementById("qms-overlay-root")) return;

  const root = document.createElement("div");
  root.id = "qms-overlay-root";
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0,0,0,0.15)"
  });

  const hint = document.createElement("div");
  hint.textContent = document.documentElement.lang?.startsWith("en")
    ? "Drag to select area (Esc to cancel)"
    : "ドラッグして範囲を選択（Escでキャンセル）";
  Object.assign(hint.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1f2937",
    color: "#fff",
    padding: "6px 14px",
    borderRadius: "999px",
    fontSize: "13px",
    fontFamily: "sans-serif",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    pointerEvents: "none"
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    border: "2px solid #2563eb",
    background: "rgba(37,99,235,0.15)",
    display: "none",
    pointerEvents: "none"
  });

  root.appendChild(box);
  root.appendChild(hint);
  document.documentElement.appendChild(root);

  let startX = 0, startY = 0, dragging = false;

  function onMouseDown(e) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.display = "block";
    updateBox(e.clientX, e.clientY);
  }

  function updateBox(x, y) {
    Object.assign(box.style, {
      left: Math.min(x, startX) + "px",
      top: Math.min(y, startY) + "px",
      width: Math.abs(x - startX) + "px",
      height: Math.abs(y - startY) + "px"
    });
  }

  function onMouseMove(e) {
    if (!dragging) return;
    updateBox(e.clientX, e.clientY);
  }

  function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    const rect = {
      x: Math.min(e.clientX, startX),
      y: Math.min(e.clientY, startY),
      width: Math.abs(e.clientX - startX),
      height: Math.abs(e.clientY - startY),
      dpr: window.devicePixelRatio || 1
    };
    cleanup();
    if (rect.width > 4 && rect.height > 4) {
      chrome.runtime.sendMessage({ action: "qms-partial-screenshot-rect", rect });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") cleanup();
  }

  function cleanup() {
    root.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  root.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("keydown", onKeyDown);
}
