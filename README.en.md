# Quick Mail Sender

**[日本語版はこちら (Japanese version)](README.md)**

A Chrome / Edge extension that lets you send selected text, the current page URL, image URLs, or screenshots by email from the right-click menu or the toolbar icon.

## Key features

- Send selected text by email from the right-click menu
- Send the current page URL by email from the right-click menu
- Send an image URL by email from the right-click menu (the body includes the image URL and the source page URL; when possible, the image itself is automatically attached/pasted too. Depending on the site's CORS settings, the image itself may not be fetchable, in which case only the URL is included)
- Send all open tab URLs at once (neatly numbered and titled)
- Send free-form text from the toolbar icon (with voice input support)
- Send full-page or region screenshots (automatically saved to Downloads)
- Register multiple recipients, switch between them easily, and edit them anytime (unset default, change type, etc.)
- One-time recipients (used once without being saved)
- Send history with view/delete
- Light/dark theme (follows browser setting automatically, or switch manually)
- Settings persist across browser/PC restarts (kept until you delete them yourself)
- (beta) Auto-send integration via Google Apps Script / Make.com (uses your own account, no send-button click needed)
- Register multiple GAS / Make.com webhooks and assign a different one to each recipient (e.g. home vs. work)
- Register and switch between Gmail sender accounts (if you're signed into multiple Google accounts, choose which one each recipient opens with)

## Terms of Use

By using this extension, you are deemed to have agreed to the following Terms of Use.

### Permitted use
- Sending email from your own email account to recipients who have consented
- Legitimate business or personal communication

### Prohibited use
- Sending spam or unsolicited bulk email
- Sending mass commercial email without recipient consent
- Sending for phishing, fraud, or impersonation purposes
- Sending harassing, threatening, or discriminatory content
- Any use that violates anti-spam or privacy laws in your jurisdiction

### Disclaimer
This extension is provided "as is" with no warranty of any kind. The developer bears no responsibility for the content or outcome of any email sent. The extension sends email through your own mail client (Gmail, your OS's mail app, etc.).

For the core features (recipient management, manual sending via mailto/Gmail), this extension does not collect or transmit any data externally, and all information is stored only within your browser. Only if you enable the "Auto-send integration (GAS/Make.com)" feature is message content sent to a URL you configured yourself (see "Setting up auto-send integration" below for details). All features are free to use.

If you find a violation of these terms, please report it via a GitHub Issue.

## About permissions

Here are the permissions this extension requests. It does not request excessive permissions such as `<all_urls>`.

| Permission | Purpose |
|---|---|
| `contextMenus` | Add right-click menu items |
| `storage` | Store recipients, settings, and history (browser-local only) |
| `activeTab` | Temporary access to the current tab at the moment the user interacts with it (for screenshots, URL retrieval) |
| `scripting` | Temporary script injection for region-selection screenshots and for auto-pasting into the Gmail compose window |
| `tabs` | Bulk retrieval of all tab URLs (Chrome's permission wording shows this as "Read your browsing history," but in practice it only retrieves each tab's URL and title) |
| `downloads` | Save screenshot images and the full text file when a message body gets truncated |
| `notifications` | Notify on auto-send success/failure, errors, or truncation |
| `offscreen` | A hidden document used to access the clipboard from the service worker (used by the long-text copy feature) |
| `host_permissions: https://mail.google.com/*` | Needed to inject the script that auto-pastes a screenshot into a freshly opened Gmail compose tab without further user interaction (`activeTab` alone can't inject into a tab the user hasn't directly clicked) |

It also declares `https://script.google.com/*` and `https://*.make.com/*` as `optional_host_permissions`, but declaring them **does not activate them by itself**. They are only granted once you enable GAS/Make.com auto-send in the "Auto-send" tab of the settings page, at which point the browser shows a permission dialog and asks for your explicit consent (`chrome.permissions.request`).

`activeTab` is a temporary permission that is only active "at the moment the user explicitly interacts with the extension." It never reads a page's content in the background without user action.

`mailto:` links and the Gmail web compose URL both have a length limit of roughly 2000 characters. With many tabs open, this limit can be exceeded, causing a "400 Bad Request" error. To avoid this, the extension automatically truncates the body once it exceeds 1800 characters, saves the full text as a `.txt` file to your Downloads folder, and shows a notification that truncation occurred.

## About the "automatically allow access on the following sites" notice

Chrome's extension management page may show an "automatically allow access on the following sites" toggle for Gmail (`https://mail.google.com/*`). This is because `manifest.json` declares `https://mail.google.com/*` under `host_permissions`. It's used solely for the "auto-paste screenshot into Gmail compose" feature and is never used to access any other page (everything else only gets temporary access via `activeTab` at the moment you use the extension). This extension never reads or transmits anything beyond what the user explicitly triggers. All source code is published in this repository.

## Multi-language support

If your browser's language is set to English (`en-*`), the UI automatically displays in English. You can also manually switch between Japanese, English, or Auto (follow browser) from the settings page under "Other settings" → "Display language." If the voice-input language is left at "Auto (browser language)," the speech-recognition language automatically follows your browser's language too.

Due to browser security restrictions, **this extension cannot automatically click the "Send" button on your behalf**. Instead, it automatically opens a `mailto:` link (your default mail app) or the Gmail web compose window with the body, recipient, and subject already filled in — but you must perform the final send action yourself.

Neither `mailto:` (default mail app) nor Gmail (web compose) provides a way to automatically attach image files via URL, so automatic image attachment is not possible. The screenshot feature instead automatically downloads the image, and you attach it manually in the mail compose window that opens.

## Installation (detailed steps for first-time users)

This extension is not published on the Chrome Web Store, so it's installed manually using "Developer mode." It looks intimidating, but once you're used to it, it takes about a minute.

### 1. Download the files

Open this repository's GitHub page, click the green "**Code**" button, then "**Download ZIP**."
A ZIP file (e.g. `Quick-Mail-Sender-main.zip`) will be saved to your computer's Downloads folder.

### 2. Extract the ZIP file

**The downloaded ZIP file cannot be used as-is. You need to "extract" its contents first.**

**On Windows**
1. Right-click the downloaded ZIP file
2. Click "Extract All"
3. Confirm the destination folder and click "Extract"
4. A folder with the same name as the ZIP (containing `manifest.json` and other files) is created in the same location

**On Mac**
1. **Double-click** the downloaded ZIP file to extract it automatically
2. An extracted folder is created in the same location

⚠️ Note: depending on your extraction tool, you may end up with a folder nested one level too deep (e.g. a `quick-mail-sender` folder inside another `quick-mail-sender` folder). When loading the extension in the next step, make sure to select **the folder that directly contains `manifest.json`**.

### 3. Open your browser's "Extensions" page

- Chrome: type `chrome://extensions` in the address bar and press Enter
- Edge: type `edge://extensions` in the address bar and press Enter

### 4. Turn on Developer mode

Click the "Developer mode" switch, usually in the top right of the screen (bottom left on Edge). Turning it on reveals several new buttons at the top of the page.

### 5. Load the extension

1. Click "Load unpacked"
2. In the file picker, select the **folder** you extracted in step 2 (the one that directly contains `manifest.json`) and click "Select Folder"
   - Selecting the ZIP file itself will cause an error. Be sure to select the extracted folder.

"Quick Mail Sender" will now appear in your extensions list, and its icon will appear in your browser toolbar.

### 6. Register a recipient

Right-click the extension icon → "Options" (or click "Details" on the extension card → "Extension options"), then register a recipient email address. Sending features won't work until you do this.

## Setting up auto-send integration (advanced, optional)

Every feature in this extension is free. The following is a completely optional feature that has no effect on normal use if left unconfigured.

- **Auto-send integration (GAS / Make.com)**: From the "Auto-send" tab in settings, register a Google Apps Script Web App URL or a Make.com Webhook URL of your own to create a recipient (type "GAS auto-send" or "Make.com auto-send") that sends email automatically, without pressing a send button. The developer never receives these credentials or the content sent.
- Detailed setup steps are available as an in-app guide: open the "Auto-send" tab in settings and click "📖 View setup instructions (GAS & Make.com)" (both the GAS and Make.com steps are covered in one place). The GAS code template is at [`gas-template/Code.gs`](gas-template/Code.gs).

## Usage

- Pin to the toolbar.
- Select text on a page → right-click → "Send selected text by email"
- Click the toolbar icon to open a menu for free-form text, URL sending, screenshot sending, and more
- Register multiple recipients in settings. Whichever one is set as "default" starts pre-checked in the picker window that opens on right-click sending (you can still change or add recipients before sending). You can always change details or unset the default later via the "Edit" button
- Right-click sending (and the keyboard shortcut) always shows a small window asking which recipient(s) to use — it never sends immediately without asking
- Turning on "One-time recipient" in the popup lets you send to an address without saving it
- Voice input opens a small dedicated window when you click the microphone button; click the microphone button inside that window before speaking
- **The right-click menu is not available on the address bar** (browsers do not allow extensions to add context menu items there). Instead, use the `Ctrl+Shift+U` (`Cmd+Shift+U` on Mac) shortcut to send the current page URL even while the address bar has focus. You can change this shortcut at `chrome://extensions/shortcuts` (`edge://extensions/shortcuts` on Edge).

## Publishing on GitHub

1. Commit and push this folder as-is to the root of your repository
2. Set the repository to Public, and anyone can download and install it via "Code" → "Download ZIP"
3. Adding a `.github/workflows/build.yml` file will automatically build a ZIP and attach it to the Releases page whenever you push a tag (e.g. `v1.0.0`), making it downloadable without needing to log in — a more convenient distribution method
4. To publish officially on the Chrome Web Store / Edge Add-ons, you'll need to register as a developer with each store (this involves separate fees and review). This repository assumes manual installation via Developer mode only.

## Troubleshooting

### Gmail opens even when I choose "Default mail app"

This isn't a bug in the extension — it's caused by your browser already having a setting that routes `mailto:` links to Gmail.
If you previously clicked "Allow" on a browser prompt asking "Allow mail.google.com to open all mailto links?", then every `mailto:` link — including the ones opened by this extension — gets intercepted by Gmail.

How to fix it (same idea on Chrome and Edge):

1. Enter `chrome://settings/content/siteDetails?site=https%3A%2F%2Fmail.google.com` in the address bar (`edge://settings/content/siteDetails?site=https%3A%2F%2Fmail.google.com` on Edge)
2. Under "Permissions," find "Protocol handlers" and remove/block `mail.google.com` if it's registered as the `mailto` handler
3. Alternatively, on Windows: Settings → "Apps" → "Default apps" → scroll down and search for the "MAILTO" protocol, then set your preferred mail app (e.g. Outlook) as the default

If changing the recipient "type" doesn't change the behavior, check this setting first.

### What's the difference between "Other" and "Default mail app"?

In the current version, there's no functional difference — both simply open a `mailto:` link. This label exists purely so you can organize recipients into categories like "for work" or "for Yahoo Mail."

### Voice input shows a "not-allowed" error, or no permission dialog appears at all

If a microphone is started automatically without a button press, the browser silently blocks it without even showing a permission dialog (this prevents microphone access without user interaction). This extension only starts speech recognition when you manually click the 🎤 button inside its dedicated window.

If you still don't see a permission dialog, or get an error, check the following:

1. Click the icon on the left side of the address bar (e.g. a lock icon) and check that "Microphone" isn't blocked in the site's permission settings
2. On Windows: Settings → "Privacy & security" → "Microphone" → confirm "Let apps access your microphone" is on
3. Check whether another app (e.g. video conferencing software) is currently using the microphone

### Region-selection screenshot doesn't work

Tabs that were already open before you installed the extension don't have the "content script" that's automatically injected when a page loads. Reload the tab (F5) once and try again. It works fine on any tab opened, or any page navigated to, after installing the extension.

Note that special pages the browser restricts extensions from running on — such as `chrome://` settings pages or extension store pages — won't work even after reloading (this is a browser limitation).

## About Development

The code for this tool was written entirely by AI (Claude).
