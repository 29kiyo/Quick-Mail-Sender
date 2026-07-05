// popup.js

const oneTimeToggle = document.getElementById("oneTimeToggle");
const oneTimeFields = document.getElementById("oneTimeFields");
const oneTimeName = document.getElementById("oneTimeName");
const oneTimeEmail = document.getElementById("oneTimeEmail");
const oneTimeType = document.getElementById("oneTimeType");
const oneTimeSenderRow = document.getElementById("oneTimeSenderRow");
const oneTimeSenderAccount = document.getElementById("oneTimeSenderAccount");
const bodyText = document.getElementById("bodyText");
const subjectInput = document.getElementById("subjectInput");
const micBtn = document.getElementById("micBtn");
const statusMsg = document.getElementById("statusMsg");
const themeToggle = document.getElementById("themeToggle");
const pinWindowBtn = document.getElementById("pinWindowBtn");
const recipientChecklist = document.getElementById("recipientChecklist");
const recipientEmptyHint = document.getElementById("recipientEmptyHint");
const recipientAutoSendWarning = document.getElementById("recipientAutoSendWarning");

// ?pinned=1 付きで開かれている場合は「固定表示ウィンドウ」として動作する
// （通常のツールバーポップアップはフォーカスを失うと自動で閉じてしまうため、
//   独立したウィンドウとして開くことで固定表示を実現している）
const isPinnedWindow = new URLSearchParams(location.search).get("pinned") === "1";

async function init() {
  const { t: _t, lang } = await loadI18n();
  applyI18nToPage();
  const theme = await applyTheme();
  updateThemeIcon(theme);
  initPinWindowButton();
  await RecipientChecklist.render(recipientChecklist, recipientEmptyHint, recipientAutoSendWarning);
  document.getElementById("recipientEmptyLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  await refreshOneTimeSenderAccountOptions();
  oneTimeType.addEventListener("change", onOneTimeTypeChange);
  onOneTimeTypeChange();
}

// 一回限りの宛先が「Gmail」の場合のみ、送信元アカウントの選択欄を表示する
function onOneTimeTypeChange() {
  oneTimeSenderRow.classList.toggle("hidden", oneTimeType.value !== "gmail");
}

// 送信元アカウントのプルダウンを、登録済みのGmail送信元アカウントで再描画する
async function refreshOneTimeSenderAccountOptions() {
  const accounts = await Storage.getSenderAccounts();
  const prev = oneTimeSenderAccount.value;
  oneTimeSenderAccount.innerHTML = `<option value="">${t("recipientSenderAccountDefaultOption")}</option>` +
    accounts.map(a => `<option value="${a.id}">${escapeHtml(a.label)} (u/${a.authuserIndex})</option>`).join("");
  oneTimeSenderAccount.value = prev;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function initPinWindowButton() {
  if (isPinnedWindow) {
    // すでに固定表示ウィンドウの場合：見た目を変え、再クリックでこのウィンドウを閉じる
    // （閉じれば、次にツールバーアイコンを押したときは通常のポップアップに戻る）
    pinWindowBtn.textContent = "📌";
    pinWindowBtn.classList.add("pinned-active");
    pinWindowBtn.title = t("pinWindowActiveTitle");
    pinWindowBtn.addEventListener("click", () => {
      window.close();
    });
    return;
  }
  pinWindowBtn.addEventListener("click", () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?pinned=1"),
      type: "popup",
      width: 380,
      height: 640
    });
    window.close();
  });
}

// data-i18n属性をもとにページのテキストを翻訳で差し替える
function applyI18nToPage() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t(key)) el.textContent = t(key);
  });
  // リンク等のインラインタグを含む静的な説明文のみに限定して使用する（開発者が用意した固定文言のみ）
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    const key = el.getAttribute("data-i18n-html");
    if (t(key)) el.innerHTML = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (t(key)) el.placeholder = t(key);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    if (t(key)) el.title = t(key);
  });
  // select内のoptionも翻訳
  document.querySelectorAll("option[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t(key)) el.textContent = t(key);
  });
}

oneTimeToggle.addEventListener("change", () => {
  oneTimeFields.classList.toggle("hidden", !oneTimeToggle.checked);
  recipientChecklist.classList.toggle("hidden", oneTimeToggle.checked);
  if (oneTimeToggle.checked) {
    recipientAutoSendWarning.classList.add("hidden");
  } else {
    RecipientChecklist.syncWarning(recipientChecklist, recipientAutoSendWarning);
  }
});

function setStatus(text, isError) {
  statusMsg.textContent = text;
  statusMsg.style.color = isError ? "var(--danger)" : "var(--text-soft)";
  if (text) {
    setTimeout(() => {
      statusMsg.textContent = "";
    }, 3500);
  }
}

// 一回限りの送信先入力があるかどうかだけを見る（登録済み送信先はpicker側で複数選択できる）
function resolveOneTimeRecipient() {
  if (!oneTimeToggle.checked) return null;
  const email = oneTimeEmail.value.trim();
  if (!email) {
    setStatus(t("statusNoRecipient"), true);
    return undefined; // 入力エラー
  }
  const type = oneTimeType.value;
  return {
    id: null,
    name: oneTimeName.value.trim() || t("oneTimeLabel"),
    email,
    type,
    senderAccountId: type === "gmail" ? (oneTimeSenderAccount.value || null) : null,
    oneTime: true
  };
}

