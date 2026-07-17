importScripts("lib/common.js");

const MENU_SELECTION = "qms-send-selection";
const MENU_PAGE_URL = "qms-send-pageurl";
const MENU_IMAGE_URL = "qms-send-imageurl";
const MENU_ALL_TABS = "qms-send-alltabs";
const MENU_SCREENSHOT_FULL = "qms-screenshot-full";
const MENU_SCREENSHOT_PARTIAL = "qms-screenshot-partial";

// 言語キャッシュ（service workerは短命なので毎回detectLangを呼ぶ）
async function getLang() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const uiLang = settings?.uiLang;
  if (uiLang && uiLang !== "auto") return uiLang;
  // service workerにはnavigator.languageがある
  // 自動判定: 日本語ブラウザのみja、それ以外（未対応言語も含む）はすべて英語にフォールバックする
  const nav = (navigator.language || "en").toLowerCase();
  return nav.startsWith("ja") ? "ja" : "en";
}

function tr(lang, key, ...args) {
  const val = (TRANSLATIONS[lang] || TRANSLATIONS.ja)[key] || TRANSLATIONS.ja[key] || key;
  return val;
}

async function rebuildContextMenus() {
  const lang = await getLang();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION,         title: tr(lang, "menuSelection"),        contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_PAGE_URL,          title: tr(lang, "menuPageUrl"),          contexts: ["page", "frame", "link"] });
    chrome.contextMenus.create({ id: MENU_IMAGE_URL,         title: tr(lang, "menuImageUrl"),         contexts: ["image"] });
    chrome.contextMenus.create({ id: MENU_ALL_TABS,          title: tr(lang, "menuAllTabs"),          contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_SCREENSHOT_FULL,   title: tr(lang, "menuScreenshotFull"),   contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_SCREENSHOT_PARTIAL,title: tr(lang, "menuScreenshotPartial"),contexts: ["page"] });
  });
}

chrome.runtime.onInstalled.addListener(() => rebuildContextMenus());

// 言語設定が変わったときにメニューを再構築
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) rebuildContextMenus();
});

// 送信先を解決する。
// 常にpicker.html（選択ウィンドウ）を開いてユーザーに送信先を選んでもらう。
// pendingActionに後続処理を保存し、undefined を返す(=呼び出し側はここで処理を中断し、
// 選択後の続きはpickerからのメッセージで再開する)
async function resolveRecipientOrAskPicker(pendingAction) {
  await chrome.storage.local.set({ qmsPendingAction: pendingAction });
  await chrome.windows.create({
    url: chrome.runtime.getURL("picker.html"),
    type: "popup",
    width: 420,
    height: 520
  });
  return undefined;
}

async function notifyResult(title, message, isError) {
  try {
    // MV3のサービスワーカーは、待機中のPromiseがなくなると即座に終了することがあるため、
    // ここをawaitせず呼び出し元に戻ってしまうと、通知が実際に表示される前にサービス
    // ワーカーが終了し、トースト通知が出ないことがある。必ずawaitして呼び出すこと。
    await chrome.notifications?.create?.({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message
    });
  } catch (e) {
    console.error("[QuickMailSender] notification failed", e);
  }
  if (isError) console.error("[QuickMailSender]", title, message);
}

// メール作成画面を開く（mailto / Gmail = 手動送信。最終的な送信操作はユーザーが行う）
// mailto / Gmail compose URL には約2000文字の長さ制限がある
const COMPOSE_BODY_LIMIT = 1800; // 余裕を持たせた上限(文字数)

// Gmail送信元アカウント（authuser）解決: senderAccountIdが指定されていれば
// 対応するauthuserIndexを返す。未指定・見つからない場合はundefined（現在のアカウントのまま）。
async function resolveAuthuserIndex(senderAccountId) {
  if (!senderAccountId) return undefined;
  const accounts = await Storage.getSenderAccounts();
  const acc = accounts.find(a => a.id === senderAccountId);
  return acc && acc.authuserIndex !== undefined && acc.authuserIndex !== null && acc.authuserIndex !== ""
    ? acc.authuserIndex
    : undefined;
}

