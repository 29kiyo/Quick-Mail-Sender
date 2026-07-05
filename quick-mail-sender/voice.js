// voice.js - 独立ウィンドウ内での音声入力

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
const recipientChecklist = document.getElementById("recipientChecklist");
const recipientEmptyHint = document.getElementById("recipientEmptyHint");
const recipientAutoSendWarning = document.getElementById("recipientAutoSendWarning");

async function init() {
  await loadI18n();
  await applyTheme();
  applyI18nToPage();
  setStatus(t("voiceStatusReady"));
  await RecipientChecklist.render(recipientChecklist, recipientEmptyHint, recipientAutoSendWarning);
  document.getElementById("recipientEmptyLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  await refreshOneTimeSenderAccountOptions();
  oneTimeType.addEventListener("change", onOneTimeTypeChange);
  onOneTimeTypeChange();

  // 一回限りトグル
  oneTimeToggle.addEventListener("change", () => {
    oneTimeFields.classList.toggle("hidden", !oneTimeToggle.checked);
    recipientChecklist.classList.toggle("hidden", oneTimeToggle.checked);
    if (oneTimeToggle.checked) {
      recipientAutoSendWarning.classList.add("hidden");
    } else {
      RecipientChecklist.syncWarning(recipientChecklist, recipientAutoSendWarning);
    }
  });
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
  document.querySelectorAll("option[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t(key)) el.textContent = t(key);
  });
}

function setStatus(text, isError) {
  statusMsg.textContent = text;
  statusMsg.style.color = isError ? "var(--danger)" : "var(--text-soft)";
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

// senderAccountId から authuserIndex を解決する
async function resolveAuthuserIndexLocal(senderAccountId) {
  if (!senderAccountId) return undefined;
  const accounts = await Storage.getSenderAccounts();
  const acc = accounts.find(a => a.id === senderAccountId);
  return acc ? acc.authuserIndex : undefined;
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
    // 一回限り: background経由ではなく直接mailtoを構築して開く
    let url;
    if (oneTime.type === "gmail") {
      const authuserIndex = await resolveAuthuserIndexLocal(oneTime.senderAccountId);
      const params = new URLSearchParams({ view: "cm", fs: "1", to: oneTime.email, su: subject, body: text });
      const base = (authuserIndex !== null && authuserIndex !== undefined)
        ? `https://mail.google.com/mail/u/${authuserIndex}/`
        : `https://mail.google.com/mail/`;
      url = `${base}?${params}`;
    } else {
      const params = new URLSearchParams();
      params.set("subject", subject);
      params.set("body", text);
      url = `mailto:${encodeURIComponent(oneTime.email)}?${params.toString().replace(/\+/g, "%20")}`;
    }
    await chrome.tabs.create({ url });
    setStatus(t("statusOpenedOnetime"));
    setTimeout(() => window.close(), 1200);
    return;
  }

  const recipientIds = getSelectedRecipientIdsOrWarn();
  if (!recipientIds) return;

  await chrome.runtime.sendMessage({ action: "qms-send-freetext", body: text, subject, recipientIds });
  setTimeout(() => window.close(), 300);
});

let recognition = null;
let recording = false;

function getSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return SR ? new SR() : null;
}

async function startRecognition() {
  recognition = getSpeechRecognition();
  if (!recognition) {
    setStatus(t("statusVoiceNotSupported"), true);
    return;
  }
  const settings = await Storage.getSettings();
  const rawLang = settings.voiceLang || "auto";
  recognition.lang = rawLang === "auto" ? detectVoiceLang() : rawLang;
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    recording = true;
    micBtn.classList.add("recording");
    setStatus(t("statusVoiceStart"));
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed") {
      setStatus(t("voiceNotAllowed"), true);
    } else if (e.error === "no-speech") {
      setStatus(t("voiceNoSpeech"), true);
    } else {
      setStatus(`${t("statusVoiceError")} ${e.error}`, true);
    }
  };
  recognition.onend = () => {
    recording = false;
    micBtn.classList.remove("recording");
  };
  recognition.onresult = (event) => {
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      }
    }
    if (finalText) {
      bodyText.value = (bodyText.value ? bodyText.value + "\n" : "") + finalText;
    }
  };

  try {
    recognition.start();
  } catch (e) {
    setStatus(`${t("statusVoiceFailed")}: ${e.message}`, true);
  }
}

micBtn.addEventListener("click", () => {
  if (recording) {
    recognition?.stop();
  } else {
    startRecognition();
  }
});

init();
