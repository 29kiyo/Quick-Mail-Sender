/**
 * Quick Mail Sender - GAS自動送信テンプレート
 * ------------------------------------------------------------
 * このスクリプトは「あなた自身の」Googleアカウントで
 * Google Apps Script プロジェクトとして作成し、ウェブアプリとしてデプロイしてください。
 * 開発者(Quick Mail Sender作者)はこのスクリプトやWebアプリURL・送信内容に
 * 一切アクセスできません。すべてあなた自身のGmailアカウントから送信されます。
 *
 * ■ セットアップ手順
 *   1. https://script.google.com/ で「新しいプロジェクト」を作成
 *   2. このファイルの内容を貼り付ける
 *   3. 下の SHARED_SECRET を自分だけの合言葉に変更する（推奨。第三者による悪用防止のため）
 *   4. 右上「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」
 *        - 実行するユーザー: 自分
 *        - アクセスできるユーザー: 全員
 *   5. 発行された「ウェブアプリURL」(.../exec で終わるURL) をコピー
 *   6. Quick Mail Sender の設定画面「自動送信」タブ →
 *      「自動送信連携」→ GAS Webアプリ URL に貼り付け、共有シークレットも同じ値を入力
 *   7. 送信先の「種類」で「GAS自動送信」を選んだ送信先を作成すれば、
 *      その送信先へはボタン一つで自動送信されるようになります
 *
 * ■ スクリーンショット送信について
 *   Quick Mail Senderのスクリーンショット機能をGAS宛先で使うと、画像データ(base64)が
 *   一緒に送られてきます。このスクリプトは自動的にPNG画像として添付してメール送信します。
 *
 * ■ 注意
 *   - GmailApp.sendEmail は1日あたりの送信数上限があります（Googleアカウントの種類による）
 *   - ウェブアプリURLと共有シークレットを知っている人は誰でもこのスクリプト経由で
 *     あなたのGmailからメールを送信できてしまいます。他人に教えないでください
 */

// ここを自分だけの合言葉に変更してください（空文字にすると検証をスキップします。非推奨）
const SHARED_SECRET = "ここを自分だけの合言葉に変更してください";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: "invalid secret" });
    }

    const to = body.to;
    const subject = body.subject || "(件名なし)";
    const text = body.body || "";

    if (!to) {
      return jsonResponse({ ok: false, error: "'to' is required" });
    }

    const options = {};
    // スクリーンショットなど、base64画像が送られてきた場合は添付ファイルにする
    if (body.attachment) {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(body.attachment),
        body.mimeType || "image/png",
        body.filename || "attachment.png"
      );
      options.attachments = [blob];
    }

    GmailApp.sendEmail(to, subject, text, options);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

// ブラウザから直接URLを開いた場合の疎通確認用
function doGet() {
  return jsonResponse({ ok: true, message: "Quick Mail Sender GAS relay is running." });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
