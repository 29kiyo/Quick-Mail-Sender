// picker.js - 送信先選択ウィンドウ（複数選択・一回限り対応）

async function init() {
  await loadI18n();
  await applyTheme();
  applyI18nToPage();

  await refreshOnetimeSenderAccountOptions();
  const onetimeTypeSelect = document.getElementById("onetimeType");
  const onetimeSenderRow = document.getElementById("onetimeSenderRow");
  const syncSenderRow = () => onetimeSenderRow.classList.toggle("hidden", onetimeTypeSelect.value !== "gmail");
  onetimeTypeSelect.addEventListener("change", syncSenderRow);
  syncSenderRow();

  const recipients = await Storage.getRecipients();
  const list = document.getElementById("pickerList");
  const bulkActions = document.getElementById("bulkActions");
  list.innerHTML = "";

  if (recipients.length === 0) {
    list.innerHTML = `<p style="font-size:13px;color:var(--text-soft)">${t("pickerNoRecipients")}</p>`;
  } else {
    recipients.forEach(r => {
      const item = document.createElement("label");
      item.className = "picker-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = r.id;
      cb.dataset.recipientType = r.type; // gas/make自動送信の警告表示判定に使う
      // チェックボックスの変化があるたびにボタン表記を更新
      cb.addEventListener("change", syncBulkUI);

      const info = document.createElement("div");
      info.className = "info";
      const typeLabel = { standard: t("typeStandard"), gmail: t("typeGmail"), other: t("typeOther"), gas: t("typeGas"), make: t("typeMake") };
      info.innerHTML = `
        <div class="name">${escapeHtml(r.name)}${r.isDefault ? " ★" : ""}</div>
        <div class="meta">${escapeHtml(r.email)} ・ ${typeLabel[r.type] || r.type}</div>
      `;

      item.appendChild(cb);
      item.appendChild(info);
      list.appendChild(item);
    });

    // 1件だけの場合は即送信（ただしGAS/Make自動送信は実際にメールが飛んでしまうため、
    // 誤操作防止のため必ずユーザーのクリックを挟む＝自動確定させない）
    const isAutoChannelOnly = recipients.length === 1 && (recipients[0].type === "gas" || recipients[0].type === "make");

    if (recipients.length === 1 && !isAutoChannelOnly) {
      const cb = list.querySelector("input[type=checkbox]");
      cb.checked = true;
      await sendToSelected();
      return;
    }

    if (recipients.length > 1 || isAutoChannelOnly) {
      bulkActions.style.display = "flex";
      if (isAutoChannelOnly) {
        // 選び直す手間は省きつつ、実際の送信はボタンクリックを必須にする
        list.querySelector("input[type=checkbox]").checked = true;
      }
      syncBulkUI(); // 初期状態を反映
    }
  }

  // 設定画面へのボタン
  document.getElementById("openSettingsBtn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // 一括送信ボタン
  document.getElementById("sendSelectedBtn").addEventListener("click", sendToSelected);

  // すべて選択/解除ボタン
  document.getElementById("selectAllBtn").addEventListener("click", () => {
    const checkboxes = list.querySelectorAll("input[type=checkbox]");
    // 「全て選択済み」かどうかで切り替え
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => { cb.checked = !allChecked; });
    syncBulkUI();
  });

  // 一回限り送信
  document.getElementById("onetimeSendBtn").addEventListener("click", async () => {
    const email = document.getElementById("onetimeEmail").value.trim();
    if (!email) { document.getElementById("onetimeEmail").focus(); return; }
    const name = document.getElementById("onetimeName").value.trim();
    const type = document.getElementById("onetimeType").value;
    const senderAccountId = type === "gmail" ? (document.getElementById("onetimeSenderAccount").value || null) : null;
    document.getElementById("onetimeSendBtn").disabled = true;
    await chrome.runtime.sendMessage({ action: "qms-picker-onetime", email, name, type, senderAccountId });
    window.close();
  });
}

// 送信元アカウントのプルダウンを、登録済みのGmail送信元アカウントで再描画する
async function refreshOnetimeSenderAccountOptions() {
  const accounts = await Storage.getSenderAccounts();
  const select = document.getElementById("onetimeSenderAccount");
  const prev = select.value;
  select.innerHTML = `<option value="">${t("recipientSenderAccountDefaultOption")}</option>` +
    accounts.map(a => `<option value="${a.id}">${escapeHtml(a.label)} (u/${a.authuserIndex})</option>`).join("");
  select.value = prev;
}

// チェックボックスの状態に合わせてボタン表記を同期する
function syncBulkUI() {
  const all = document.querySelectorAll("#pickerList input[type=checkbox]");
  const checked = document.querySelectorAll("#pickerList input[type=checkbox]:checked");
  const count = checked.length;
  const total = all.length;

  // 送信ボタン
  const sendBtn = document.getElementById("sendSelectedBtn");
  sendBtn.textContent = count > 1
    ? `${t("pickerSendSelected")} (${count})`
    : t("pickerSendSelected");
  sendBtn.disabled = count === 0;

  // すべて選択/解除ボタン
  const selectAllBtn = document.getElementById("selectAllBtn");
  const allChecked = count === total && total > 0;
  selectAllBtn.textContent = allChecked ? t("pickerDeselectAll") : t("pickerSelectAll");

  // GAS/Make自動送信の宛先が選択されている場合は警告を表示（確認画面なしで即送信されるため）
  const hasAutoChannel = Array.from(checked).some(cb => cb.dataset.recipientType === "gas" || cb.dataset.recipientType === "make");
  document.getElementById("autoSendWarning").classList.toggle("hidden", !hasAutoChannel);
}

async function sendToSelected() {
  const checkboxes = document.querySelectorAll("#pickerList input[type=checkbox]:checked");
  const ids = Array.from(checkboxes).map(cb => cb.value);
  if (ids.length === 0) return;

  document.getElementById("sendSelectedBtn").disabled = true;

  if (ids.length === 1) {
    await chrome.runtime.sendMessage({ action: "qms-picker-selected", recipientId: ids[0] });
  } else {
    await chrome.runtime.sendMessage({ action: "qms-picker-multi", recipientIds: ids });
  }
  window.close();
}

function applyI18nToPage() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (val) el.textContent = val;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    const val = t(key);
    if (val) el.placeholder = val;
  });
  document.querySelectorAll("option[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (val) el.textContent = val;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