// GAS / Make.com 経由の自動送信（ユーザー自身のアカウントで動く外部Webアプリ／Webhookへの中継）
// mailto/Gmail手動送信と違い、ユーザー操作なしでメールが送信される点に注意。
// webhookId: 複数登録したWebhookのうちどれを使うかを指定する。未指定（旧データ）の場合は
// 有効になっている最初のWebhookにフォールバックする。
async function sendViaAutoChannel({ type, webhookId, to, subject, body, attachmentBase64, attachmentFilename, attachmentMimeType }) {
  const lang = await getLang();
  const webhooks = await Storage.getAutoSendWebhooks(type);

  let channel = webhookId ? webhooks.find(w => w.id === webhookId) : null;
  if (!channel) channel = webhooks.find(w => w.enabled) || null;

  if (!channel || !channel.enabled || !channel.url) {
    await notifyResult(
      tr(lang, "notifAutoSendNotConfiguredTitle"),
      tr(lang, "notifAutoSendNotConfiguredMsg"),
      true
    );
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "not_configured" };
  }

  // Make.comはbase64テキスト+toBinary()での変換が不安定なため、添付ファイルは実ファイルとして
  // multipart/form-dataでアップロードする。Make宛は添付の有無に関わらず常にこの形式に統一し、
  // Webhook側のデータ構造が毎回同じ形になるようにする（構造がブレると再設定が必要になるため）。
  const useMultipart = type === "make";

  try {
    let res;
    if (useMultipart) {
      const form = new FormData();
      form.append("to", to);
      form.append("subject", subject);
      form.append("body", body || "");

      if (attachmentBase64) {
        const byteChars = atob(attachmentBase64);
        const byteNumbers = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteNumbers], { type: attachmentMimeType || "image/png" });
        form.append("attachment", blob, attachmentFilename || "screenshot.png");
      }

      // Content-Typeは指定しない（FormDataがboundary付きで自動設定するため）
      res = await fetch(channel.url, { method: "POST", body: form });
    } else {
      const payload = { to, subject, body: body || "" };
      if (type === "gas" && channel.secret) payload.secret = channel.secret;
      if (attachmentBase64) {
        // GAS: Utilities.newBlob(base64decode(...))で添付化
        payload.attachment = attachmentBase64;
        payload.filename = attachmentFilename || "screenshot.png";
        payload.mimeType = attachmentMimeType || "image/png";
      }
      res = await fetch(channel.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    let data = {};
    try { data = await res.json(); } catch { /* GAS/Makeが非JSONを返す場合もそのまま許容 */ }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    await notifyResult(tr(lang, "statusAutoSendDoneTitle"), tr(lang, "statusAutoSendDoneMsg"), false);
    return { ok: true };
  } catch (err) {
    await notifyResult(
      tr(lang, "notifAutoSendFailedTitle"),
      `${tr(lang, "notifAutoSendFailedMsg")} (${err.message || err})`,
      true
    );
    return { ok: false, error: String(err && err.message || err) };
  }
}

// background.js（Service Worker）はクリップボードAPIに直接アクセスできないため、
// 非表示のOffscreen Documentを経由してテキストをコピーする
async function ensureOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "長文コンテンツをクリップボードにコピーするため"
    });
  } catch (e) {
    // すでにOffscreen Documentが存在する場合はエラーになるので無視する
  }
}

async function copyTextToClipboard(text) {
  try {
    await ensureOffscreenDocument();
    const res = await chrome.runtime.sendMessage({ action: "qms-offscreen-copy", text });
    return !!res?.ok;
  } catch (e) {
    console.error("[QuickMailSender] clipboard copy failed", e);
    return false;
  }
}

