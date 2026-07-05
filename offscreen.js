// offscreen.js
// background.js（Service Worker）にはクリップボードAPIが無いため、
// この非表示ドキュメント（Offscreen Document）を経由してクリップボードに書き込む。

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "qms-offscreen-copy") {
    navigator.clipboard.writeText(msg.text)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // 非同期レスポンス
  }
});
