# PeroPix 3.0

**English** · [한국어](README.ko.md) · [日本語](README.ja.md)

A desktop workbench for NovelAI image generation. Lay scenes out along a **scene lane** and
run them in one go; build prompts from **blocks** and reuse them as **cards**.

Tauri 2 + React 19 (frontend) + Python FastAPI (backend, run as a sidecar).

## What you need

- **A NovelAI subscription and a Persistent API Token.** NovelAI generates the images;
  this app is the workbench in front of it. Create the token in your NovelAI account
  settings — it starts with `pst-`. Enter it under **Settings ▸ General** on first launch.
- **Generating costs Anlas.** Images that fall within your plan's free limits (resolution
  and step count) cost nothing, and the generate button always shows the current price.
- **Windows 10/11.** The WebView2 runtime is required and is usually already installed.

## Getting it

Unzip `PeroPix-<version>-win64.zip` from the releases page and run `PeroPix.exe`.

- **This is a portable app, not an installer.** It writes `data/`, `workspaces/` and
  `logs/` **next to the executable**, so unzip it somewhere writable (your Documents
  folder, another drive). Inside Program Files it fails on first launch.
- Python ships inside the package (`python/`). Nothing to install separately.
- **You can unzip several copies and run them side by side.** Each folder gets its own
  port, storage and settings. Only launching the *same* folder twice is blocked.
- To move or remove it, just move or delete the folder. Nothing is written to the registry.

## Where things are stored

Everything lives next to `PeroPix.exe`.

| Path | Contents |
|---|---|
| `workspaces/<name>/` | A workspace — tabs, scenes, prompts, and generated images under `output/` |
| `data/` | Settings, cards, gallery. **Your API token lives only in `data/secrets.json`** |
| `models/censor/` | Censoring models |
| `logs/` | Backend logs (worth attaching when you report a problem) |

Back up those folders and you have everything. Updates never touch them.

## Updates

One button under **Settings ▸ Update**. The app also checks quietly at startup and shows a
notification when a new version exists. Once downloaded, restarting applies it — the app
decides on its own whether to fetch a patch or the full package.

## Development

```bash
npm install
npm run tauri dev      # frontend (1420) + backend (8770) + window
```

To run only the backend: `python backend/server.py --port 8770`.
Dependencies are in `backend/requirements.txt`.

## Releasing

Pushing a tag makes the workflow build a **draft release**
(`.github/workflows/release.yml`).

```bash
git tag v3.0.1 && git push origin v3.0.1
```

**The tag is the source of truth for the version** — the build rewrites
`tauri.conf.json` and `package.json` to match it. To only check that a build passes, run
the workflow manually from Actions; that path uploads artifacts and creates no release.

Three assets are uploaded, and **the app's auto-update reads all three**
(`backend/update.py`).

| Asset | What it is |
|---|---|
| `PeroPix-<version>-win64.zip` | Full package (~130MB, including Python and the censor model) |
| `patch-<version>.zip` | Patch (~35MB — the executable plus `backend/`); what updates normally fetch |
| `patch-info.json` | The basis for choosing patch vs. full |

- **Releases arrive as drafts.** You have to publish one for it to reach users. And
  **marking it as a pre-release hides it from the app** — GitHub's `releases/latest` skips
  drafts and pre-releases. Put the other way round: pre-releases are safe to create.
- If `backend/requirements.txt` or `models/censor` changed, the workflow marks the release
  `requires_full` and the app fetches the full package instead. **The user is never asked** —
  they only see the download size.

## Censoring models

Drop `*.onnx` files into `models/censor/` and the app lists them; the **lightest** one is
the default. Only the 40MB model is committed here — the 239MB one exceeds GitHub's 100MB
file limit and is kept separately.

## License

**AGPL-3.0-or-later** (full text in `LICENSE`).

Use it, read it, change it — freely. The conditions apply when you **pass it on**: if you
distribute a modified version, or **run one where others can use it over a network**, you
must release that source under the same terms. (The network clause is what AGPL adds over
GPL, and it genuinely applies here because the backend is an HTTP server.)

Using or modifying it **for yourself carries no obligations at all**.

Third-party components bundled with the app, and their terms, are listed in
**`THIRD-PARTY.md`** — the censor model (which is where the AGPL requirement comes from),
the tag dictionary, embedded Python, and the Python packages. None of them conflict with
AGPL.
