# Delivering a Visual QA Report to Google Drive and Packaging the Workflow as a Claude Code Skill (as of 2026-11-15)

## Q1. Does Google Drive render an uploaded .html file as a web page with embedded (base64 data-URI) images?

### Takeaway
No. Drive does not render HTML as a web page, either in its own preview or through a shared link. The preview shows the markup as plain text, and no Drive setting changes that. Drive's web hosting (googledrive.com/host/<id>) was shut down on 2016-08-31 and has not come back. A self-contained HTML file with data-URI screenshots is still a good portable artifact to store in Drive, but people have to download it, or install a browser extension, to see it as a page. The user's requirement ("a simple webpage in a Drive folder, with screenshots shown on the page") cannot be met literally by a .html file alone.

### Cited Findings
- Google announced in August 2015 that Drive web hosting was being phased out. It stopped serving content via `googledrive.com/host/[doc id]` on August 31, 2016. Google pointed users to Google Cloud static-website hosting and, in the 2016 reminder, to Firebase Hosting. This is old information, but it is the origin of the current behavior. — [Google Workspace Updates, Aug 2015](https://workspaceupdates.googleblog.com/2015/08/deprecating-web-hosting-support-in.html); [G Suite Developers blog reminder, Jul 2016](https://gsuite-developers.googleblog.com/2016/07/reminder-turn-down-of-google-drive-web.html); [TechCrunch, 2015-08-31](https://techcrunch.com/2015/08/31/google-starts-deprecating-web-hosting-support-in-google-drive)
- Current behavior, per a recent (undated) explainer. Drive's preview renders documents, spreadsheets, slides, images, PDFs and video, but "HTML is not one of them, so the preview shows the source code as text." A share link "points at Drive's interface with your file inside it," not at a rendered page. On the web, a browser is not among the "Open with" apps. With the Drive desktop app, "Open with" can send the file to a local browser, but only for the person who has the file locally. — [NOS Workspace: HTML file in Google Drive](https://nos-workspace.com/learn/html-file-in-google-drive)
- Google's own help page lists what Drive on the web can view: "videos, PDFs, Microsoft Office files, audio files, and photos". HTML is not listed as a rendered type. — [Google Drive Help: file types](https://support.google.com/drive/answer/2423485?hl=en)
- A third-party Chromium extension, "Drive HTML Preview", renders HTML files stored in Drive as web pages in a sandboxed frame, with no OAuth. It only works for self-contained files: sibling CSS, JS or images in the same folder won't load. Every viewer would need to install it. — [GitHub: filipeaaoliveira/google-drive-html-preview](https://github.com/filipeaaoliveira/google-drive-html-preview); [Chrome Web Store listing](https://chromewebstore.google.com/detail/drive-html-preview/ejkgjalefkphnaadkibomnianbcpnbik)
- Several 2025–2026 guides describe the same set of workarounds: static hosting (GitHub Pages, Netlify, Vercel), embedding in Google Sites, or downloading the file and opening it locally. — [DocStash: open a Google Drive HTML file as a webpage](https://docstash.ai/blog/google-drive-html); [Latenode community thread](https://community.latenode.com/t/viewing-html-file-on-google-drive-not-rendering-properly/13216); [undraft.page](https://undraft.page/blog/why-html-files-do-not-render-in-google-drive-or-dropbox/)
- Drive accepts uploads of "other files" up to 5 TB, so a large self-contained HTML file can be stored. Size is not the issue; rendering is. — [Google Drive Help: storage limits](https://support.google.com/drive/answer/37603?hl=en)

### Inferences
- Base64 data URIs only add size. They are about 33% larger than the binary PNG, so 20 full-page screenshots at about 500 KB each make an HTML file of about 13 MB. Drive's text preview would just show a wall of base64. Data URIs help only once the file is opened in a real browser (after download, or through the extension), where they make the file fully self-contained. That is exactly the case the extension supports.
- The HTML file is still worth putting in the Drive folder as the "source of truth" or offline copy. It cannot be the primary in-Drive viewing experience.

### Gaps
- I found no official Google statement from 2025–2026 that explicitly says "HTML previews as text". The evidence is the 2016 shutdown, Google's list of viewable types (which omits HTML), and consistent third-party reports.
- I found no documented size or character limit for Drive's text preview of a large HTML or text file. I could not confirm whether a 10+ MB HTML file shows a partial text preview or a "no preview available" message.

## Q2. Which alternatives satisfy "simple webpage, screenshots on the page, stored in Drive", and how do they compare?

### Takeaway
The most reliable way to get "opens in Drive with screenshots visible on the page" is a PDF rendered from the same HTML, for example with Playwright `page.pdf()`. Drive previews PDFs natively, share links work, all images are embedded, and the skill's browser tooling can already produce it. A Google Doc is the best pick when people need to comment on or edit the report. It should not be built by converting HTML with base64 images, because many reports say Docs drops those. Build it with the Docs API `insertInlineImage`, which needs a public image URL, or by converting a generated .docx; both need a quick test. The recommended package is a self-contained report.html, plus report.pdf (the primary in-Drive view), plus a screenshots/ folder, with an optional Google Doc.

### Cited Findings
**(a) HTML uploaded and converted to a Google Doc (`mimeType: application/vnd.google-apps.document`)**
- The Drive API officially supports converting HTML, Word, ODT, RTF, plain text and Markdown into Google Docs at upload time. You set the Google Workspace `mimeType` when creating the file. Supported import formats are listed dynamically in `about.importFormats`. Images (JPEG, PNG, GIF, BMP) and PDFs can also be converted to Docs, with the image embedded and OCR text extracted. — [Drive API: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- Size limits: a Google Doc can hold up to 1.02 million characters. A text document converted to Docs can be up to 50 MB, and a presentation converted to Slides up to 100 MB. No per-image limit for Docs is stated. — [Google Drive Help: storage limits](https://support.google.com/drive/answer/37603?hl=en)
- Base64 `data:` images in imported HTML: several community reports (2024–2025) say the Docs import silently drops or ignores them. The suggested fix is to upload the images to Drive first and reference them by URL. — [Latenode: base64 images not showing in HTML upload](https://community.latenode.com/t/google-docs-api-not-showing-base64-encoded-images-in-html-upload/35170); [Latenode: inserting HTML with base64 images](https://community.latenode.com/t/inserting-html-content-with-base64-encoded-images-into-google-docs/18643); [Make community: Docs does not support inserting images directly from raw Base64](https://community.make.com/t/trying-to-push-a-freepik-image-into-a-google-doc-without-using-drive-for-upload/104297)
- Conflicting older evidence: an older Stack Overflow answer (about HTML-to-PDF via Drive) says base64 images "worked for me when uploading by web", which suggests the web UI import path may behave differently. A 2011 Google Groups thread reported that base64 images in API-created docs were displayed "only sometimes (quite never)". — [SO mirror: html images css to pdf using google drive api](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/16316029/html-images-css-to-pdf-using-google-drive-api); [Google Groups 2011](https://groups.google.com/g/google-documents-list-api/c/6k3yo1bmH3c)
- An Apps Script approach by Tanaike: create image files in a Drive folder and point the img tags at their thumbnail links. The images reportedly do not need to be publicly shared. — [Tanaike gist](https://gist.github.com/tanaikech/e6bbb3bf341d7ac021f3bcfa523c4ca3)

**(b) Docs API `insertInlineImage`**
- "The image is fetched once at insertion time and a copy is stored for display inside the document." Images must be under 50 MB, at most 25 megapixels, and PNG, JPEG or GIF. "The provided URI must be publicly accessible and at most 2 kB in length." The source URI is saved and exposed as `ImageProperties.content_uri`. — [Docs API reference: InsertInlineImageRequest](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request#insertinlineimagerequest); [Docs API: Insert inline images](https://developers.google.com/workspace/docs/api/how-tos/images)

**(c) PDF rendered from the HTML and uploaded to Drive**
- Drive on the web previews PDFs natively. — [Google Drive Help: file types](https://support.google.com/drive/answer/2423485?hl=en)
- Playwright's `page.pdf()` returns a PDF of the page and uses `print` CSS media by default. Call `page.emulateMedia({ media: 'screen' })` first to render the screen styles instead. Colors are modified for printing unless you set CSS `-webkit-print-color-adjust`. Options include `format` (default Letter), `width`/`height`, and `displayHeaderFooter` with `headerTemplate`/`footerTemplate` (no scripts in templates). — [Playwright API: page.pdf](https://playwright.dev/docs/api/class-page#page-pdf)

**(d) Google Slides, one slide per scenario**
- Converted presentations can be up to 100 MB. — [Google Drive Help: storage limits](https://support.google.com/drive/answer/37603?hl=en)

**(f) Google Sites or Apps Script web app**
- Google Sites is commonly suggested as a way to embed HTML content. — [DocStash](https://docstash.ai/blog/google-drive-html)
- The Drive MCP docs note that Apps Script cannot use its default OAuth client for the Drive MCP, which hints at extra setup when Apps Script is in the loop. — [Configure the Drive MCP server](https://developers.google.com/workspace/drive/api/guides/configure-mcp-server)

**(g) Hosting the HTML elsewhere**
- Google itself recommended GCP static hosting and Firebase Hosting when it shut down Drive hosting. Current guides point to GitHub Pages, Netlify and Vercel. — [G Suite Developers blog 2016](https://gsuite-developers.googleblog.com/2016/07/reminder-turn-down-of-google-drive-web.html); [DocStash](https://docstash.ai/blog/google-drive-html)

### Inferences
Comparison (my synthesis of the findings above; effort ratings are judgments):

| Option | Opens inline in Drive with images | Shareable via Drive link | Effort in the skill | Image fidelity | Notes |
|---|---|---|---|---|---|
| Self-contained .html (data URIs) only | No (source text) | Link shows source | Lowest | Perfect once downloaded | Fails the requirement on its own |
| **PDF from the same HTML (Playwright `page.pdf`)** | **Yes** | **Yes** | **Low**: one extra call in the browser the skill already drives | High (lossless embed). Wide screenshots get scaled to the page width, so use landscape or a custom width and `printBackground` | Best fit for "view it in Drive" |
| Google Doc from HTML conversion | Yes | Yes, plus comments | Low, but base64 images are reportedly dropped | Unreliable with data URIs | Only viable if images are referenced by reachable URLs |
| Google Doc via Docs API `insertInlineImage` | Yes | Yes, plus comments | Medium: needs public image URLs (temporary "anyone with link" or another host), batchUpdate index handling | Good (PNG/JPEG ≤25 MP; full-page screenshots may exceed 25 MP) | Exposes screenshots publicly during insertion |
| Google Doc via a generated .docx (python-docx with embedded PNGs) converted on upload | Yes (likely) | Yes, plus comments | Medium | Likely good | Not verified for images; test first |
| Google Slides, one slide per scenario | Yes | Yes | Medium–high (Slides API image insertion very likely has the same public-URL constraint as Docs; unverified) | Good for viewport shots, poor for tall full-page shots | Nice for demos, overkill for QA |
| Google Sites / Apps Script web app | Not "in the folder" | Separate URL | High (deployment and auth) | Good | Extra moving parts |
| External static host (GitHub Pages / Netlify / Vercel / Cloudflare Pages) or a claude.ai artifact, with Drive holding the files | Not in Drive | Separate URL | Medium (deploy step plus credentials) | Perfect | Privacy risk: QA screenshots of staging apps would sit on a public or semi-public host |

- Recommended deliverable per run: `QA/<YYYY-MM-DD> <topic>/` containing `report.pdf` (what people click in Drive), `report.html` (self-contained, data URIs, which renders perfectly once downloaded), `screenshots/NN-<scenario-slug>.png`, and optionally `results.json` for traceability. All three outputs can come from one Jinja/HTML template, so the PDF is a pure rendering step.
- If stakeholders need to comment, add a Google Doc. The lowest-risk route is to try (in order): converting a .docx generated with embedded images, then `insertInlineImage` with short-lived public URLs. Both need a 5-minute spike to confirm.
- For the PDF, use `page.setContent(html)` or `goto('file://…/report.html')`, then `emulateMedia('screen')` and `pdf({ printBackground: true, width: '1280px', … })`. Add CSS `page-break-inside: avoid` on each scenario card so a screenshot is not split across pages.

### Gaps
- No official Google documentation states whether data-URI images survive HTML→Docs conversion through the Drive API in 2026. The evidence is anecdotal and conflicting, so test it directly.
- I did not verify whether Drive file URLs (`drive.google.com/uc?id=…`, `thumbnailLink`, `drive.usercontent.google.com`) count as "publicly accessible" to the Docs API image fetcher.
- I did not verify whether images embedded in a .docx survive Drive API conversion to Google Docs. A forum thread covers .docx conversion but not images. — [Latenode: Word to Google Docs via Drive API v3](https://community.latenode.com/t/how-to-transform-word-documents-to-google-docs-format-via-drive-api-v3/26343)
- I did not confirm from the truncated Playwright page that `page.pdf()` is Chromium-only. My prior knowledge says it is, so treat that as unverified. The details of `printBackground` and `preferCSSPageSize` were also in the unread portion.
- I did not verify the Slides API `createImage` limits.

## Q3. How can a Claude Code skill create folders and upload files to Drive, and which option is simplest and most robust?

### Takeaway
For a personal My Drive, the most robust option is a bundled Python or Node script that calls the Drive API v3 with an OAuth "desktop app" client and caches the token locally. Service accounts are a trap for My Drive: they have no storage quota and cannot own files. They only work with Shared Drives, or with domain-wide delegation on Workspace. rclone is a fine no-code alternative (`rclone mkdir`/`copy` to a nested path), but you must create your own OAuth client, because rclone's shared client ID is being retired during 2026. Google's official Drive MCP server (`https://drivemcp.googleapis.com/mcp/v1`) is still a Developer Preview. It can create folders and upload base64 content, but sending screenshots through the model as base64 is expensive unless the client supports file references.

### Cited Findings
**Service accounts vs OAuth**
- Service accounts "don't have storage quota" and cannot own files in a personal My Drive. You must upload into Shared Drives, or use OAuth to act on behalf of a human user. Uploads otherwise fail with 403 `storageQuotaExceeded`, even when the Drive has plenty of space. — [Fivetran troubleshooting](https://fivetran.com/docs/activations/destinations/available-destinations/google-drive/troubleshooting/service-accounts-storage-quota); [Google Developers forum](https://discuss.google.dev/t/storagequotaexceeded-the-users-drive-storage-quota-has-been-exceeded-for-service-account/104375); [Google Developers forum: empty SA drive still 403](https://discuss.google.dev/t/error-403-storagequotaexceeded-when-the-service-accounts-drive-is-completely-empty/194265)
- Community reports say service accounts created after 2025-04-15 get zero Drive storage, while older ones keep theirs. This is secondhand; I could not confirm it against an official Google source. — [rclone forum](https://forum.rclone.org/t/google-drive-service-account-changes-and-rclone/50136); [Latenode](https://community.latenode.com/t/new-google-service-accounts-getting-zero-storage-quota-causing-403-errors-on-drive-api-calls/32437)
- Shared Drives own their files, so a service account can write there. — [UW-Madison KB (via search summary)](https://kb.wisc.edu/googleapps/123425)
- Drive upload limit: 750 GB per day per user across My Drive and Shared Drives. — [Drive API usage limits](https://developers.google.com/drive/api/v3/limits)

**OAuth scopes**
- `drive.file` is a non-sensitive scope, "recommended for most use cases", and needs only basic verification. It covers files the app creates or that the user opens with or shares to the app (for example through the Picker). The full `drive` scope ("View and manage all your Drive files") and `drive.readonly` are restricted. They require restricted-scope verification, and a security assessment if data is stored server-side. Unverified public apps show an "unverified app" screen. — [Drive API: Choose scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- rclone's documentation spells out the practical effect of `drive.file`: "With this scope rclone can read/view/modify only those files and folders it creates. Files uploaded through the web interface are not visible to rclone." — [rclone Drive docs](https://rclone.org/drive/)

**Upload mechanics**
- Simple upload (`uploadType=media`) and multipart (metadata plus content) are for files of 5 MB or less. Use resumable upload for files over 5 MB; a session URI is valid for one week. — [Drive API: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

**rclone**
- rclone can authenticate with interactive OAuth through `rclone config`, or with `service_account_file` / `service_account_credentials`. `--drive-impersonate user@domain` works with domain-wide delegation. Other options: `root_folder_id`, Shared Drive selection, and scopes `drive`, `drive.file`, `drive.readonly`, `drive.appfolder` and `drive.metadata.readonly`. "Drive paths may be as deep as required." — [rclone Drive docs](https://rclone.org/drive/)
- "The shared client_id is being retired and will stop working during 2026." rclone recommends creating your own client ID. — [rclone Drive docs](https://rclone.org/drive/)
- rclone does not convert files on import by default ("the conversion is lossy process"). Import requires the converted file to keep the same extension under `--drive-export-formats`. Drive allows duplicate names, which "cause problems with the syncing". Use `rclone dedupe` to clean them up. — [rclone Drive docs](https://rclone.org/drive/)

**Google's official Drive MCP server**
- Endpoint `https://drivemcp.googleapis.com/mcp/v1`, Streamable HTTP, OAuth 2.0. Labeled Developer Preview ("Available as part of the Google Workspace Developer Preview Program"). Setup requires enabling `drive.googleapis.com` and `drivemcp.googleapis.com`, a consent screen with scopes `drive.readonly` and `drive.file`, and a Web OAuth client with "Use this client for an AI-powered agent" checked. Requests from clients without that setting are rejected. — [Configure the Drive MCP server](https://developers.google.com/workspace/drive/api/guides/configure-mcp-server)
- Documented tools: `copy_file`, `create_file`, `download_file_content`, `get_file_metadata`, `get_file_permissions`, `list_recent_files`, `read_file_content`, `search_files`. Claude.ai and Desktop setup is documented (custom connector, redirect `https://claude.ai/api/mcp/auth_callback`); Claude Code setup is not. Other notes: add `access_type=offline` if sign-in repeats every hour; service accounts with domain-wide delegation are governed by admin settings; Google warns about indirect prompt injection. — [Configure the Drive MCP server](https://developers.google.com/workspace/drive/api/guides/configure-mcp-server)
- Third-party write-ups say the server was announced around Cloud Next '26 and entered public developer preview in May 2026. They disagree on the tool set, and there is no GA announcement yet. — [Usecarly: Google Drive MCP still in preview](https://www.usecarly.com/blog/google-drive-mcp/); [Keeping.com: Google Workspace MCP servers](https://www.keeping.com/content/google-workspace-mcp/); [Workspace Updates, May 2026](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html)
- I observed the Google Drive connector attached to this Claude session directly (its tool schema, read 2026-11-15; no URL). It exposes more tools than Google's page lists: `share_file`, `update_file`, `trash_file`, `list_shared_drives`, `get_shared_drive_metadata` and `list_file_revisions` in addition to the eight above.
  - `create_file` takes `title`, `parentId`, `textContent` or `base64Content`, `contentMimeType`, and `disableConversionToGoogleType`. It accepts `pregeneratedId` from a `generate_ids` tool, and folders are created via mimeType `application/vnd.google-apps.folder`.
  - Supported content is converted to a Google type by default.
  - The schema supports a file-reference form, `sha256:<hex>:<absolute path>`, where "the app fills in the file's content once the user approves the call". This means a local PNG can be uploaded without the model typing out its base64.
  - `search_files` uses its own query dialect: `title` (not `name`), `parentId = '…'` (not `'…' in parents`), `'root'` for My Drive, and `trashed = false`.
- Claude Code can add a remote HTTP MCP server with `claude mcp add --transport http <name> <url>`. For servers without Dynamic Client Registration, pass `--client-id`, `--client-secret` and `--callback-port` (redirect URI `http://localhost:PORT/callback`) and authenticate via `/mcp` or `claude mcp login`. Scopes are local, project (`.mcp.json`) and user. claude.ai connectors also load in Claude Code, at the lowest precedence. MCP tool output is capped at 25,000 tokens by default (`MAX_MCP_OUTPUT_TOKENS`). — [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)

### Inferences
- **Simplest and most robust for a personal My Drive:** a bundled script, `scripts/drive_upload.py`, using `google-api-python-client` and `google-auth-oauthlib` with an OAuth Desktop client.
  - The user creates the client once in their own GCP project (personal use, in Testing status, as a test user).
  - The script runs `InstalledAppFlow.run_local_server()` on first use and caches `token.json` outside the repo, for example `~/.config/qa-report/`.
  - It uses `MediaFileUpload(resumable=True)`, which handles screenshots over 5 MB.
  - The library pattern is from Google's Python quickstart; I know it from prior knowledge and did not re-verify it in this session.
  - It is deterministic, works offline from the model's point of view (no image bytes go through context), and can be tested on its own.
- **Scope choice:**
  - `drive.file` avoids the restricted-scope review. But the script then cannot see a "QA" folder the user made by hand, so a name search would miss it and create a duplicate "QA".
  - Mitigation: let the script create "QA" itself the first time and save the folder ID in its config. Or accept the full `drive` scope, which is fine for a self-use Testing-mode app; the user sees an "unverified app" warning.
- **Service account:** only if the team already uses a Shared Drive. Share the Shared Drive with the SA, and pass `supportsAllDrives=true` on calls (plus `includeItemsFromAllDrives=true` on list calls). Avoid it for a personal My Drive.
- **rclone:** a good zero-code path. The skill script runs `rclone copy ./out "gdrive:QA/2026-11-15 Checkout flow"`, which creates the nested folders implicitly. Caveats: the user must create their own client ID (the shared one is being retired during 2026), and Drive allows duplicate folder names, so concurrent runs could duplicate folders. Folder names with spaces are fine if quoted.
- **Drive MCP (Google official or the claude.ai connector):** acceptable for creating the folders and a handful of files, especially in the Claude desktop app, where file references avoid base64 in context. In plain Claude Code CLI without file references, uploading a 500 KB PNG means Claude must emit about 670 KB of base64, which is on the order of hundreds of thousands of tokens per image. That is prohibitively expensive and slow. MCP is also a Developer Preview whose tool set differs between the docs and the deployed connector, so it is less stable to script against.
- **Apps Script:** viable only as a server-side receiver (a web app endpoint that accepts uploads), which adds deployment and auth. Not recommended over the direct API.
- **Known gotcha (not verified here):** OAuth clients with External user type in "Testing" publishing status have historically issued refresh tokens that expire after 7 days. This could force a weekly re-auth. Verify, or set the app to "In production" for personal use, which brings the unverified-app screen.

### Gaps
- I did not confirm on an official Google Drive API page the statement that service accounts have no storage quota. It comes from consistent forum and vendor reports, and the 2025-04-15 date is unverified.
- Unknown: whether a `drive.file`-scoped app (including the Drive MCP, which uses `drive.file` plus `drive.readonly`) can create a child inside a folder the user created manually, when it knows the folder ID but did not create or open that folder. Test this before relying on MCP to write into an existing "QA" folder.
- I could not verify the 7-day refresh-token expiry for Testing-mode OAuth apps in this session.
- Google's page lacks parameter-level docs for the Drive MCP's `create_file`, such as size limits for `base64Content`. The deployed connector schema marks `mimeType` as deprecated "DO NOT USE" while also saying folders are created "by setting the mime type", which is ambiguous between `mimeType` and `contentMimeType`.

## Q4. How do you find or create "QA" and then "<YYYY-MM-DD> <topic>" idempotently?

### Takeaway
Drive identifies files by ID, not by path, and allows duplicate names. So "find-or-create" has to search first and create only on a miss, scoped by parent and excluding trashed items. Store the resulting IDs so later runs don't depend on search.

### Cited Findings
- Query syntax goes in the `q` parameter. Folders are matched with `mimeType = 'application/vnd.google-apps.folder'`, exact names with `name = 'QA'`, children with `'PARENT_ID' in parents`, and trash is excluded with `trashed = false`. Clauses combine with `and`. Escape apostrophes and backslashes in names with a backslash, for example `name contains 'quinn\'s paper\\essay'`. — [Drive API: Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files)
- Use `fields: 'nextPageToken, files(id, name)'` to limit the response, and `spaces: 'drive'`. For Shared Drives, set `supportsAllDrives` and `includeItemsFromAllDrives` to true. Narrow `corpora` if `incompleteSearch` comes back true. — [Drive API: Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files)
- Drive permits duplicate file and folder names, unlike most storage systems. — [rclone Drive docs](https://rclone.org/drive/)
- The Drive MCP connector observed in this session supports `pregeneratedId` (from `generate_ids`) for folders and binary files. That makes a retried create land on the same ID instead of creating a duplicate. Its search dialect uses `title = 'QA' and mimeType = 'application/vnd.google-apps.folder' and parentId = 'root' and trashed = false`. — (observed tool schema, this session)

### Inferences
- Recommended algorithm, all inside the upload script:
  1. Load cached `qa_root_id` from config. If it is missing, or `files.get` shows it trashed or deleted, query `name = 'QA' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`. If more than one result comes back, pick the oldest by `createdTime` and warn. If none, `files.create({name:'QA', mimeType:'application/vnd.google-apps.folder', parents:['root']})`. Cache the ID.
  2. Child folder name `f"{date.today().isoformat()} {topic}"`, for example `2026-11-15 Checkout flow`. ISO dates sort chronologically in Drive's name sort. Query `name = '<escaped>' and mimeType = '…folder' and '<qa_root_id>' in parents and trashed = false`. Reuse the folder if it exists (a same-day re-run), or create it.
  3. On a re-run into an existing run folder, either overwrite files (`files.update` with new media, keeping the same file ID and share link) or suffix the run folder (`… (2)`). Updating by ID is the more idempotent choice.
  4. Optionally tag created folders with `appProperties` (for example `{"qa_run":"2026-11-15_checkout-flow"}`) and search with `appProperties has { key='qa_run' and value='…' }`. This is robust to renames by humans. The syntax is from prior knowledge of the Drive v3 search docs and was not re-verified in this session.
- `files.generateIds` plus create-with-id is the strongest guard against duplicate folders when a create call times out and gets retried.

### Gaps
- Drive search can lag briefly after a create; consistency is not documented on the search page. For back-to-back runs, rely on cached IDs rather than immediate re-search. This is an inference.

## Q5. How should the Claude Code skill be structured, and should it be a skill, a plugin or a standalone CLI? What input format should scenarios use?

### Takeaway
Build it as a Claude Code skill whose `SKILL.md` is a short orchestration checklist, with bundled deterministic scripts doing the heavy lifting:
- report rendering (HTML, then PDF)
- Drive upload with find-or-create
- validation of results

Claude's job is only to drive the browser through scenarios and judge pass/fail from screenshots. Start as a personal or project skill. Promote it to a plugin only when you need to ship it with an MCP config, hooks or agents to teammates, or as a versioned release. Write scenarios as a small YAML file using Gherkin-style Given/When/Then fields plus an explicit `expected` field.

### Cited Findings
- A skill is a directory with a required `SKILL.md` (YAML frontmatter plus Markdown) and optional supporting files such as `reference.md`, `examples.md` and `scripts/helper.py`. Scripts are "executed, not loaded", so their contents do not consume context. — [Claude Code docs: Skills](https://code.claude.com/docs/en/skills)
- Locations: personal `~/.claude/skills/<name>/SKILL.md`, project `.claude/skills/<name>/SKILL.md` (commit it to share), nested `<subdir>/.claude/skills/…`, plugin `<plugin>/skills/<name>/SKILL.md` (invoked as `/plugin-name:skill-name`), and enterprise managed. — [Claude Code docs: Skills](https://code.claude.com/docs/en/skills)
- Frontmatter fields in Claude Code: `name`, `description` (with `when_to_use`, truncated at 1,536 characters in the listing), `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths` and `shell`. Outside Claude Code (claude.ai uploads, the Skills API), only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are accepted. Claude Code skills follow the open Agent Skills standard (agentskills.io). — [Claude Code docs: Skills](https://code.claude.com/docs/en/skills)
- Substitutions: `$ARGUMENTS`, `$0`/`$1`, named `$arg`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_EFFORT}`. Example of running a bundled script without a permission prompt: `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)`. Dynamic context: `` !`command` `` runs before Claude sees the skill, and a failing command aborts the invocation. — [Claude Code docs: Skills](https://code.claude.com/docs/en/skills)
- Custom slash commands have merged into skills: `.claude/commands/x.md` still works, and `.claude/skills/x/SKILL.md` adds supporting files and model invocation. — [Claude Code docs: Skills](https://code.claude.com/docs/en/skills)
- Size and cost guidance: only names and descriptions are preloaded, and the body loads on invocation, then "stays in context across turns". "Keep `SKILL.md` under 500 lines." Keep references one level deep from SKILL.md, and add a table of contents to reference files over 100 lines. — [Claude Code docs: Skills](https://code.claude.com/docs/en/skills); [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Best-practice rules relevant here, all from the same source — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):
  - `name`: 64 characters max, lowercase letters, digits and hyphens only, and no reserved words "anthropic" or "claude". Gerund names are suggested, for example `running-visual-qa`.
  - `description`: 1,024 characters max, written in the third person, saying both what the skill does and when to use it.
  - Use "low freedom" exact scripts for fragile, sequence-critical operations such as uploads.
  - Prefer scripts for deterministic operations.
  - "Solve, don't defer": scripts should handle errors themselves.
  - Use a "plan-validate-execute" flow with verbose validators.
  - Give a checklist workflow that Claude copies and checks off.
  - Use fully qualified MCP tool names (`ServerName:tool_name`).
  - Declare package dependencies explicitly.
  - Build at least three evals before writing extensive docs.
- Plugins: "Use a plugin when you want several skills, subagents, hooks, or MCP servers packaged as one unit." Manifest at `.claude-plugin/plugin.json`, with components `skills/`, `agents/`, `hooks/hooks.json` and `.mcp.json`. Test locally with `--plugin-dir`, and distribute via a marketplace (`.claude-plugin/marketplace.json`). An enabled plugin's skill and agent descriptions are in context on every turn, and its MCP servers run in every session where it is enabled. — [Claude Code docs: Plugins](https://code.claude.com/docs/en/plugins)
- Gherkin: `Feature`, `Rule`, `Scenario`/`Example`, `Given` (known starting state), `When` (action or event), `Then` (an observable expected outcome, not internal state), `And`/`But`, `Background`, and `Scenario Outline` with `Examples`. The recommendation is about 3–5 steps per scenario. — [Cucumber Gherkin reference](https://cucumber.io/docs/gherkin/reference/)

### Inferences
- **Suggested layout** (project skill at `.claude/skills/visual-qa/`, or `~/.claude/skills/visual-qa/` for personal use):
  ```
  visual-qa/
    SKILL.md                    # ~80-150 lines: trigger description, checklist, exact commands
    reference/scenario-format.md
    reference/drive-setup.md    # one-time OAuth client setup, loaded only when auth fails
    templates/report.html.j2    # self-contained template (inline CSS, data-URI images)
    scripts/validate_scenarios.py   # schema-check input YAML; verbose errors
    scripts/build_report.py     # results.json + screenshots -> report.html (data URIs) -> report.pdf (Playwright)
    scripts/drive_upload.py     # find-or-create QA/<date topic>, resumable uploads, prints folder URL
  ```
- **Frontmatter sketch:**
  - `name: visual-qa`
  - `description:` "Runs browser test scenarios, captures screenshots, assesses pass/fail, and publishes a report (HTML + PDF) to Google Drive under QA/<date> <topic>. Use when the user asks for visual QA, a QA report, or to check scenarios in the browser."
  - `argument-hint: [scenarios.yaml] [topic]`
  - `allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/* *)`
- **Division of labor:**
  - Claude: read the scenarios, drive the browser (via whatever browser tool or Playwright MCP the parallel research picks), take each screenshot to `out/screenshots/NN-slug.png`, look at it, and write `out/results.json` (`id`, `status: pass|fail|blocked`, `actual`, `notes`, `screenshot`).
  - Scripts: validate the results, render the HTML and PDF, upload, and print the Drive folder link.
  - Screenshots never pass through model output as base64.
- **Skill vs plugin vs CLI:**
  - Start as a skill. It is cheapest: one description line per turn, and the body loads only on use.
  - Make the scripts a real CLI (`python -m qa_report build|upload`) so they are testable without Claude and could run in CI.
  - Package it as a plugin only when bundling a browser MCP or Drive MCP config (`.mcp.json`), hooks, or sharing with a team. A plugin's components then load in every session where it is enabled.
- **Scenario input format:** YAML, readable by non-engineers, with Gherkin semantics.
  ```yaml
  topic: Checkout flow
  base_url: https://staging.example.com
  viewport: {width: 1280, height: 800}
  scenarios:
    - id: CO-01
      title: Guest can reach payment step
      given: Cart contains 1 item, user logged out
      when: Click "Checkout", fill shipping form with test data, click "Continue"
      then: Payment step is shown
      expected: Payment form visible with card fields and order summary showing 1 item
      screenshot: full_page   # or viewport / selector
  ```
  A Markdown table, or plain `.feature` files, are good alternatives if the team already uses Cucumber. YAML is easier for the validator script, and it separates `expected` (what the report shows) from the steps (what Claude executes).
- Add `disable-model-invocation: true` if the user wants it to run only via `/visual-qa`, because it has side effects (Drive writes).

### Gaps
- No established cross-industry convention exists for "visual QA scenario YAML". The Gherkin semantics are standard; the YAML shape above is a suggestion, not a standard.
- I did not inspect the anthropics/skills GitHub repo for an existing QA, report or Drive-upload skill to reuse.
