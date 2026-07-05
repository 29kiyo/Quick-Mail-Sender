// options.js

const typeLabels = {
  standard: { ja: "標準メールアプリ", en: "Default mail app" },
  gmail: { ja: "Gmail", en: "Gmail" },
  other: { ja: "その他", en: "Other" },
  gas: { ja: "GAS自動送信", en: "GAS auto-send" },
  make: { ja: "Make.com自動送信", en: "Make.com auto-send" }
};

function getTypeLabel(type) {
  const entry = typeLabels[type];
  if (!entry) return type;
  return entry[_lang] || entry.ja;
}

async function init() {
  await loadI18n();
  applyI18nToPage();
  await renderRecipients();
  await renderHistory();
  await initThemeButtons();
  await initVoiceLang();
  await initUiLang();
  await initUseDefaultDirectly();
  await initGasWebhooks();
  await initMakeWebhooks();
  await initSenderAccounts();
  await refreshRecipientFormSelects();
  initRecipientFormTypeToggle();
  initAutoSendHelpModal();
  initTabs();

  // URLハッシュ (#history, #general, #recipients, #autosend) でタブを復元
  const hash = location.hash.replace("#", "");
  if (["recipients","history","general","autosend"].includes(hash)) {
    selectTab(hash);
  }

  // popupのhistoryボタン経由
  const { __openHistoryTab } = await chrome.storage.local.get(["__openHistoryTab"]);
  if (__openHistoryTab) {
    selectTab("history");
    chrome.storage.local.remove("__openHistoryTab");
  }

  // 履歴リロードボタン
  document.getElementById("reloadHistoryBtn").addEventListener("click", async () => {
    await renderHistory();
  });
}

function applyI18nToPage() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t(key)) el.textContent = t(key);
  });
  // リンク・<code>・<b>等のインラインタグを含む静的な説明文のみに限定して使用する（開発者が用意した固定文言のみ）
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
  document.title = t("optionsTitle");
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });
}

function selectTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${tab}`));
  // URLハッシュにタブを保存 → リロード後も同じタブに戻る
  history.replaceState(null, "", `#${tab}`);
}