async function openCompose({ to, subject, body, recipientType, attachmentBase64, attachmentFilename, attachmentMimeType, webhookId, authuserIndex }) {
  // GAS / Make.com 宛の場合はコンポーズ画面を開かず、直接自動送信する
  if (recipientType === "gas" || recipientType === "make") {
    await sendViaAutoChannel({ type: recipientType, webhookId, to, subject, body, attachmentBase64, attachmentFilename, attachmentMimeType });
    return;
  }

  let safeBody = body;
  let truncated = false;
  if (body && body.length > COMPOSE_BODY_LIMIT) {
    const lang = await getLang();
    const notice = tr(lang, "truncatedNotice");
    safeBody = body.slice(0, COMPOSE_BODY_LIMIT) + notice;
    truncated = true;

    // 全文をクリップボードにコピー（すぐに貼り付けられるように）
    const copied = await copyTextToClipboard(body);

    // 念のためテキストファイルとしても保存しておく（コピーに失敗した場合の保険）
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const reader = new FileReader();
    const dataUrl = await new Promise(res => { reader.onload = () => res(reader.result); reader.readAsDataURL(blob); });
    await chrome.downloads.download({
      url: dataUrl,
      filename: `quick-mail-full-content-${Date.now()}.txt`,
      saveAs: false
    });
    await notifyResult(
      tr(lang, "notifTruncatedTitle"),
      copied ? tr(lang, "notifTruncatedCopiedMsg") : tr(lang, "notifTruncatedMsg")
    );
  }

  let url;
  if (recipientType === "gmail") {
    url = buildGmailWebCompose({ to, subject, body: safeBody, authuserIndex });
  } else {
    url = buildMailto({ to, subject, body: safeBody });
  }
  await chrome.tabs.create({ url, active: true });
}

