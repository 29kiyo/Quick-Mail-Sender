# GAS Auto-send Template

`Code.gs` is the Google Apps Script template used by Quick Mail Sender's
"Auto-send integration" feature.

For the full setup steps (including Make.com), open the extension's settings
page, go to the "Auto-send" tab, and click "📖 View setup instructions (GAS &
Make.com)" for the in-app guide. That in-app guide is always kept up to date;
treat it as the source of truth.

Quick summary:

1. Create a new project at [script.google.com](https://script.google.com/) and paste in the contents of `Code.gs`
2. Change `SHARED_SECRET` in the code to a passphrase only you know
3. Deploy it as a Web app (Execute as: Me / Who has access: Anyone)
4. Register the resulting URL (ending in `.../exec`) and your passphrase in the Quick Mail Sender settings page

日本語版: [README.md](README.md)
