// lib/common.js - 共有ユーティリティ（storage.js + theme.js + i18n.js を統合）
// background.js（importScripts）、options/popup/picker/voice の各ページから共通で読み込む
// 内部は3セクション: [1] ストレージ操作 (Storage) / [2] テーマ適用 (applyTheme等) / [3] 多言語対応 (i18n)

// ============================================================
// [1] ストレージ操作 (旧 storage.js)
// ============================================================

const DEFAULT_SETTINGS = {
  theme: "auto",
  lastRecipientId: null,
  voiceLang: "auto",
  uiLang: "auto",
  useDefaultDirectly: false, // 既定の送信先がある場合も右クリック時に選択画面を出す
  // 自動送信連携（ユーザー自身のGAS/Makeアカウントを使用）。
  // v2: 複数のWebhookを登録できるよう配列形式に変更（旧: 単一オブジェクト形式）。
  // 送信先(recipient)側は webhookId でどのWebhookを使うか個別に指定する。
  autoSend: {
    gas: [],  // [{ id, label, url, secret, enabled }]
    make: []  // [{ id, label, url, enabled }]
  },
  // Gmail送信元アカウント（複数のGoogleアカウントを使い分ける場合に使用）
  // [{ id, label, authuserIndex }] - authuserIndexはmail.google.com/mail/u/{N}/ のNに対応
  senderAccounts: []
};

// ============================================================
// 旧データ形式からの移行（v2: Webhook複数登録対応）
// 既存のGAS/Make設定・送信先の紐付けはそのまま維持する。
// ============================================================
let _migrateWebhooksPromise = null;
function ensureWebhooksMigrated() {
  if (!_migrateWebhooksPromise) _migrateWebhooksPromise = migrateWebhooksIfNeeded();
  return _migrateWebhooksPromise;
}

async function migrateWebhooksIfNeeded() {
  const data = await chrome.storage.local.get(["recipients", "settings", "__qmsMigratedWebhooksV2"]);
  if (data.__qmsMigratedWebhooksV2) return;

  let settings = data.settings || {};
  let recipients = data.recipients || [];
  const oldAutoSend = settings.autoSend;
  const isOldShape = !!(oldAutoSend && oldAutoSend.gas && !Array.isArray(oldAutoSend.gas));

  if (isOldShape) {
    const oldGas = oldAutoSend.gas || {};
    const oldMake = oldAutoSend.make || {};
    const gasArray = (oldGas.url || oldGas.enabled)
      ? [{ id: crypto.randomUUID(), label: "GAS", url: oldGas.url || "", secret: oldGas.secret || "", enabled: !!oldGas.enabled }]
      : [];
    const makeArray = (oldMake.url || oldMake.enabled)
      ? [{ id: crypto.randomUUID(), label: "Make.com", url: oldMake.url || "", enabled: !!oldMake.enabled }]
      : [];
    const gasId = gasArray[0]?.id || null;
    const makeId = makeArray[0]?.id || null;

    // 既存のGAS/Make宛先は、これまで通り唯一のWebhookを使い続けるよう自動で紐付ける
    recipients = recipients.map(r => {
      if (r.type === "gas" && !r.webhookId) return { ...r, webhookId: gasId };
      if (r.type === "make" && !r.webhookId) return { ...r, webhookId: makeId };
      return r;
    });
    settings = { ...settings, autoSend: { gas: gasArray, make: makeArray } };
  } else if (!oldAutoSend) {
    settings = { ...settings, autoSend: { gas: [], make: [] } };
  }

  await chrome.storage.local.set({ settings, recipients, __qmsMigratedWebhooksV2: true });
}

const Storage = {
  async getAll() {
    await ensureWebhooksMigrated();
    const data = await chrome.storage.local.get(["recipients", "history", "settings"]);
    return {
      recipients: data.recipients || [],
      history: data.history || [],
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
    };
  },

  async getRecipients() {
    await ensureWebhooksMigrated();
    const { recipients } = await chrome.storage.local.get(["recipients"]);
    return recipients || [];
  },

  async saveRecipients(recipients) {
    await chrome.storage.local.set({ recipients });
  },

  async addRecipient(recipient) {
    const recipients = await this.getRecipients();
    recipient.id = recipient.id || crypto.randomUUID();
    recipients.push(recipient);
    await this.saveRecipients(recipients);
    return recipient;
  },

  async updateRecipient(id, patch) {
    const recipients = await this.getRecipients();
    const idx = recipients.findIndex(r => r.id === id);
    if (idx >= 0) {
      recipients[idx] = { ...recipients[idx], ...patch };
      await this.saveRecipients(recipients);
    }
    return recipients;
  },

  async deleteRecipient(id) {
    const recipients = await this.getRecipients();
    const filtered = recipients.filter(r => r.id !== id);
    await this.saveRecipients(filtered);
    return filtered;
  },

  async getSettings() {
    await ensureWebhooksMigrated();
    const { settings } = await chrome.storage.local.get(["settings"]);
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  },

  async saveSettings(patch) {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
  },

  // ---- 自動送信Webhookの複数登録（GAS / Make.com） ----
  async getAutoSendWebhooks(type) {
    const settings = await this.getSettings();
    const key = type === "gas" ? "gas" : "make";
    return (settings.autoSend && settings.autoSend[key]) || [];
  },

  async getAutoSendWebhookById(type, id) {
    if (!id) return null;
    const list = await this.getAutoSendWebhooks(type);
    return list.find(w => w.id === id) || null;
  },

  async saveAutoSendWebhook(type, webhook) {
    const key = type === "gas" ? "gas" : "make";
    const settings = await this.getSettings();
    const list = [...((settings.autoSend && settings.autoSend[key]) || [])];
    webhook = { ...webhook, id: webhook.id || crypto.randomUUID() };
    const idx = list.findIndex(w => w.id === webhook.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...webhook };
    else list.push(webhook);
    const nextAutoSend = { ...(settings.autoSend || { gas: [], make: [] }), [key]: list };
    await this.saveSettings({ autoSend: nextAutoSend });
    return webhook;
  },

  async deleteAutoSendWebhook(type, id) {
    const key = type === "gas" ? "gas" : "make";
    const settings = await this.getSettings();
    const list = ((settings.autoSend && settings.autoSend[key]) || []).filter(w => w.id !== id);
    const nextAutoSend = { ...(settings.autoSend || { gas: [], make: [] }), [key]: list };
    await this.saveSettings({ autoSend: nextAutoSend });
    // このWebhookを参照していた送信先の紐付けを解除する（登録先が消えているまま残さないため）
    const recipients = await this.getRecipients();
    const updated = recipients.map(r => (r.webhookId === id ? { ...r, webhookId: null } : r));
    await this.saveRecipients(updated);
  },

  // ---- Gmail送信元アカウント（自分のメールアドレスの使い分け） ----
  async getSenderAccounts() {
    const settings = await this.getSettings();
    return settings.senderAccounts || [];
  },

  async saveSenderAccount(account) {
    const settings = await this.getSettings();
    const list = [...(settings.senderAccounts || [])];
    account = { ...account, id: account.id || crypto.randomUUID() };
    const idx = list.findIndex(a => a.id === account.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...account };
    else list.push(account);
    await this.saveSettings({ senderAccounts: list });
    return account;
  },

  async deleteSenderAccount(id) {
    const settings = await this.getSettings();
    const list = (settings.senderAccounts || []).filter(a => a.id !== id);
    await this.saveSettings({ senderAccounts: list });
    const recipients = await this.getRecipients();
    const updated = recipients.map(r => (r.senderAccountId === id ? { ...r, senderAccountId: null } : r));
    await this.saveRecipients(updated);
  },

  async getHistory() {
    const { history } = await chrome.storage.local.get(["history"]);
    return history || [];
  },

  async addHistory(entry) {
    const history = await this.getHistory();
    entry.id = crypto.randomUUID();
    entry.ts = Date.now();
    history.unshift(entry);
    // 上限300件
    const trimmed = history.slice(0, 300);
    await chrome.storage.local.set({ history: trimmed });
    return entry;
  },

  async clearHistory() {
    await chrome.storage.local.set({ history: [] });
  },

  async deleteHistoryEntry(id) {
    const history = await this.getHistory();
    const filtered = history.filter(h => h.id !== id);
    await chrome.storage.local.set({ history: filtered });
    return filtered;
  }
};