async function sendTextLike({ kind, text, recipient, subjectPrefix }) {
  const r = recipient;
  if (!r) return;
  const lang = await getLang();
  const subject = subjectPrefix || tr(lang, "subjectCustom");
  const authuserIndex = r.type === "gmail" ? await resolveAuthuserIndex(r.senderAccountId) : undefined;
  await openCompose({ to: r.email, subject, body: text, recipientType: r.type, webhookId: r.webhookId, authuserIndex });
  await Storage.addHistory({
    type: kind,
    recipientName: r.name,
    recipientEmail: r.email,
    preview: text.slice(0, 200)
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendScreenshot({ tab, cropRect, recipient }) {
  const r = recipient;
  if (!r) return;
  const lang = await getLang();

  // 右クリックメニューから呼ばれた場合、メニューが閉じるまで少し待つ
  // （待機しないとスクショにコンテキストメニューが映り込むことがある）
  await new Promise(res => setTimeout(res, 250));

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const finalDataUrl = cropRect ? await cropImage(dataUrl, cropRect) : dataUrl;
  const base64 = finalDataUrl.split(",")[1];

  if (r.type === "gas" || r.type === "make") {
    // GAS/Make.com 経由でスクリーンショットを画像添付として自動送信する
    const filename = `quick-mail-screenshot-${Date.now()}.png`;
    await openCompose({
      to: r.email,
      subject: tr(lang, "subjectScreenshot"),
      body: tr(lang, "screenshotAutoSendBody"),
      recipientType: r.type,
      webhookId: r.webhookId,
      attachmentBase64: base64,
      attachmentFilename: filename,
      attachmentMimeType: "image/png"
    });
  } else if (r.type === "gmail") {
    // Gmail の場合：コンポーズ画面を開き、ロード完了後に画像を自動貼り付け
    const authuserIndex = await resolveAuthuserIndex(r.senderAccountId);
    await openGmailWithScreenshot({ to: r.email, subject: tr(lang, "subjectScreenshot"), base64, lang, authuserIndex });
  } else {
    // mailto の場合：ダウンロードして手動添付を案内
    const filename = `quick-mail-screenshot-${Date.now()}.png`;
    await chrome.downloads.download({ url: finalDataUrl, filename, saveAs: false });
    const body = `${tr(lang, "screenshotSaved")} ${filename}\n${tr(lang, "screenshotMailtoNote")}`;
    await openCompose({ to: r.email, subject: tr(lang, "subjectScreenshot"), body, recipientType: r.type });
  }

  await Storage.addHistory({
    type: "screenshot",
    recipientName: r.name,
    recipientEmail: r.email,
    preview: tab.url
  });
}

// 拡張子をMIMEタイプから決める（不明な場合はpngにフォールバック）
function extFromMimeType(mime) {
  const map = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
    "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp"
  };
  return map[mime] || "png";
}

// 右クリック「画像のURLをメール送信」：URL・掲載元ページURLに加えて、可能であれば画像本体も添付/貼り付けする。
// 画像の取得はサイト側のCORS設定に依存するため、取得できない場合はURLのみで送信する（失敗しても静かにフォールバック）。
async function sendImageWithUrl({ srcUrl, pageUrl, recipient }) {
  const r = recipient;
  if (!r) return;
  const lang = await getLang();
  const subject = tr(lang, "subjectImageUrl");
  const textBody = [
    tr(lang, "imageUrlLabel"),
    srcUrl,
    "",
    tr(lang, "screenshotSourcePage"),
    pageUrl || ""
  ].join("\n");

  let imageData = null;
  try {
    const res = await fetch(srcUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type && blob.type.startsWith("image/") && blob.size > 0) {
        const dataUrl = await blobToDataUrl(blob);
        imageData = { base64: dataUrl.split(",")[1], mimeType: blob.type };
      }
    }
  } catch (e) {
    // クロスオリジンの画像はCORS制限で取得できないことがある。その場合はURLのみで送信する
    imageData = null;
  }

  if (r.type === "gas" || r.type === "make") {
    if (imageData) {
      const filename = `quick-mail-image-${Date.now()}.${extFromMimeType(imageData.mimeType)}`;
      await openCompose({
        to: r.email, subject, body: textBody, recipientType: r.type, webhookId: r.webhookId,
        attachmentBase64: imageData.base64, attachmentFilename: filename, attachmentMimeType: imageData.mimeType
      });
    } else {
      await openCompose({ to: r.email, subject, body: textBody, recipientType: r.type, webhookId: r.webhookId });
    }
  } else if (r.type === "gmail") {
    const authuserIndex = await resolveAuthuserIndex(r.senderAccountId);
    if (imageData) {
      const filename = `image.${extFromMimeType(imageData.mimeType)}`;
      await openGmailWithImage({
        to: r.email, subject, body: textBody, base64: imageData.base64,
        mimeType: imageData.mimeType, filename, lang, authuserIndex
      });
    } else {
      const body = `${textBody}\n\n${tr(lang, "imageGmailNote")}`;
      await openCompose({ to: r.email, subject, body, recipientType: r.type, authuserIndex });
    }
  } else {
    // mailto（標準メールアプリ/その他）：添付不可のため、取得できた場合はダウンロードして手動添付を案内
    let body = textBody;
    if (imageData) {
      const filename = `quick-mail-image-${Date.now()}.${extFromMimeType(imageData.mimeType)}`;
      const dataUrl = `data:${imageData.mimeType};base64,${imageData.base64}`;
      await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
      body = `${textBody}\n\n${tr(lang, "imageSaved")} ${filename}\n${tr(lang, "imageMailtoNote")}`;
    }
    await openCompose({ to: r.email, subject, body, recipientType: r.type });
  }

  await Storage.addHistory({
    type: "image",
    recipientName: r.name,
    recipientEmail: r.email,
    preview: srcUrl
  });
}

// Gmail コンポーズ画面を開いて画像を自動貼り付けする（スクリーンショット・画像URL送信の両方で使用）
async function openGmailWithImage({ to, subject, body, base64, mimeType, filename, lang, authuserIndex }) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject });
  if (body) params.set("body", body);
  const base = (authuserIndex !== null && authuserIndex !== undefined && authuserIndex !== "")
    ? `https://mail.google.com/mail/u/${authuserIndex}/`
    : `https://mail.google.com/mail/`;
  const url = `${base}?${params}`;
  const newTab = await chrome.tabs.create({ url, active: true });

  // タブのロード完了を待ってからスクリプトを注入
  await new Promise((resolve) => {
    function onUpdated(tabId, info) {
      if (tabId === newTab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    // タイムアウト保険（15秒）
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }, 15000);
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: newTab.id },
      func: pasteImageIntoGmail,
      args: [base64, mimeType || "image/png", filename || "image.png", lang === "en"
        ? "Pasting image... please wait"
        : "画像を貼り付けています..."]
    });
  } catch (e) {
    // 注入失敗時はダウンロードにフォールバック
    await notifyResult(
      lang === "en" ? "Auto-paste failed" : "自動貼り付けに失敗しました",
      lang === "en"
        ? "The image was not pasted automatically. Please paste it manually (Ctrl+V)."
        : "画像の自動貼り付けができませんでした。手動でCtrl+Vで貼り付けてください。",
      true
    );
  }
}

