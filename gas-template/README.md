# GAS自動送信テンプレート

`Code.gs` は、Quick Mail Senderの「自動送信連携」機能で使うGoogle Apps Scriptのテンプレートです。

具体的なセットアップ手順（Make.comの手順も含む）は、拡張機能の設定画面「自動送信」タブ内の
「📖 設定方法を見る（GAS・Make.com共通）」ボタンから、アプリ内ヘルプとして確認できます。
最新の手順は常にそちらを参照してください。

要点だけ知りたい場合:

1. [script.google.com](https://script.google.com/) で新しいプロジェクトを作成し、`Code.gs` の内容を貼り付ける
2. コード内の `SHARED_SECRET` を自分だけの合言葉に変更する
3. ウェブアプリとしてデプロイ（実行するユーザー: 自分 / アクセスできるユーザー: 全員）
4. 発行されたURL(`.../exec`)と、決めた合言葉をQuick Mail Senderの設定画面に登録する

英語版: [README.en.md](README.en.md)