// 複数選択チェックリストの共通UI描画・状態取得ヘルパー
// popup.html（自由入力・URL・全タブ・スクショ）と voice.html（音声入力）の両方から共用する。
// 右クリック等（インラインUIを持たない文脈）は引き続き picker.html の別窓を使う。
const RecipientChecklist = {
  async render(containerEl, emptyHintEl, warningEl) {
    if (!containerEl) return;
    const recipients = await Storage.getRecipients();
    containerEl.innerHTML = "";

    if (recipients.length === 0) {
      emptyHintEl?.classList.remove("hidden");
      warningEl?.classList.add("hidden");
      return;
    }
    emptyHintEl?.classList.add("hidden");

    const typeLabel = {
      standard: t("typeStandard"), gmail: t("typeGmail"), other: t("typeOther"),
      gas: t("typeGas"), make: t("typeMake")
    };

    // Webhook / 送信元アカウントのラベルを表示に添えるため事前取得しておく
    const [gasWebhooks, makeWebhooks, senderAccounts] = await Promise.all([
      Storage.getAutoSendWebhooks("gas"),
      Storage.getAutoSendWebhooks("make"),
      Storage.getSenderAccounts()
    ]);
    const gasLabelById = Object.fromEntries(gasWebhooks.map(w => [w.id, w.label]));
    const makeLabelById = Object.fromEntries(makeWebhooks.map(w => [w.id, w.label]));
    const senderLabelById = Object.fromEntries(senderAccounts.map(a => [a.id, a.label]));

    recipients.forEach(r => {
      const row = document.createElement("label");
      row.className = "recipient-check-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = r.id;
      cb.dataset.recipientType = r.type;
      if (r.isDefault) cb.checked = true;
      cb.addEventListener("change", () => this.syncWarning(containerEl, warningEl));

      const nameSpan = document.createElement("span");
      nameSpan.textContent = r.name;

      let extraLabel = "";
      if (r.type === "gas" && gasLabelById[r.webhookId]) extraLabel = ` (${gasLabelById[r.webhookId]})`;
      else if (r.type === "make" && makeLabelById[r.webhookId]) extraLabel = ` (${makeLabelById[r.webhookId]})`;
      else if (r.type === "gmail" && senderLabelById[r.senderAccountId]) extraLabel = ` (${senderLabelById[r.senderAccountId]})`;

      const metaSpan = document.createElement("span");
      metaSpan.className = "meta";
      metaSpan.textContent = `<${r.email}> \u30fb ${typeLabel[r.type] || r.type}${extraLabel}`;

      row.appendChild(cb);
      row.appendChild(nameSpan);
      row.appendChild(metaSpan);

      if (r.isDefault) {
        const badge = document.createElement("span");
        badge.className = "default-badge";
        badge.textContent = t("defaultBadgeLabel");
        row.appendChild(badge);
      }

      containerEl.appendChild(row);
    });

    this.syncWarning(containerEl, warningEl);
  },

  // GAS/Make自動送信の宛先が選択されている場合は警告を表示（確認画面なしで即送信されるため）
  syncWarning(containerEl, warningEl) {
    if (!warningEl) return;
    const checked = containerEl.querySelectorAll("input[type=checkbox]:checked");
    const hasAutoChannel = Array.from(checked).some(
      cb => cb.dataset.recipientType === "gas" || cb.dataset.recipientType === "make"
    );
    warningEl.classList.toggle("hidden", !hasAutoChannel);
  },

  getCheckedIds(containerEl) {
    if (!containerEl) return [];
    return Array.from(containerEl.querySelectorAll("input[type=checkbox]:checked")).map(cb => cb.value);
  }
};

// mailto: URL生成（標準メールアプリ / Gmail Web / その他Webメール 共通）
function buildMailto({ to, subject, body }) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(to || "")}?${query}`;
}

// Gmailのweb作成画面URL（mailto非対応環境向けの代替。手動送信は変わらず必要）
// authuserIndex: 複数のGoogleアカウントでログインしている場合に、どのアカウントの
// Gmailを開くか指定する（mail.google.com/mail/u/{N}/ の {N} 部分）。未指定なら現在の既定アカウント。
function buildGmailWebCompose({ to, subject, body, authuserIndex }) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: to || "",
    su: subject || "",
    body: body || ""
  });
  const base = (authuserIndex !== null && authuserIndex !== undefined && authuserIndex !== "")
    ? `https://mail.google.com/mail/u/${authuserIndex}/`
    : `https://mail.google.com/mail/`;
  return `${base}?${params.toString()}`;
}

if (typeof module !== "undefined") {
  module.exports = { Storage, buildMailto, buildGmailWebCompose, DEFAULT_SETTINGS };
}

// ============================================================
// [2] テーマ適用 (旧 theme.js) - ライト/ダーク/自動テーマ
// ============================================================

async function applyTheme() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const theme = (settings && settings.theme) || "auto";
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

async function setTheme(theme) {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const next = { ...(settings || {}), theme };
  await chrome.storage.local.set({ settings: next });
  document.documentElement.setAttribute("data-theme", theme);
}