// 互換用: 既存のスクリーンショット送信呼び出し口はそのまま（内部でopenGmailWithImageを使う）
async function openGmailWithScreenshot({ to, subject, base64, lang, authuserIndex }) {
  await openGmailWithImage({ to, subject, base64, mimeType: "image/png", filename: "screenshot.png", lang, authuserIndex });
}

// Gmail のコンポーズ画面に画像を貼り付ける（注入関数 - シリアライズされるため自己完結）
function pasteImageIntoGmail(base64, mimeType, filename, hintText) {
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function tryPaste(attemptsLeft) {
    if (attemptsLeft <= 0) return;

    // Gmail のコンポーズ本文エリアを探す
    const area =
      document.querySelector('[contenteditable="true"][g_editable="true"]') ||
      document.querySelector('.Am.Al.editable[contenteditable="true"]') ||
      document.querySelector('[role="textbox"][contenteditable="true"]');

    if (!area) {
      setTimeout(() => tryPaste(attemptsLeft - 1), 400);
      return;
    }

    area.focus();

    const blob = base64ToBlob(base64, mimeType);
    const file = new File([blob], filename, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);

    area.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    }));
  }

  tryPaste(30); // 最大30回 × 400ms = 12秒待つ
}

async function cropImage(dataUrl, cropRect) {
  const img = await fetch(dataUrl).then(r => r.blob()).then(b => createImageBitmap(b));
  const dpr = cropRect.dpr || 1;
  const sx = Math.max(0, Math.round(cropRect.x * dpr));
  const sy = Math.max(0, Math.round(cropRect.y * dpr));
  const sw = Math.max(1, Math.round(cropRect.width * dpr));
  const sh = Math.max(1, Math.round(cropRect.height * dpr));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

// 単体のURLも全タブ送信と同じ見た目（番号+タイトル+URL）に揃える
function formatSingleUrl(title, url) {
  return `[1] ${title}\n${url}`;
}

function formatTabsList(tabs, noTitle = "(タイトルなし)") {
  const valid = tabs.filter(t => t.url);
  return valid
    .map((t, i) => {
      const title = (t.title || noTitle).trim();
      return `[${i + 1}] ${title}\n${t.url}`;
    })
    .join("\n\n---\n\n");
}

// content_scriptsはmanifestから削除し、必要なときだけactiveTab権限で動的注入する。
// これにより host_permissions "<all_urls>" が不要になり、過剰な権限を要求しない。
// content.js側の __qmsContentLoaded ガードにより二重注入しても安全。
async function startPartialScreenshot(tab) {
  if (!tab || !tab.id) return;
  const lang = await getLang();
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tab.id, { action: "qms-start-partial-screenshot" });
  } catch (e) {
    await notifyResult(
      tr(lang, "notifScreenshotFailTitle"),
      tr(lang, "notifScreenshotFailMsg"),
      true
    );
  }
}

// picker.html で送信先が選択された後、保留していた処理を実行する
async function handlePickerSelection(recipientId) {
  const recipients = await Storage.getRecipients();
  const recipient = recipients.find(r => r.id === recipientId);
  if (!recipient) return;
  await executePendingActionWithRecipient(recipient);
}

async function executePendingActionWithRecipient(recipient) {
  const { qmsPendingAction } = await chrome.storage.local.get(["qmsPendingAction"]);
  await chrome.storage.local.remove("qmsPendingAction");
  if (!qmsPendingAction) return;

  const pending = qmsPendingAction;

  if (pending.kind === "screenshot-full" || pending.kind === "screenshot-partial") {
    let tab;
    try {
      tab = await chrome.tabs.get(pending.tabId);
    } catch {
      await notifyResult(
      lang === "en" ? "Cannot send" : "送信できません",
      tr(lang, "noTabClosedMsg"), true
    );
      return;
    }
    await sendScreenshot({ tab, cropRect: pending.rect, recipient });
    return;
  }

  if (pending.kind === "image") {
    await sendImageWithUrl({ srcUrl: pending.srcUrl, pageUrl: pending.pageUrl, recipient });
    return;
  }

  // text / url / tabs
  await sendTextLike({
    kind: pending.kind,
    text: pending.text,
    subjectPrefix: pending.subjectPrefix,
    recipient
  });
}