async function renderRecipients() {
  const recipients = await Storage.getRecipients();
  const list = document.getElementById("recipientList");
  list.innerHTML = "";
  if (recipients.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("noRecipientsMsg");
    list.appendChild(empty);
    return;
  }

  // Webhook / 送信元アカウントのラベルを一覧に添えるため事前取得しておく
  const [gasWebhooks, makeWebhooks, senderAccounts] = await Promise.all([
    Storage.getAutoSendWebhooks("gas"),
    Storage.getAutoSendWebhooks("make"),
    Storage.getSenderAccounts()
  ]);
  const gasLabelById = Object.fromEntries(gasWebhooks.map(w => [w.id, w.label]));
  const makeLabelById = Object.fromEntries(makeWebhooks.map(w => [w.id, w.label]));
  const senderLabelById = Object.fromEntries(senderAccounts.map(a => [a.id, a.label]));

  recipients.forEach(r => {
    const item = document.createElement("div");
    item.className = "recipient-item";

    let extraLabel = "";
    if (r.type === "gas" && gasLabelById[r.webhookId]) extraLabel = ` → ${escapeHtml(gasLabelById[r.webhookId])}`;
    else if (r.type === "make" && makeLabelById[r.webhookId]) extraLabel = ` → ${escapeHtml(makeLabelById[r.webhookId])}`;
    else if (r.type === "gmail" && senderLabelById[r.senderAccountId]) extraLabel = ` → ${escapeHtml(senderLabelById[r.senderAccountId])}`;

    const info = document.createElement("div");
    info.className = "recipient-info";
    info.innerHTML = `
      <span class="name">${r.isDefault ? "★ " : ""}${escapeHtml(r.name)}</span>
      <span class="meta">${escapeHtml(r.email)} ・ ${getTypeLabel(r.type)}${extraLabel}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "recipient-actions";

    const defaultBtn = document.createElement("button");
    defaultBtn.textContent = r.isDefault ? t("btnUnsetDefault") : t("btnSetDefault");
    defaultBtn.addEventListener("click", async () => {
      const all = await Storage.getRecipients();
      let updated;
      if (r.isDefault) {
        updated = all.map(x => (x.id === r.id ? { ...x, isDefault: false } : x));
      } else {
        updated = all.map(x => ({ ...x, isDefault: x.id === r.id }));
      }
      await Storage.saveRecipients(updated);
      await renderRecipients();
    });

    const editBtn = document.createElement("button");
    editBtn.textContent = t("btnEdit");
    editBtn.className = "primary-action";
    editBtn.addEventListener("click", () => startEditRecipient(r));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = t("btnDelete");
    deleteBtn.className = "danger";
    deleteBtn.addEventListener("click", async () => {
      if (confirm(`「${r.name}」${t("confirmDelete")}`)) {
        await Storage.deleteRecipient(r.id);
        if (document.getElementById("formEditingId").value === r.id) {
          cancelEditRecipient();
        }
        await renderRecipients();
      }
    });

    actions.appendChild(defaultBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

// formTypeの選択値に応じて、この送信先が持つべき追加フィールド（webhookId / senderAccountId）を返す
function getRecipientTypeExtraFields(type) {
  if (type === "gas") return { webhookId: document.getElementById("formGasWebhook").value || null, senderAccountId: null };
  if (type === "make") return { webhookId: document.getElementById("formMakeWebhook").value || null, senderAccountId: null };
  if (type === "gmail") return { webhookId: null, senderAccountId: document.getElementById("formGmailSender").value || null };
  return { webhookId: null, senderAccountId: null };
}

document.getElementById("recipientForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const editingId = document.getElementById("formEditingId").value;
  const name = document.getElementById("formName").value.trim();
  const email = document.getElementById("formEmail").value.trim();
  const type = document.getElementById("formType").value;
  const isDefault = document.getElementById("formDefault").checked;
  const extra = getRecipientTypeExtraFields(type);

  if (!name || !email) return;

  const recipients = await Storage.getRecipients();

  if (editingId) {
    // 編集モード: 既存の送信先を更新
    let updated = recipients;
    if (isDefault) {
      updated = recipients.map(r => ({ ...r, isDefault: r.id === editingId }));
      await Storage.saveRecipients(updated);
    }
    await Storage.updateRecipient(editingId, { name, email, type, isDefault, ...extra });
    cancelEditRecipient();
  } else {
    // 新規追加モード
    let updated = recipients;
    if (isDefault) {
      updated = recipients.map(r => ({ ...r, isDefault: false }));
      await Storage.saveRecipients(updated);
    }
    await Storage.addRecipient({
      name,
      email,
      type,
      isDefault: isDefault,
      ...extra
    });
    document.getElementById("recipientForm").reset();
    onRecipientFormTypeChange();
  }

  await renderRecipients();
});

function startEditRecipient(r) {
  document.getElementById("formEditingId").value = r.id;
  document.getElementById("formName").value = r.name;
  document.getElementById("formEmail").value = r.email;
  document.getElementById("formType").value = r.type;
  document.getElementById("formDefault").checked = !!r.isDefault;
  document.getElementById("formTitle").textContent =
    _lang === "en" ? `Edit "${r.name}"` : `「${r.name}」を編集`;
  document.getElementById("formSubmitBtn").textContent = t("formSubmitUpdate");
  document.getElementById("formCancelBtn").textContent = t("formCancelEdit");
  document.getElementById("formCancelBtn").classList.remove("hidden");
  onRecipientFormTypeChange();
  if (r.type === "gas") document.getElementById("formGasWebhook").value = r.webhookId || "";
  if (r.type === "make") document.getElementById("formMakeWebhook").value = r.webhookId || "";
  if (r.type === "gmail") document.getElementById("formGmailSender").value = r.senderAccountId || "";
  document.getElementById("recipientForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditRecipient() {
  document.getElementById("formEditingId").value = "";
  document.getElementById("recipientForm").reset();
  document.getElementById("formTitle").textContent = t("formTitleAdd");
  document.getElementById("formSubmitBtn").textContent = t("formSubmitAdd");
  document.getElementById("formCancelBtn").classList.add("hidden");
  onRecipientFormTypeChange();
}

document.getElementById("formCancelBtn").addEventListener("click", cancelEditRecipient);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getHistoryTypeLabel(type) {
  const labels = {
    text:       { ja: "テキスト",         en: "Text" },
    url:        { ja: "ページURL",        en: "Page URL" },
    tabs:       { ja: "全タブURL",        en: "All tab URLs" },
    image:      { ja: "画像URL",          en: "Image URL" },
    screenshot: { ja: "スクリーンショット", en: "Screenshot" }
  };
  return labels[type]?.[_lang] || labels[type]?.ja || type;
}

async function renderHistory() {
  const history = await Storage.getHistory();
  const list = document.getElementById("historyList");
  list.innerHTML = "";
  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("noHistoryMsg");
    list.appendChild(empty);
    return;
  }
  history.forEach(h => {
    const item = document.createElement("div");
    item.className = "history-item";
    const locale = _lang === "en" ? "en-US" : "ja-JP";
    const date = new Date(h.ts).toLocaleString(locale);
    item.innerHTML = `
      <div class="top-row">
        <span>${getHistoryTypeLabel(h.type)} → ${escapeHtml(h.recipientName || "")} &lt;${escapeHtml(h.recipientEmail || "")}&gt;</span>
        <span class="top-row-right">
          <span class="history-date">${date}</span>
          <button class="history-delete-btn">${t("historyDeleteBtn")}</button>
        </span>
      </div>
      <div class="preview"></div>
    `;
    item.querySelector(".preview").textContent = h.preview || "";
    item.querySelector(".history-delete-btn").addEventListener("click", async () => {
      await Storage.deleteHistoryEntry(h.id);
      await renderHistory();
    });
    list.appendChild(item);
  });
}

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  if (confirm(t("confirmClearHistory"))) {
    await Storage.clearHistory();
    await renderHistory();
  }
});

async function initThemeButtons() {
  const theme = await applyTheme();
  updateThemeButtons(theme);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await setTheme(btn.dataset.themeBtn);
      updateThemeButtons(btn.dataset.themeBtn);
    });
  });
}

function updateThemeButtons(theme) {
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.themeBtn === theme);
  });
}

async function initVoiceLang() {
  const settings = await Storage.getSettings();
  const sel = document.getElementById("voiceLangSelect");
  // "auto"はブラウザ言語から自動検出
  sel.value = settings.voiceLang || "auto";
  sel.addEventListener("change", async () => {
    await Storage.saveSettings({ voiceLang: sel.value });
  });
}

async function initUiLang() {
  const settings = await Storage.getSettings();
  const sel = document.getElementById("uiLangSelect");
  sel.value = settings.uiLang || "auto";
  sel.addEventListener("change", async () => {
    await Storage.saveSettings({ uiLang: sel.value });
    window.location.reload();
  });
}

async function initUseDefaultDirectly() {
  const settings = await Storage.getSettings();
  const cb = document.getElementById("useDefaultDirectly");
  if (!cb) return;
  cb.checked = settings.useDefaultDirectly === true; // デフォルトfalse
  cb.addEventListener("change", async () => {
    await Storage.saveSettings({ useDefaultDirectly: cb.checked });
  });
}

// ---- 自動送信連携（GAS / Make.com） 複数Webhook対応 ----
// 権限をランタイムでリクエストしてから保存する
async function requestOriginPermission(origins) {
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

function webhookTypeLabel(type) {
  return type === "gas" ? "GAS" : "Make.com";
}

async function renderWebhookList(type) {
  const listEl = document.getElementById(type === "gas" ? "gasWebhookList" : "makeWebhookList");
  const webhooks = await Storage.getAutoSendWebhooks(type);
  listEl.innerHTML = "";

  if (webhooks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("webhookListEmptyMsg");
    listEl.appendChild(empty);
    return;
  }

  webhooks.forEach(w => {
    const item = document.createElement("div");
    item.className = "recipient-item";

    const info = document.createElement("div");
    info.className = "recipient-info";
    info.innerHTML = `
      <span class="name">${escapeHtml(w.label || webhookTypeLabel(type))}</span>
      <span class="meta">${w.enabled ? "✅" : "⏸️"} ${escapeHtml(w.url || "")}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "recipient-actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = t("btnEdit");
    editBtn.className = "primary-action";
    editBtn.addEventListener("click", () => startEditWebhook(type, w));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = t("btnDelete");
    deleteBtn.className = "danger";
    deleteBtn.addEventListener("click", async () => {
      if (confirm(`「${w.label || webhookTypeLabel(type)}」${t("webhookConfirmDelete")}`)) {
        await Storage.deleteAutoSendWebhook(type, w.id);
        const editingIdEl = document.getElementById(type === "gas" ? "gasWebhookEditingId" : "makeWebhookEditingId");
        if (editingIdEl.value === w.id) cancelEditWebhook(type);
        await renderWebhookList(type);
        await refreshRecipientFormSelects();
        await renderRecipients(); // webhookId解除された可能性があるので表示を更新
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(info);
    item.appendChild(actions);
    listEl.appendChild(item);
  });
}

function startEditWebhook(type, w) {
  const prefix = type === "gas" ? "gas" : "make";
  document.getElementById(`${prefix}WebhookEditingId`).value = w.id;
  document.getElementById(`${prefix}WebhookLabel`).value = w.label || "";
  document.getElementById(`${prefix}Url`).value = w.url || "";
  if (type === "gas") document.getElementById("gasSecret").value = w.secret || "";
  document.getElementById(`${prefix}Enabled`).checked = !!w.enabled;
  document.getElementById(`${prefix}WebhookFormTitle`).textContent =
    _lang === "en" ? `Edit "${w.label || webhookTypeLabel(type)}"` : `「${w.label || webhookTypeLabel(type)}」を編集`;
  document.getElementById(`${prefix}WebhookSubmitBtn`).textContent = t("formSubmitUpdate");
  document.getElementById(`${prefix}WebhookCancelBtn`).classList.remove("hidden");
  document.getElementById(`${prefix}WebhookForm`).scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditWebhook(type) {
  const prefix = type === "gas" ? "gas" : "make";
  document.getElementById(`${prefix}WebhookEditingId`).value = "";
  document.getElementById(`${prefix}WebhookForm`).reset();
  document.getElementById(`${prefix}Enabled`).checked = true;
  document.getElementById(`${prefix}WebhookFormTitle`).textContent = t(type === "gas" ? "webhookAddNewGasHeading" : "webhookAddNewMakeHeading");
  document.getElementById(`${prefix}WebhookSubmitBtn`).textContent = t("formSubmitAdd");
  document.getElementById(`${prefix}WebhookCancelBtn`).classList.add("hidden");
}

async function initGasWebhooks() {
  await renderWebhookList("gas");
  document.getElementById("gasWebhookCancelBtn").addEventListener("click", () => cancelEditWebhook("gas"));
  document.getElementById("gasWebhookForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const editingId = document.getElementById("gasWebhookEditingId").value;
    const label = document.getElementById("gasWebhookLabel").value.trim();
    const url = document.getElementById("gasUrl").value.trim();
    const secret = document.getElementById("gasSecret").value.trim();
    const enabled = document.getElementById("gasEnabled").checked;
    if (!label || !url) return;

    if (enabled) {
      const granted = await requestOriginPermission(["https://script.google.com/*"]);
      if (!granted) {
        alert(t("autoSendPermissionDeniedMsg"));
        return;
      }
    }

    await Storage.saveAutoSendWebhook("gas", { id: editingId || undefined, label, url, secret, enabled });
    cancelEditWebhook("gas");
    await renderWebhookList("gas");
    await refreshRecipientFormSelects();
  });
}

async function initMakeWebhooks() {
  await renderWebhookList("make");
  document.getElementById("makeWebhookCancelBtn").addEventListener("click", () => cancelEditWebhook("make"));
  document.getElementById("makeWebhookForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const editingId = document.getElementById("makeWebhookEditingId").value;
    const label = document.getElementById("makeWebhookLabel").value.trim();
    const url = document.getElementById("makeUrl").value.trim();
    const enabled = document.getElementById("makeEnabled").checked;
    if (!label || !url) return;

    if (enabled) {
      const granted = await requestOriginPermission(["https://*.make.com/*"]);
      if (!granted) {
        alert(t("autoSendPermissionDeniedMsg"));
        return;
      }
    }

    await Storage.saveAutoSendWebhook("make", { id: editingId || undefined, label, url, enabled });
    cancelEditWebhook("make");
    await renderWebhookList("make");
    await refreshRecipientFormSelects();
  });
}

// ---- Gmail送信元アカウントの管理 ----
async function renderSenderAccountList() {
  const listEl = document.getElementById("senderAccountList");
  const accounts = await Storage.getSenderAccounts();
  listEl.innerHTML = "";

  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("senderAccountListEmptyMsg");
    listEl.appendChild(empty);
    return;
  }

  accounts.forEach(a => {
    const item = document.createElement("div");
    item.className = "recipient-item";

    const info = document.createElement("div");
    info.className = "recipient-info";
    info.innerHTML = `
      <span class="name">${escapeHtml(a.label)}</span>
      <span class="meta">u/${a.authuserIndex}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "recipient-actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = t("btnEdit");
    editBtn.className = "primary-action";
    editBtn.addEventListener("click", () => startEditSenderAccount(a));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = t("btnDelete");
    deleteBtn.className = "danger";
    deleteBtn.addEventListener("click", async () => {
      if (confirm(`「${a.label}」${t("senderAccountConfirmDelete")}`)) {
        await Storage.deleteSenderAccount(a.id);
        if (document.getElementById("senderAccountEditingId").value === a.id) cancelEditSenderAccount();
        await renderSenderAccountList();
        await refreshRecipientFormSelects();
        await renderRecipients();
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(info);
    item.appendChild(actions);
    listEl.appendChild(item);
  });
}

function startEditSenderAccount(a) {
  document.getElementById("senderAccountEditingId").value = a.id;
  document.getElementById("senderAccountLabel").value = a.label || "";
  document.getElementById("senderAccountIndex").value = a.authuserIndex;
  document.getElementById("senderAccountSubmitBtn").textContent = t("formSubmitUpdate");
  document.getElementById("senderAccountCancelBtn").classList.remove("hidden");
  document.getElementById("senderAccountForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditSenderAccount() {
  document.getElementById("senderAccountEditingId").value = "";
  document.getElementById("senderAccountForm").reset();
  document.getElementById("senderAccountIndex").value = 0;
  document.getElementById("senderAccountSubmitBtn").textContent = t("formSubmitAdd");
  document.getElementById("senderAccountCancelBtn").classList.add("hidden");
}

async function initSenderAccounts() {
  await renderSenderAccountList();
  document.getElementById("senderAccountCancelBtn").addEventListener("click", cancelEditSenderAccount);
  document.getElementById("senderAccountForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const editingId = document.getElementById("senderAccountEditingId").value;
    const label = document.getElementById("senderAccountLabel").value.trim();
    const authuserIndex = parseInt(document.getElementById("senderAccountIndex").value, 10);
    if (!label || Number.isNaN(authuserIndex) || authuserIndex < 0) return;

    await Storage.saveSenderAccount({ id: editingId || undefined, label, authuserIndex });
    cancelEditSenderAccount();
    await renderSenderAccountList();
    await refreshRecipientFormSelects();
  });
}

// ---- 送信先フォーム: 種類に応じたWebhook/送信元アカウント選択欄の表示切り替え ----
function initRecipientFormTypeToggle() {
  document.getElementById("formType").addEventListener("change", onRecipientFormTypeChange);
  onRecipientFormTypeChange();
}

function onRecipientFormTypeChange() {
  const type = document.getElementById("formType").value;
  document.getElementById("gasWebhookRow").classList.toggle("hidden", type !== "gas");
  document.getElementById("makeWebhookRow").classList.toggle("hidden", type !== "make");
  document.getElementById("gmailSenderRow").classList.toggle("hidden", type !== "gmail");
}

// 送信先フォーム内の3つのセレクト（GAS Webhook / Make Webhook / Gmail送信元アカウント）を
// 最新の登録内容で再描画する。Webhook/送信元アカウントの追加・編集・削除のたびに呼び出す。
async function refreshRecipientFormSelects() {
  const [gasWebhooks, makeWebhooks, senderAccounts] = await Promise.all([
    Storage.getAutoSendWebhooks("gas"),
    Storage.getAutoSendWebhooks("make"),
    Storage.getSenderAccounts()
  ]);

  const gasSelect = document.getElementById("formGasWebhook");
  const prevGas = gasSelect.value;
  gasSelect.innerHTML = `<option value="">${t("recipientWebhookPlaceholderOption")}</option>` +
    gasWebhooks.map(w => `<option value="${w.id}">${escapeHtml(w.label || "GAS")}</option>`).join("");
  gasSelect.value = prevGas;
  document.getElementById("gasWebhookEmptyHint").classList.toggle("hidden", gasWebhooks.length > 0);

  const makeSelect = document.getElementById("formMakeWebhook");
  const prevMake = makeSelect.value;
  makeSelect.innerHTML = `<option value="">${t("recipientWebhookPlaceholderOption")}</option>` +
    makeWebhooks.map(w => `<option value="${w.id}">${escapeHtml(w.label || "Make.com")}</option>`).join("");
  makeSelect.value = prevMake;
  document.getElementById("makeWebhookEmptyHint").classList.toggle("hidden", makeWebhooks.length > 0);

  const senderSelect = document.getElementById("formGmailSender");
  const prevSender = senderSelect.value;
  senderSelect.innerHTML = `<option value="">${t("recipientSenderAccountDefaultOption")}</option>` +
    senderAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.label)} (u/${a.authuserIndex})</option>`).join("");
  senderSelect.value = prevSender;
}

// ---- 自動送信 設定方法ヘルプ（モーダル） ----
function initAutoSendHelpModal() {
  const overlay = document.getElementById("autoSendHelpOverlay");
  const openBtn = document.getElementById("autoSendHelpBtn");
  const closeBtn = document.getElementById("autoSendHelpCloseBtn");
  if (!overlay || !openBtn) return;

  const open = () => overlay.classList.remove("hidden");
  const close = () => overlay.classList.add("hidden");

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close(); // 背景クリックで閉じる
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });
}

init();