function cycleThemeOrder(current) {
  const order = ["auto", "light", "dark"];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

// 注意: ここで自動実行はしない。background.js（Service Worker）は document を持たないため、
// ここで即時実行するとエラーになる。各ページ（options.js/popup.js/picker.js/voice.js）側で
// 自分の初期化処理内から明示的に applyTheme() を呼び出している。

// ============================================================
// [3] 多言語対応 (旧 i18n.js)
// ============================================================
// ブラウザの navigator.language を参照し、en-* なら英語UIを使用

const TRANSLATIONS = {
  ja: {
    // popup
    brandName: "Quick Mail Sender",
    themeToggleTitle: "テーマ切替",
    pinWindowTitle: "ウィンドウとして固定表示（クリックしても消えなくなります）",
    pinWindowActiveTitle: "固定表示ウィンドウで開いています（クリックで閉じます）",
    openOptionsTitle: "設定",
    oneTimeLabel: "一回限りの送信先",
    recipientEmptyHint: '送信先が未登録です。<a href="#" id="recipientEmptyLink">設定画面から追加してください</a>。',
    oneTimeNamePlaceholder: "表示名（任意）",
    oneTimeNameHint: "※ 表示名は相手には表示されません。送信履歴で「誰に送ったか」をあとで確認しやすくするための、自分用のメモです。",
    oneTimeEmailPlaceholder: "メールアドレス",
    bodyPlaceholder: "送信したい内容を入力（音声入力も可）",
    micTitle: "音声入力",
    sendTextBtn: "この内容を送信",
    sendUrlBtn: "現在のページURLを送信",
    sendAllTabsBtn: "全タブのURLを送信",
    screenshotFullBtn: "ページ全体スクショ送信",
    screenshotPartialBtn: "範囲選択スクショ送信",
    historyBtn: "送信履歴",
    typeStandard: "標準メールアプリ（mailto）",
    typeGmail: "Gmail（Web作成画面）",
    typeOther: "その他（mailto）",
    defaultBadgeLabel: "既定",
    // status messages
    statusNoContent: "送信内容を入力してください",
    statusNoRecipient: "一回限りの送信先メールアドレスを入力してください",
    statusNoRecipientRegistered: "送信先が登録されていません。設定画面から追加してください",
    statusOpened: "メール作成画面を開きました",
    statusOpenedOnetime: "メール作成画面を開きました（一回限り）",
    statusFailed: "送信に失敗しました",
    statusUrlSent: "URLを送信しました",
    statusScreenshotting: "スクリーンショットを撮影中...",
    statusScreenshotDone: "スクリーンショットを保存し、メール画面を開きました",
    statusVoiceStart: "音声を認識しています...マイクボタンで停止",
    statusVoiceError: "音声認識エラー:",
    statusVoiceNotSupported: "このブラウザは音声入力に対応していません",
    statusVoiceFailed: "音声入力を開始できませんでした",
    statusPartialHint: "範囲をドラッグして選択してください",
    // options
    optionsTitle: "Quick Mail Sender 設定",
    tabRecipients: "送信先",
    tabHistory: "送信履歴",
    tabGeneral: "その他設定",
    tabTerms: "利用規約",
    recipientsHeading: "送信先一覧",
    recipientsHint: "既定の送信先（★）はワンクリック送信・右クリックメニューで自動的に使用されます。各送信先の「編集」から、既定の解除や種類の変更がいつでもできます。",
    formTitleAdd: "送信先を追加",
    formNameLabel: "表示名",
    formNamePlaceholder: "例: 自分（仕事用）",
    formEmailLabel: "メールアドレス",
    formEmailPlaceholder: "example@gmail.com",
    formTypeLabel: "種類",
    formDefaultLabel: "既定の送信先にする",
    formSubmitAdd: "追加する",
    formSubmitUpdate: "更新する",
    formCancelEdit: "編集をキャンセル",
    btnSetDefault: "既定にする",
    btnUnsetDefault: "★ 既定解除",
    btnEdit: "編集",
    btnDelete: "削除",
    confirmDelete: "を削除しますか？",
    noRecipientsMsg: "まだ送信先が登録されていません。下のフォームから追加してください。",
    historyHeading: "送信履歴",
    clearHistoryBtn: "履歴をすべて削除",
    reloadHistoryBtn: "🔄 再読み込み",
    confirmClearHistory: "送信履歴をすべて削除しますか？",
    noHistoryMsg: "送信履歴はまだありません。",
    historyDeleteBtn: "削除",
    generalHeading: "その他設定",
    voiceLangLabel: "音声入力の言語",
    uiLangLabel: "表示言語",
    uiLangAuto: "ブラウザ設定に合わせる（自動）",
    uiLangJa: "日本語",
    uiLangEn: "English",
    // picker
    pickerTitle: "送信先を選んでください",
    pickerHint: "どの宛先に送るか選択してください。複数選択で一括送信も可能です。",
    pickerAutoSendWarning: "⚠️ この宛先を選ぶと、確認画面なしですぐに自動送信されます。",
    pickerNoRecipients: "登録済みの送信先はありません。下から一回限りの宛先を入力してください。",
    pickerDivider: "または一回限りの宛先を使う",
    pickerSendBtn: "この宛先で送信",
    pickerSendSelected: "選択した宛先に送信",
    pickerSelectAll: "すべて選択",
    pickerDeselectAll: "すべて解除",
    // settings
    useDefaultDirectlyLabel: "既定の送信先がある場合、右クリック送信でそのままそれを使う（選択画面を出さない）",
    // 利用規約
    termsAgreementNote: "本拡張機能を使用した時点で、以下の利用規約に同意したものとみなします。",
    termsPermittedTitle: "✅ 許可される使用",
    termsPerm1: "自分自身のメールアカウントから、自分が同意を得た相手へのメール送信",
    termsPerm2: "業務・個人の正当なコミュニケーション目的での使用",
    termsProhibitedTitle: "🚫 禁止される使用",
    termsProhib1: "スパムメールや迷惑メールの送信",
    termsProhib2: "受信者の同意なしに商業目的のメールを大量送信すること",
    termsProhib3: "フィッシング・詐欺・なりすましを目的とした送信",
    termsProhib4: "ハラスメント・脅迫・差別的内容の送信",
    termsProhib5: "その他、各国の迷惑メール防止法・個人情報保護法などの法令に違反する使用",
    termsDisclaimerTitle: "⚠️ 免責事項",
    termsDisclaim1: "本拡張機能は「現状のまま」提供され、いかなる保証もありません",
    termsDisclaim2: "送信されたメールの内容・結果について、開発者は一切の責任を負いません",
    termsDisclaim3: "本拡張機能はユーザー自身のメールクライアントを介して送信します。メールの実際の送信はGmail・OSのメールアプリ等が行います",
    termsDisclaim4: "基本機能（送信先登録・mailto/Gmail経由の手動送信）において、本拡張機能が外部にデータを収集・送信することはありません。すべての情報はユーザーのブラウザ内にのみ保存されます",
    termsDisclaim5: "「自動送信連携」機能を有効にした場合、送信内容（宛先・件名・本文）はユーザー自身が設定したGoogle Apps ScriptまたはMake.comのURLに送信されます（いずれもユーザー自身のアカウント上で動作し、開発者はその内容を取得しません）",
    termsNote: "本規約に違反する目的での使用を発見した場合、GitHubのIssueにてご報告ください。",
    // voice
    voiceTitle: "音声入力で送信",
    voiceWindowTitle: "Quick Mail Sender - 音声入力",
    voiceHint: "下の🎤ボタンを押すと音声入力が始まります（このウィンドウはフォーカスが外れても閉じないため、マイクの使用許可ダイアログに問題なく応答できます）。初回は「マイクの使用を許可」を選んでください。",
    voiceSendBtn: "この内容を送信",
    voicePlaceholder: "マイクボタンを押して話してください",
    voiceStatusReady: "マイクボタンを押して話してください",
    voiceNotAllowed: "マイクが使用できません。ブラウザのアドレスバー左側のアイコンからマイク許可を確認してください",
    voiceNoSpeech: "音声が検出されませんでした。もう一度お試しください",
    voiceSentClosing: "送信しました。このウィンドウを閉じます...",
    // options header & tabs
    themeLabel: "テーマ:",
    themeAuto: "自動",
    themeLight: "ライト",
    themeDark: "ダーク",
    // options note
    recipientsNote: "※ 「Gmail」を選ぶとGmailのWeb作成画面が開きます。「標準メールアプリ」はOSに設定されている既定のメールアプリが開きます。いずれの方式も、送信ボタンはユーザーご自身で押す必要があります。",
    voiceHintNote: "※ 音声入力はGoogleのオンライン音声認識を利用するため、インターネット接続が必要です。",
    voiceLangAuto: "自動（ブラウザ言語）",
    // right-click menu
    menuSelection: "選択したテキストをメール送信",
    menuPageUrl: "このページのURLをメール送信",
    menuImageUrl: "この画像のURLをメール送信",
    menuAllTabs: "開いている全タブのURLをメール送信",
    menuScreenshotFull: "表示中のページをスクリーンショットして送信",
    menuScreenshotPartial: "選択範囲をスクリーンショットして送信",
    // email subjects
    subjectSelection: "選択テキストの送信",
    subjectPageUrl: "ページURLの送信",
    subjectImageUrl: "画像URLの送信",
    subjectAllTabs: "個のタブのURL", // "{N}個のタブのURL" として使う
    subjectScreenshot: "スクリーンショット送信",
    subjectCustom: "Quick Mail Sender",
    subjectPlaceholder: "件名（未入力の場合は自動設定されます）",
    // notification
    notifTruncatedTitle: "内容が長すぎます",
    notifTruncatedMsg: "メールURLの長さ制限を超えたため、本文を省略しました。全文はダウンロードフォルダのテキストファイルに保存されました。",
    notifTruncatedCopiedMsg: "メールURLの長さ制限を超えたため、本文を省略しました。全文はクリップボードにコピー済みです。本文欄に貼り付け(Ctrl+V)し直してください（念のためテキストファイルも保存しました）。",
    truncatedNotice: "\n\n[内容が長すぎるため省略されました。全文はダウンロードされたテキストファイルを確認してください]",
    noTabClosedMsg: "対象のタブが既に閉じられています。",
    notifScreenshotFailTitle: "スクリーンショットを開始できません",
    notifScreenshotFailMsg: "このページ（拡張機能の管理画面・Chromeウェブストアなど）では範囲選択スクリーンショットを使用できません。通常のWebページでお試しください。",
    screenshotGmailNote: "（GmailのWeb作成画面はURL経由での画像添付に対応していないため、画像の自動添付はできません。お手数ですが、開いた作成画面に手動で添付してください）",
    screenshotMailtoNote: "（mailtoの仕様上、画像の自動添付はできません。お手数ですが、開いたメール作成画面に手動で添付してください）",
    screenshotAutoSendBody: "スクリーンショットを添付して送信しました（Quick Mail Sender 自動送信）",
    screenshotSourcePage: "元ページ:",
    // recipient type (追加)
    typeGas: "GAS自動送信",
    typeMake: "Make.com自動送信",
    // auto-send tab
    tabAutoSend: "自動送信",
    // auto-send (GAS / Make.com)
    autoSendHeading: "自動送信連携（上級者向け）",
    autoSendHint: "Google Apps Script または Make.com を使うと、ご自身のGmail／Makeアカウント経由でボタンひとつで自動送信できます（送信ボタンを押す手間がありません）。いずれもご自身のアカウントで作成したWebアプリ／Webhookを登録するだけで、開発者はこれらの認証情報を一切取得しません。",
    gasEnabledLabel: "GAS自動送信を有効にする",
    gasUrlLabel: "GAS Webアプリ URL",
    gasSecretLabel: "共有シークレット（任意・推奨）",
    autoSendHelpBtn: "📖 設定方法を見る（GAS・Make.com共通）",
    makeEnabledLabel: "Make.com自動送信を有効にする",
    makeUrlLabel: "Make.com Webhook URL",
    btnSave: "保存",
    autoSendSavedMsg: "保存しました",
    autoSendPermissionDeniedMsg: "ブラウザの権限が許可されなかったため有効化できませんでした",
    // auto-send help modal
    autoSendHelpTitle: "自動送信のやり方（GAS・Make.com共通ガイド）",
    autoSendHelpIntro: "どちらも「あなた自身のアカウント」上で動く中継役を用意し、そのURLをQuick Mail Senderに登録する、という考え方は共通です。開発者はこのURLや送信内容を一切取得しません。",
    autoSendHelpGasTitle: "🔧 Google Apps Script (GAS) の場合",
    autoSendHelpGasStep1: '<a href="https://script.google.com/" target="_blank" rel="noopener">script.google.com</a> を開き、「新しいプロジェクト」を作成します',
    autoSendHelpGasStep2: '<a href="https://github.com/29kiyo/Quick-Mail-Sender/blob/main/gas-template/Code.gs" target="_blank" rel="noopener">Code.gsテンプレート（GitHub）</a>の内容をすべてコピーし、プロジェクトに貼り付けます',
    autoSendHelpGasStep3: "コード内の <code>SHARED_SECRET</code> を、自分だけの合言葉に書き換えます（第三者による悪用防止のため）",
    autoSendHelpGasStep4: "右上「デプロイ」→「新しいデプロイ」→ 種類で「ウェブアプリ」を選択します",
    autoSendHelpGasStep5: "「実行するユーザー」を <b>自分</b>、「アクセスできるユーザー」を <b>全員</b> にしてデプロイします",
    autoSendHelpGasStep6: "発行された「ウェブアプリURL」（<code>.../exec</code> で終わるURL）をコピーします",
    autoSendHelpGasStep7: "このページの「自動送信」タブに戻り、GAS Webアプリ URLと、先ほど決めた合言葉（共有シークレット）を入力して保存します",
    autoSendHelpGasScreenshotNote: "スクリーンショットの自動送信もそのまま対応しています。追加設定は不要です。",
    autoSendHelpMakeTitle: "🔧 Make.com の場合",
    autoSendHelpMakeStep1: '<a href="https://www.make.com/en/integrations/email" target="_blank" rel="noopener">Make.com</a> で新しいシナリオを作成し、最初のモジュールに「Webhooks」→「Custom webhook」を選びます',
    autoSendHelpMakeStep2: "「Add」を押してWebhookに好きな名前を付けると、専用のWebhook URLが発行されるのでコピーします",
    autoSendHelpMakeStep3: "発行されたURLをこのページの「自動送信」タブに一時的に貼り付けて保存・有効化し、一度だけ試しに送信してみます（Make.com側にサンプルの形式を覚えさせるためです）",
    autoSendHelpMakeStep4: "左側の「Webhooks」モジュール（Gmail側ではありません）をクリックし、「Redetermine data structure（データ構造を再設定）」を押すと、届いたデータから <code>to</code>・<code>subject</code>・<code>body</code> の3項目が自動的に認識されます。このボタンは一度もテスト送信していないと出てきません（③で送信済みであることが前提です）",
    autoSendHelpMakeStep5: "「＋」で次のモジュールを追加し、Gmailなどのメール送信サービスを検索して「Send an Email（メールを送信）」アクションを選びます",
    autoSendHelpMakeStep6: "Gmailモジュールの「宛先」は、まず「＋ 受取人を追加」を押して入力欄を1つ追加します。追加された欄をクリックすると <code>to</code> が候補として表示されるのでクリックして選びます。「主題」には <code>subject</code>、「内容」には <code>body</code> を同じようにクリックして選べば紐付け完了です。文字を直接入力する必要はありません",
    autoSendHelpMakeStep7: "画面右上のスイッチをONにしてシナリオを保存すれば設定完了です",
    autoSendHelpMakeAttachHeading: "📎 スクリーンショットも自動送信したい場合",
    autoSendHelpMakeStep8: "画像は「実際のファイル」としてアップロードされる形式になっています。まずWebhookモジュールで、スクショを一度試し送信 →「Redetermine data structure（データ構造を再設定）」をやり直してください。すると新しく画像用の項目（<code>attachment</code>や<code>files[]</code>）が認識されます",
    autoSendHelpMakeStep9: "Gmailモジュールの「Attachments」→「Add attachment」で、<strong>File name</strong>には<code>attachment: name</code>（または<code>files[].name</code>）を、<strong>Data</strong>には<code>attachment: data</code>をそれぞれクリックして挿入してください。<code>toBinary</code>などの関数は不要です",
    autoSendHelpMakeGlossaryTitle: "📋 Webhookに届く項目の意味",
    autoSendHelpMakeGlossaryAttachment: "<code>attachment</code>: アップロードされた画像1枚をまとめたデータ（name・mime・dataを含む）",
    autoSendHelpMakeGlossaryName: "<code>attachment: name</code> / <code>files[].name</code>: ファイル名（例: screenshot.png）",
    autoSendHelpMakeGlossaryMime: "<code>attachment: mime</code>: ファイルの種類（例: image/png）。Make側で使わなくても問題ありません",
    autoSendHelpMakeGlossaryData: "<code>attachment: data</code>: 画像の中身そのもの（添付ファイルのData欄に使うのはこれです）",
    autoSendHelpMakeGlossaryFiles: "<code>files[]</code>: アップロードされた全ファイルの一覧。今回は画像1枚だけなので<code>attachment</code>と同じ内容です。名前だけこちらから取ってもOKです",
    autoSendHelpMakeRouterTitle: "⚠️ 添付を設定すると、画像なしのテキスト送信が失敗するようになります",
    autoSendHelpMakeRouterBody: "Gmailモジュールの「File name」「Data」が必須（*）になっているため、スクショ以外の送信では中身が空になり「必須フィールドが空」というエラーで失敗します。Webhookの直後に「Router」を追加し、2つのルートに分けてください：①「attachment: data が空でない」→ 添付ありのGmailモジュールへ　②「attachment: data が空」→ 添付なしの別のGmailモジュール（Attachmentを設定していないもの）へ。",
    autoSendHelpMakeRouterSkipNote: "さらに、分岐した2つのGmailモジュールにはそれぞれ「Flow Control」の「Skip」をエラーハンドラとして付けてください（Gmailモジュールを右クリック→「Add error handler」→「Skip」）。条件に一致しなかった側のルートでエラーが出ても、シナリオ全体を失敗させずにそのルートだけスキップできるようにするためです。",
    autoSendHelpSecurityNote: "⚠️ ウェブアプリURL・WebhookURL・合言葉を知っている人は誰でもあなたのアカウントからメールを送信できてしまいます。他人と共有しないでください。",
    // notifications (auto-send)
    notifAutoSendNotConfiguredTitle: "自動送信が未設定です",
    notifAutoSendNotConfiguredMsg: "設定画面の「自動送信」タブでGAS／Make.comの連携を設定してください。",
    statusAutoSendDoneTitle: "自動送信完了",
    statusAutoSendDoneMsg: "メールを自動送信しました。",
    notifAutoSendFailedTitle: "自動送信に失敗しました",
    notifAutoSendFailedMsg: "自動送信でエラーが発生しました。",
    // Webhook複数登録（v2）
    gasWebhookListHeading: "登録済みのGAS Webhook",
    makeWebhookListHeading: "登録済みのMake.com Webhook",
    webhookLabelLabel: "ラベル（分かりやすい名前）",
    webhookLabelPlaceholder: "例: 自宅用",
    webhookEnabledLabel: "有効にする",
    webhookListEmptyMsg: "まだ登録されていません。下のフォームから追加してください。",
    webhookConfirmDelete: "を削除しますか？（この設定を使っている送信先は「未設定」になります）",
    webhookAddNewGasHeading: "新しいGAS Webhookを追加",
    webhookAddNewMakeHeading: "新しいMake.com Webhookを追加",
    recipientWebhookFieldLabel: "使用するWebhook",
    recipientWebhookPlaceholderOption: "選択してください",
    recipientWebhookEmptyWarning: "先に「自動送信」タブでWebhookを登録してください",
    recipientSenderAccountFieldLabel: "送信元アカウント（任意）",
    recipientSenderAccountDefaultOption: "指定しない（現在のGmailアカウント）",
    // Gmail送信元アカウント管理
    senderAccountsHeading: "🔧 Gmail送信元アカウントの管理（複数のGoogleアカウントを使い分ける場合）",
    senderAccountsHint: "Chromeに複数のGoogleアカウントでログインしている場合に使えます。アカウント番号はGoogleにログインした順（1番目が0、2番目が1…）に対応します。分からない場合は、Gmailを開いて右上のアカウントアイコンの並び順を確認するか、0から順番に試してみてください。ここで登録したアカウントは、送信先の編集画面で「送信元アカウント」として選べるようになります。",
    senderAccountListEmptyMsg: "まだ登録されていません。",
    senderAccountLabelLabel: "ラベル（分かりやすい名前）",
    senderAccountLabelPlaceholder: "例: 仕事用のGmail",
    senderAccountIndexLabel: "アカウント番号（0から開始）",
    senderAccountConfirmDelete: "を削除しますか？"
  },

  en: {
    brandName: "Quick Mail Sender",
    themeToggleTitle: "Toggle theme",
    pinWindowTitle: "Open as a pinned window (won't disappear when you click elsewhere)",
    pinWindowActiveTitle: "Open as a pinned window (click to close)",
    openOptionsTitle: "Settings",
    oneTimeLabel: "One-time recipient",
    recipientEmptyHint: 'No recipients registered yet. <a href="#" id="recipientEmptyLink">Add one in settings</a>.',
    oneTimeNamePlaceholder: "Display name (optional)",
    oneTimeNameHint: "* This name isn't shown to the recipient. It's just a personal note so you can tell who you sent to later, in your send history.",
    oneTimeEmailPlaceholder: "Email address",
    bodyPlaceholder: "Enter content to send (voice input available)",
    micTitle: "Voice input",
    sendTextBtn: "Send this content",
    sendUrlBtn: "Send current page URL",
    sendAllTabsBtn: "Send all tab URLs",
    screenshotFullBtn: "Screenshot & send page",
    screenshotPartialBtn: "Screenshot selection & send",
    historyBtn: "Send history",
    typeStandard: "Default mail app (mailto)",
    typeGmail: "Gmail (web compose)",
    typeOther: "Other (mailto)",
    defaultBadgeLabel: "Default",
    statusNoContent: "Please enter content to send",
    statusNoRecipient: "Please enter a one-time recipient email address",
    statusNoRecipientRegistered: "No recipients registered. Please add one in Settings",
    statusOpened: "Mail compose window opened",
    statusOpenedOnetime: "Mail compose window opened (one-time)",
    statusFailed: "Send failed",
    statusUrlSent: "URL sent",
    statusScreenshotting: "Taking screenshot...",
    statusScreenshotDone: "Screenshot saved, mail compose window opened",
    statusVoiceStart: "Listening... click mic button to stop",
    statusVoiceError: "Speech recognition error:",
    statusVoiceNotSupported: "This browser does not support voice input",
    statusVoiceFailed: "Could not start voice input",
    statusPartialHint: "Drag to select an area",
    optionsTitle: "Quick Mail Sender Settings",
    tabRecipients: "Recipients",
    tabHistory: "Send history",
    tabGeneral: "Other settings",
    tabTerms: "Terms of Use",
    recipientsHeading: "Recipients",
    recipientsHint: "The default recipient (★) is used for one-click and right-click sends. Click \"Edit\" on any recipient to change or remove the default at any time.",
    formTitleAdd: "Add recipient",
    formNameLabel: "Display name",
    formNamePlaceholder: "e.g. Work email",
    formEmailLabel: "Email address",
    formEmailPlaceholder: "example@gmail.com",
    formTypeLabel: "Type",
    formDefaultLabel: "Set as default recipient",
    formSubmitAdd: "Add",
    formSubmitUpdate: "Update",
    formCancelEdit: "Cancel editing",
    btnSetDefault: "Set as default",
    btnUnsetDefault: "★ Remove default",
    btnEdit: "Edit",
    btnDelete: "Delete",
    confirmDelete: "Delete this recipient?",
    noRecipientsMsg: "No recipients yet. Add one using the form below.",
    historyHeading: "Send history",
    clearHistoryBtn: "Clear all history",
    reloadHistoryBtn: "🔄 Reload",
    confirmClearHistory: "Clear all send history?",
    noHistoryMsg: "No send history yet.",
    historyDeleteBtn: "Delete",
    generalHeading: "Other settings",
    voiceLangLabel: "Voice input language",
    uiLangLabel: "Display language",
    uiLangAuto: "Follow browser language (auto)",
    uiLangJa: "日本語",
    uiLangEn: "English",
    pickerTitle: "Choose a recipient",
    pickerHint: "Select who to send to. You can select multiple recipients for bulk sending.",
    pickerAutoSendWarning: "⚠️ Selecting this recipient sends the email immediately, with no confirmation screen.",
    pickerNoRecipients: "No recipients registered. Use the one-time field below.",
    pickerDivider: "or use a one-time address",
    pickerSendBtn: "Send to this address",
    pickerSendSelected: "Send to selected",
    pickerSelectAll: "Select all",
    pickerDeselectAll: "Deselect all",
    useDefaultDirectlyLabel: "When a default recipient is set, use it directly on right-click (skip the picker)",
    // Terms of Use
    termsAgreementNote: "By using this extension, you are deemed to have agreed to the following Terms of Use.",
    termsPermittedTitle: "✅ Permitted Use",
    termsPerm1: "Sending emails from your own account to recipients who have given consent",
    termsPerm2: "Legitimate business or personal communication purposes",
    termsProhibitedTitle: "🚫 Prohibited Use",
    termsProhib1: "Sending spam or unsolicited bulk email",
    termsProhib2: "Sending commercial emails in bulk without recipient consent",
    termsProhib3: "Phishing, fraud, or impersonation",
    termsProhib4: "Harassment, threats, or discriminatory content",
    termsProhib5: "Any use that violates applicable anti-spam, privacy, or other laws",
    termsDisclaimerTitle: "⚠️ Disclaimer",
    termsDisclaim1: "This extension is provided \"as is\" without any warranty",
    termsDisclaim2: "The developer is not responsible for the content or consequences of emails sent",
    termsDisclaim3: "This extension sends mail via the user's own mail client (Gmail, OS mail app, etc.); the actual sending is performed by those services",
    termsDisclaim4: "For the core features (recipient management, manual sending via mailto/Gmail), this extension does not collect or transmit any data externally. All information is stored only within the user's browser",
    termsDisclaim5: "If you enable the \"Auto-send integration\" feature, the message content (recipient, subject, body) is sent to the Google Apps Script or Make.com URL you configured yourself (these run under your own account; the developer never receives this content)",
    termsNote: "If you discover a violation of these terms, please report it via a GitHub Issue.",
    voiceTitle: "Voice input & send",
    voiceWindowTitle: "Quick Mail Sender - Voice input",
    voiceHint: "Press the 🎤 button below to start voice input (this window stays open even if it loses focus, so the microphone permission dialog can be answered without issue). Choose \"Allow\" the first time you're prompted.",
    voiceSendBtn: "Send this content",
    voicePlaceholder: "Press the mic button and speak",
    voiceStatusReady: "Press the mic button and speak",
    voiceNotAllowed: "Microphone access denied. Check site permissions in the browser address bar.",
    voiceNoSpeech: "No speech detected. Please try again.",
    voiceSentClosing: "Sent. Closing window...",
    screenshotSaved: "Screenshot saved to Downloads folder:",
    screenshotGmailNote: "(Gmail web compose does not support automatic file attachments via URL. Please attach the image manually.)",
    screenshotMailtoNote: "(mailto does not support automatic file attachments. Please attach the image manually.)",
    screenshotAutoSendBody: "Screenshot sent as an attachment (Quick Mail Sender auto-send)",
    screenshotSourcePage: "Source page:",
    // recipient type (added)
    typeGas: "GAS auto-send",
    typeMake: "Make.com auto-send",
    // auto-send tab
    tabAutoSend: "Auto-send",
    // auto-send (GAS / Make.com)
    autoSendHeading: "Auto-send integrations (advanced)",
    autoSendHint: "Google Apps Script or Make.com let you send email automatically via your own Gmail/Make account with a single click (no send button to press). You register a Web App or Webhook URL created under your own account; the developer never receives these credentials.",
    gasEnabledLabel: "Enable GAS auto-send",
    gasUrlLabel: "GAS Web App URL",
    gasSecretLabel: "Shared secret (optional, recommended)",
    autoSendHelpBtn: "📖 View setup instructions (GAS & Make.com)",
    makeEnabledLabel: "Enable Make.com auto-send",
    makeUrlLabel: "Make.com Webhook URL",
    btnSave: "Save",
    autoSendSavedMsg: "Saved",
    autoSendPermissionDeniedMsg: "Could not enable because the browser permission was not granted",
    // auto-send help modal
    autoSendHelpTitle: "How to set up auto-send (GAS & Make.com guide)",
    autoSendHelpIntro: "Both approaches follow the same idea: set up a relay that runs under your own account, then register its URL with Quick Mail Sender. The developer never receives this URL or any message content.",
    autoSendHelpGasTitle: "🔧 Google Apps Script (GAS)",
    autoSendHelpGasStep1: 'Open <a href="https://script.google.com/" target="_blank" rel="noopener">script.google.com</a> and create a new project',
    autoSendHelpGasStep2: 'Copy the entire contents of the <a href="https://github.com/29kiyo/Quick-Mail-Sender/blob/main/gas-template/Code.gs" target="_blank" rel="noopener">Code.gs template (GitHub)</a> and paste it into your project',
    autoSendHelpGasStep3: "Change <code>SHARED_SECRET</code> in the code to a passphrase only you know (to prevent misuse by others)",
    autoSendHelpGasStep4: "Click Deploy (top right) → New deployment → select type \"Web app\"",
    autoSendHelpGasStep5: "Set \"Execute as\" to <b>Me</b> and \"Who has access\" to <b>Anyone</b>, then deploy",
    autoSendHelpGasStep6: "Copy the resulting \"Web app URL\" (ending in <code>.../exec</code>)",
    autoSendHelpGasStep7: "Back on this page's Auto-send tab, paste the GAS Web App URL and the passphrase you chose (shared secret), then save",
    autoSendHelpGasScreenshotNote: "Screenshot auto-send works out of the box — no extra configuration is needed.",
    autoSendHelpMakeTitle: "🔧 Make.com",
    autoSendHelpMakeStep1: 'In <a href="https://www.make.com/en/integrations/email" target="_blank" rel="noopener">Make.com</a>, create a new scenario and add "Webhooks" → "Custom webhook" as the first module',
    autoSendHelpMakeStep2: 'Click "Add" and give the webhook any name; a dedicated Webhook URL is generated — copy it',
    autoSendHelpMakeStep3: "Paste that URL into this page's Auto-send tab temporarily, save and enable it, then send a test message once (this teaches Make.com the data shape)",
    autoSendHelpMakeStep4: 'Click the "Webhooks" module on the left (not the Gmail module) and click "Redetermine data structure" — the fields <code>to</code>, <code>subject</code>, and <code>body</code> will be detected automatically from the data received. This button only appears after at least one test message has already reached the webhook (see step 3)',
    autoSendHelpMakeStep5: 'Add a next module with "+", search for an email service such as Gmail, and choose the "Send an Email" action',
    autoSendHelpMakeStep6: 'In the Gmail module, the "To" field starts empty — click "+ Add recipient" first to add an input row. Click that new field and <code>to</code> will appear as a suggestion; click it to map. Do the same for "Subject" (<code>subject</code>) and "Content" (<code>body</code>). You never need to type them manually',
    autoSendHelpMakeStep7: "Turn the scenario ON with the switch in the top right and save — setup is complete",
    autoSendHelpMakeAttachHeading: "📎 If you also want to auto-send screenshots",
    autoSendHelpMakeStep8: 'Images are now uploaded as actual files. First, in the Webhook module, send a test screenshot again and click "Redetermine data structure" once more. New image-related fields (<code>attachment</code>, <code>files[]</code>) will be detected',
    autoSendHelpMakeStep9: 'In the Gmail module\'s "Attachments" → "Add attachment," click to insert <code>attachment: name</code> (or <code>files[].name</code>) for <strong>File name</strong>, and <code>attachment: data</code> for <strong>Data</strong>. No <code>toBinary</code> or other function is needed',
    autoSendHelpMakeGlossaryTitle: "📋 What the fields in the webhook data mean",
    autoSendHelpMakeGlossaryAttachment: "<code>attachment</code>: the uploaded image, bundled as one object (contains name, mime, and data)",
    autoSendHelpMakeGlossaryName: "<code>attachment: name</code> / <code>files[].name</code>: the file name (e.g. screenshot.png)",
    autoSendHelpMakeGlossaryMime: "<code>attachment: mime</code>: the file type (e.g. image/png). It's fine if you don't use this on the Make side",
    autoSendHelpMakeGlossaryData: "<code>attachment: data</code>: the actual image content (this is what you use for the attachment's Data field)",
    autoSendHelpMakeGlossaryFiles: "<code>files[]</code>: a list of all uploaded files. Since there's only one image here, it's the same content as <code>attachment</code> — it's fine to take just the name from here",
    autoSendHelpMakeRouterTitle: "⚠️ Once you set up an attachment, text-only sends without an image will start failing",
    autoSendHelpMakeRouterBody: "Because \"File name\" and \"Data\" are marked required (*) on the Gmail module, any send without an image leaves them empty and fails with a \"required field is empty\" error. Add a \"Router\" right after the Webhook module and split into two routes: ① \"attachment: data is not empty\" → the Gmail module with the attachment mapped, ② \"attachment: data is empty\" → a separate Gmail module with no attachment configured.",
    autoSendHelpMakeRouterSkipNote: "Also, attach a \"Flow Control\" → \"Skip\" module as an error handler to each of the two branched Gmail modules (right-click the Gmail module → \"Add error handler\" → \"Skip\"). This way, if the route that doesn't match the condition throws an error, only that route is skipped instead of failing the whole scenario.",
    autoSendHelpSecurityNote: "⚠️ Anyone who knows your Web App URL / Webhook URL / passphrase can send email from your account through it. Do not share these with others.",
    // notifications (auto-send)
    notifAutoSendNotConfiguredTitle: "Auto-send is not configured",
    notifAutoSendNotConfiguredMsg: "Please configure GAS/Make.com integration in the Auto-send tab of settings.",
    statusAutoSendDoneTitle: "Auto-send complete",
    statusAutoSendDoneMsg: "The email was sent automatically.",
    notifAutoSendFailedTitle: "Auto-send failed",
    notifAutoSendFailedMsg: "An error occurred during auto-send.",
    // options header & tabs
    themeLabel: "Theme:",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    recipientsNote: "\"Gmail\" opens the Gmail web compose screen. \"Default mail app\" opens the OS default mail app (mailto). In all cases, you must press the send button yourself.",
    voiceHintNote: "* Voice input uses Google's online speech recognition and requires an internet connection.",
    voiceLangAuto: "Auto (browser language)",
    // right-click menu
    menuSelection: "Send selected text by email",
    menuPageUrl: "Send this page URL by email",
    menuImageUrl: "Send this image URL by email",
    menuAllTabs: "Send all open tab URLs by email",
    menuScreenshotFull: "Screenshot this page and send by email",
    menuScreenshotPartial: "Screenshot selection and send by email",
    // email subjects
    subjectSelection: "Selected text",
    subjectPageUrl: "Page URL",
    subjectImageUrl: "Image URL",
    subjectAllTabs: "tab URLs",
    subjectScreenshot: "Screenshot",
    subjectCustom: "Quick Mail Sender",
    subjectPlaceholder: "Subject (auto-filled if left blank)",
    // notification
    notifTruncatedTitle: "Content truncated",
    notifTruncatedMsg: "The content exceeded the email URL limit. Full text has been saved to your Downloads folder.",
    notifTruncatedCopiedMsg: "The content exceeded the email URL limit. The full text has been copied to your clipboard — paste it (Ctrl+V) into the body field (it was also saved as a text file, just in case).",
    truncatedNotice: "\n\n[Content was too long and has been truncated. Please check the downloaded text file for the full content.]",
    noTabClosedMsg: "The target tab has already been closed.",
    notifScreenshotFailTitle: "Cannot start screenshot",
    notifScreenshotFailMsg: "Screenshot selection is not available on this page (extension management pages, Chrome Web Store, etc.). Please try on a regular webpage.",
    // Multiple webhook registration (v2)
    gasWebhookListHeading: "Registered GAS webhooks",
    makeWebhookListHeading: "Registered Make.com webhooks",
    webhookLabelLabel: "Label (a name to tell webhooks apart)",
    webhookLabelPlaceholder: "e.g. Home",
    webhookEnabledLabel: "Enable",
    webhookListEmptyMsg: "None registered yet. Add one using the form below.",
    webhookConfirmDelete: "Delete this webhook? Any recipient using it will become unassigned.",
    webhookAddNewGasHeading: "Add a new GAS webhook",
    webhookAddNewMakeHeading: "Add a new Make.com webhook",
    recipientWebhookFieldLabel: "Webhook to use",
    recipientWebhookPlaceholderOption: "Select one",
    recipientWebhookEmptyWarning: "Please register a webhook in the Auto-send tab first",
    recipientSenderAccountFieldLabel: "Sender account (optional)",
    recipientSenderAccountDefaultOption: "Don't specify (use current Gmail account)",
    // Gmail sender account management
    senderAccountsHeading: "🔧 Manage Gmail sender accounts (for switching between multiple Google accounts)",
    senderAccountsHint: "Useful if you're signed into multiple Google accounts in Chrome. The account number corresponds to sign-in order (the first account is 0, the second is 1, and so on). If you're not sure, open Gmail and check the order of accounts under the account icon in the top right, or just try starting from 0. Accounts registered here can be selected as the \"sender account\" when editing a Gmail recipient.",
    senderAccountListEmptyMsg: "None registered yet.",
    senderAccountLabelLabel: "Label (a name to tell accounts apart)",
    senderAccountLabelPlaceholder: "e.g. Work Gmail",
    senderAccountIndexLabel: "Account number (starting from 0)",
    senderAccountConfirmDelete: "Delete this sender account?"
  }
};

// ブラウザ言語またはユーザー設定から使用言語コードを取得する
// 返り値: "ja" | "en"
async function detectLang() {
  try {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const userLang = settings?.uiLang; // "auto" | "ja" | "en" | undefined
    if (userLang && userLang !== "auto") {
      return userLang in TRANSLATIONS ? userLang : "ja";
    }
  } catch {
    // storage取得失敗時はnavigatorにフォールバック
  }
  const lang = (navigator.language || "ja").toLowerCase();
  return lang.startsWith("en") ? "en" : "ja";
}

// 現在の翻訳オブジェクトをキャッシュ
let _t = null;
let _lang = null;

async function loadI18n() {
  _lang = await detectLang();
  _t = TRANSLATIONS[_lang] || TRANSLATIONS.ja;
  return { t: _t, lang: _lang };
}

// テキストを取得(同期版、loadI18n後に使う)
function t(key) {
  return (_t && _t[key]) || TRANSLATIONS.ja[key] || key;
}

// 音声入力言語コードをブラウザ言語から推定
function detectVoiceLang() {
  const lang = (navigator.language || "ja").toLowerCase();
  if (lang.startsWith("ja")) return "ja-JP";
  if (lang.startsWith("en-gb")) return "en-GB";
  if (lang.startsWith("en")) return "en-US";
  if (lang.startsWith("ko")) return "ko-KR";
  if (lang.startsWith("zh-tw") || lang.startsWith("zh-hant")) return "zh-TW";
  if (lang.startsWith("zh")) return "zh-CN";
  // その他はnavigator.languageをそのまま渡す(ブラウザが対応していれば動く)
  return navigator.language;
}