// popup.html/voice.htmlのインライン複数選択チェックリストで既に選択済みのIDがあればそれを使い、
// なければ従来通りpicker.htmlを開いて選んでもらう（右クリック等インラインUIがない文脈用）
async function deliverPendingWithOptionalIds(pending, recipientIds) {
  if (recipientIds && recipientIds.length > 0) {
    const all = await Storage.getRecipients();
    const targets = recipientIds.map(id => all.find(r => r.id === id)).filter(Boolean);
    await deliverToMultipleRecipients(pending, targets);
    return;
  }
  const r = await resolveRecipientOrAskPicker(pending);
  if (!r) return;
  if (pending.kind === "screenshot-full" || pending.kind === "screenshot-partial") {
    let tab;
    try { tab = await chrome.tabs.get(pending.tabId); } catch { return; }
    await sendScreenshot({ tab, cropRect: pending.rect, recipient: r });
  } else if (pending.kind === "image") {
    await sendImageWithUrl({ srcUrl: pending.srcUrl, pageUrl: pending.pageUrl, recipient: r });
  } else {
    await sendTextLike({ ...pending, recipient: r });
  }
}

// キーボードショートカット（アドレスバーにフォーカスがある状態でも使える）
// pending内容を、複数の送信先オブジェクトへまとめて配送する（picker.htmlの複数選択・
// ポップアップ/音声入力のインライン複数選択チェックリストの両方から呼ばれる共通処理）
async function deliverToMultipleRecipients(pending, targets) {
  if (!pending || !targets || targets.length === 0) return;
  const lang = await getLang();

  // スクショは各送信先に個別送信（添付案内文に宛先名が入るため）
  if (pending.kind === "screenshot-full" || pending.kind === "screenshot-partial") {
    for (const recipient of targets) {
      let tab;
      try { tab = await chrome.tabs.get(pending.tabId); } catch { continue; }
      await sendScreenshot({ tab, cropRect: pending.rect, recipient });
    }
    return;
  }

  // 画像URL送信も各送信先に個別送信する（画像取得の成否や添付内容が宛先種類ごとに変わるため）
  if (pending.kind === "image") {
    for (const recipient of targets) {
      await sendImageWithUrl({ srcUrl: pending.srcUrl, pageUrl: pending.pageUrl, recipient });
    }
    return;
  }

  // テキスト系:
  // - mailto/gmail/other は同じ種類ごとにカンマ区切りでまとめて1通に送る（従来通り）
  // - GAS/Make自動送信は、複数アドレスをカンマ区切りで渡すと中継先（特にMake.com）が
  //   「無効なメールアドレス」として弾いてしまうため、宛先ごとに個別送信する
  const subject = pending.subjectPrefix || tr(lang, "subjectCustom");

  const autoChannelTargets = targets.filter(r => r.type === "gas" || r.type === "make");
  const composeTargets = targets.filter(r => r.type !== "gas" && r.type !== "make");

  for (const recipient of autoChannelTargets) {
    await openCompose({
      to: recipient.email,
      subject,
      body: pending.text,
      recipientType: recipient.type,
      webhookId: recipient.webhookId
    });
    await Storage.addHistory({
      type: pending.kind,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      preview: pending.text ? pending.text.slice(0, 200) : ""
    });
  }

  // 種類ごとにグループ化。Gmailは送信元アカウント(senderAccountId)が異なると
  // 別々のタブを開く必要があるため、type単独ではなく type+senderAccountId でグループ化する。
  const groups = {};
  for (const r of composeTargets) {
    const key = r.type === "gmail" ? `gmail::${r.senderAccountId || ""}` : (r.type || "standard");
    if (!groups[key]) groups[key] = { type: r.type || "standard", senderAccountId: r.senderAccountId, list: [] };
    groups[key].list.push(r);
  }

  for (const groupObj of Object.values(groups)) {
    const group = groupObj.list;
    // 複数のメールアドレスをカンマ区切りで結合（mailto/Gmail共に対応）
    const toAddresses = group.map(r => r.email).join(",");
    const authuserIndex = groupObj.type === "gmail" ? await resolveAuthuserIndex(groupObj.senderAccountId) : undefined;
    await openCompose({
      to: toAddresses,
      subject,
      body: pending.text,
      recipientType: groupObj.type,
      authuserIndex
    });
    // 履歴は代表として先頭の送信先で記録（複数名をpreviewに追記）
    const names = group.map(r => r.name).join(", ");
    await Storage.addHistory({
      type: pending.kind,
      recipientName: names,
      recipientEmail: toAddresses,
      preview: pending.text ? pending.text.slice(0, 200) : ""
    });
  }
}