// 登録済み送信先チェックリストから選択済みIDを取得する。1件も選ばれていなければエラー表示してnullを返す
function getSelectedRecipientIdsOrWarn() {
  const ids = RecipientChecklist.getCheckedIds(recipientChecklist);
  if (ids.length === 0) {
    setStatus(t("statusNoRecipientRegistered"), true);
    return null;
  }
  return ids;
}

document.getElementById("sendTextBtn").addEventListener("click", async () => {
  const text = bodyText.value.trim();
  if (!text) {
    setStatus(t("statusNoContent"), true);
    return;
  }
  const subject = subjectInput.value.trim() || t("subjectCustom");

  const oneTime = resolveOneTimeRecipient();
  if (oneTime === undefined) return; // 一回限り入力が空でエラー表示済み
  if (oneTime) {
    await sendOneTime(oneTime, subject, text);
    bodyText.value = "";
    subjectInput.value = "";
    return;
  }

  const recipientIds = getSelectedRecipientIdsOrWarn();
  if (!recipientIds) return;

  await chrome.runtime.sendMessage({ action: "qms-send-freetext", body: text, subject, recipientIds });
  bodyText.value = "";
  subjectInput.value = "";
  window.close();
});

async function sendOneTime(recipient, subject, body) {
  let url;
  if (recipient.type === "gmail") {
    const authuserIndex = await resolveAuthuserIndexLocal(recipient.senderAccountId);
    url = buildGmailWebCompose({ to: recipient.email, subject, body, authuserIndex });
  } else {
    const params = new URLSearchParams();
    params.set("subject", subject);
    params.set("body", body);
    url = `mailto:${encodeURIComponent(recipient.email)}?${params.toString().replace(/\+/g, "%20")}`;
  }
  await chrome.tabs.create({ url });
  setStatus(t("statusOpenedOnetime"));
}

// senderAccountId から authuserIndex を解決する（popup.js内で完結させるためのローカル版）
async function resolveAuthuserIndexLocal(senderAccountId) {
  if (!senderAccountId) return undefined;
  const accounts = await Storage.getSenderAccounts();
  const acc = accounts.find(a => a.id === senderAccountId);
  return acc ? acc.authuserIndex : undefined;
}

function formatSingleUrl(title, url) {
  return `[1] ${title}\n${url}`;
}

document.getElementById("sendUrlBtn").addEventListener("click", async () => {
  const recipientIds = getSelectedRecipientIdsOrWarn();
  if (!recipientIds) return;
  await chrome.runtime.sendMessage({ action: "qms-send-current-url-from-popup", recipientIds });
  window.close();
});

document.getElementById("sendAllTabsBtn").addEventListener("click", async () => {
  const recipientIds = getSelectedRecipientIdsOrWarn();
  if (!recipientIds) return;
  await chrome.runtime.sendMessage({ action: "qms-send-all-tabs-from-popup", recipientIds });
  window.close();
});

document.getElementById("screenshotFullBtn").addEventListener("click", async () => {
  const recipientIds = getSelectedRecipientIdsOrWarn();
  if (!recipientIds) return;
  setStatus(t("statusScreenshotting"));
  const res = await chrome.runtime.sendMessage({ action: "qms-capture-full-active-tab", recipientIds });
  setStatus(res?.ok ? t("statusScreenshotDone") : t("statusFailed"), !res?.ok);
});

document.getElementById("screenshotPartialBtn").addEventListener("click", async () => {
  const recipientIds = getSelectedRecipientIdsOrWarn();
  if (!recipientIds) return;
  setStatus(t("statusPartialHint"));
  await chrome.runtime.sendMessage({ action: "qms-start-partial-from-popup", recipientIds });
  window.close();
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("historyBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  // options.js 側でhashを見て履歴タブを開く
  setTimeout(() => {
    chrome.storage.local.set({ __openHistoryTab: true });
  }, 50);
});

function updateThemeIcon(theme) {
  const icons = { auto: "🌓", light: "☀️", dark: "🌙" };
  themeToggle.textContent = icons[theme] || "🌓";
}

themeToggle.addEventListener("click", async () => {
  const current = document.documentElement.getAttribute("data-theme") || "auto";
  const next = cycleThemeOrder(current);
  await setTheme(next);
  updateThemeIcon(next);
});

// 音声入力
// ※ ツールバーのポップアップはフォーカスを失うと自動で閉じる仕様のため、
//   マイクの使用許可ダイアログが出た瞬間に閉じてしまい「not-allowed」エラーになります。
//   そのため音声入力は専用の独立ウィンドウで行います。
micBtn.addEventListener("click", () => {
  chrome.windows.create({
    url: chrome.runtime.getURL("voice.html"),
    type: "popup",
    width: 420,
    height: 480
  });
  window.close();
});

init();