// picker.html で複数送信先を選択して一括送信（pendingActionはstorage経由）
async function handlePickerMulti(recipientIds) {
  const { qmsPendingAction } = await chrome.storage.local.get(["qmsPendingAction"]);
  await chrome.storage.local.remove("qmsPendingAction");
  if (!qmsPendingAction || !recipientIds || recipientIds.length === 0) return;

  const all = await Storage.getRecipients();
  const targets = recipientIds.map(id => all.find(r => r.id === id)).filter(Boolean);
  await deliverToMultipleRecipients(qmsPendingAction, targets);
}

// picker.html で「一回限りの宛先」を使って送信
async function handlePickerOneTime({ name, email, type, senderAccountId }) {
  const { qmsPendingAction } = await chrome.storage.local.get(["qmsPendingAction"]);
  await chrome.storage.local.remove("qmsPendingAction");
  if (!qmsPendingAction) return;
  const lang = await getLang();
  const recipient = {
    id: null,
    name: name || (lang === "en" ? "One-time recipient" : "一回限りの送信先"),
    email,
    type: type || "standard",
    senderAccountId: type === "gmail" ? (senderAccountId || null) : null
  };
  const pending = qmsPendingAction;
  if (pending.kind === "screenshot-full" || pending.kind === "screenshot-partial") {
    let tab;
    try {
      tab = await chrome.tabs.get(pending.tabId);
    } catch {
      await notifyResult(
        lang === "en" ? "Cannot send" : "送信できません",
        tr(lang, "noTabClosedMsg"),
        true
      );
      return;
    }
    await sendScreenshot({ tab, cropRect: pending.rect, recipient });
    return;
  }
  if (pending.kind === "image") {
    await sendImageWithUrl({ srcUrl: pending.srcUrl, pageUrl: pending.pageUrl, recipient });
    return;
  }
  await sendTextLike({
    kind: pending.kind,
    text: pending.text,
    subjectPrefix: pending.subjectPrefix,
    recipient
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "send-page-url") return;
  try {
    const lang = await getLang();
    const noTitle = lang === "en" ? "(no title)" : "(タイトルなし)";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const pending = {
      kind: "url",
      text: formatSingleUrl(tab.title || noTitle, tab.url || ""),
      subjectPrefix: tr(lang, "subjectPageUrl")
    };
    const r = await resolveRecipientOrAskPicker(pending);
    if (r) await sendTextLike({ ...pending, recipient: r });
  } catch (e) {
    console.error("[QuickMailSender] command error", e);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const lang = await getLang();
    const noTitle = lang === "en" ? "(no title)" : "(タイトルなし)";

    if (info.menuItemId === MENU_SELECTION) {
      const pending = {
        kind: "text",
        text: info.selectionText || "",
        subjectPrefix: tr(lang, "subjectSelection")
      };
      const r = await resolveRecipientOrAskPicker(pending);
      if (r) await sendTextLike({ ...pending, recipient: r });
    } else if (info.menuItemId === MENU_PAGE_URL) {
      const pending = {
        kind: "url",
        text: formatSingleUrl(tab?.title || noTitle, tab?.url || info.pageUrl || ""),
        subjectPrefix: tr(lang, "subjectPageUrl")
      };
      const r = await resolveRecipientOrAskPicker(pending);
      if (r) await sendTextLike({ ...pending, recipient: r });
    } else if (info.menuItemId === MENU_IMAGE_URL) {
      const pending = {
        kind: "image",
        srcUrl: info.srcUrl || "",
        pageUrl: tab?.url || info.pageUrl || ""
      };
      const r = await resolveRecipientOrAskPicker(pending);
      if (r) await sendImageWithUrl({ srcUrl: pending.srcUrl, pageUrl: pending.pageUrl, recipient: r });
    } else if (info.menuItemId === MENU_ALL_TABS) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const urls = formatTabsList(tabs, noTitle);
      const subjectPrefix = lang === "en"
        ? `${tabs.length} ${tr(lang, "subjectAllTabs")}`
        : `開いている${tabs.length}個のタブのURL`;
      const pending = { kind: "tabs", text: urls, subjectPrefix };
      const r = await resolveRecipientOrAskPicker(pending);
      if (r) await sendTextLike({ ...pending, recipient: r });
    } else if (info.menuItemId === MENU_SCREENSHOT_FULL) {
      const pending = { kind: "screenshot-full", tabId: tab.id, windowId: tab.windowId };
      const r = await resolveRecipientOrAskPicker(pending);
      if (r) await sendScreenshot({ tab, recipient: r });
    } else if (info.menuItemId === MENU_SCREENSHOT_PARTIAL) {
      await startPartialScreenshot(tab);
    }
  } catch (e) {
    console.error("[QuickMailSender] context menu error", e);
  }
});

// content script / popup からのメッセージ処理
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.action === "qms-partial-screenshot-rect") {
        const tab = sender.tab;
        const pending = {
          kind: "screenshot-partial",
          tabId: tab.id,
          windowId: tab.windowId,
          rect: msg.rect
        };
        const { qmsPendingRecipientIds } = await chrome.storage.local.get(["qmsPendingRecipientIds"]);
        await chrome.storage.local.remove("qmsPendingRecipientIds");
        await deliverPendingWithOptionalIds(pending, qmsPendingRecipientIds);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-send-freetext") {
        // ポップアップ/音声入力の自由入力テキスト送信：右クリック等と同じくpickerで複数選択できるようにする
        const lang = await getLang();
        const pending = {
          kind: "text",
          text: msg.body || "",
          subjectPrefix: msg.subject || tr(lang, "subjectCustom")
        };
        await deliverPendingWithOptionalIds(pending, msg.recipientIds);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-send-current-url-from-popup") {
        // ポップアップの「現在のページURLを送信」ボタン：右クリックの「ページURL送信」と同じ
        // フロー（resolveRecipientOrAskPicker）を通す
        const lang = await getLang();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const noTitle = lang === "en" ? "(no title)" : "(タイトルなし)";
        const pending = {
          kind: "url",
          text: formatSingleUrl(tab?.title || noTitle, tab?.url || ""),
          subjectPrefix: tr(lang, "subjectPageUrl")
        };
        await deliverPendingWithOptionalIds(pending, msg.recipientIds);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-send-all-tabs-from-popup") {
        // ポップアップの「全タブのURLを送信」ボタン：右クリックの「全タブのURL送信」と同じ
        // フロー（resolveRecipientOrAskPicker）を通す。GAS/Make宛先の確認ステップも効くようにするため
        const lang = await getLang();
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const urls = formatTabsList(tabs, lang === "en" ? "(no title)" : "(タイトルなし)");
        const subjectPrefix = lang === "en"
          ? `All tab URLs (${tabs.length} tabs)`
          : `開いている${tabs.length}個のタブのURL`;
        const pending = { kind: "tabs", text: urls, subjectPrefix };
        await deliverPendingWithOptionalIds(pending, msg.recipientIds);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-capture-full-active-tab") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const pending = { kind: "screenshot-full", tabId: tab.id, windowId: tab.windowId };
        await deliverPendingWithOptionalIds(pending, msg.recipientIds);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-start-partial-from-popup") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // 範囲選択は完了までにポップアップが閉じてしまうため、選択済みIDを一時保存しておく
        if (msg.recipientIds && msg.recipientIds.length > 0) {
          await chrome.storage.local.set({ qmsPendingRecipientIds: msg.recipientIds });
        } else {
          await chrome.storage.local.remove("qmsPendingRecipientIds");
        }
        await startPartialScreenshot(tab);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-picker-selected") {
        await handlePickerSelection(msg.recipientId);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-picker-multi") {
        // 複数の送信先に一括送信
        await handlePickerMulti(msg.recipientIds);
        sendResponse({ ok: true });
      } else if (msg.action === "qms-picker-onetime") {
        await handlePickerOneTime({ name: msg.name, email: msg.email, type: msg.type, senderAccountId: msg.senderAccountId });
        sendResponse({ ok: true });
      }
    } catch (e) {
      console.error("[QuickMailSender] message error", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // 非同期レスポンス
});
