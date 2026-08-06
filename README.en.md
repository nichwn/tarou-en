# Tarou EN

An English build of [Tarou](https://github.com/Waaatanuki/Chrome-Extension-Tarou), a
companion extension for the browser version of Granblue Fantasy.

Upstream is Chinese-only and actively developed (three releases in the five weeks to
2026-07-30). This fork adds an English layer **without modifying a single upstream
file**, so it can follow upstream automatically.

## How it works

`src/` is byte-identical to upstream. English lives in `i18n/` and is applied by a
Vite plugin during the build:

| File | Role |
|---|---|
| `i18n/glossary.en.json` | Chinese literal → English. The UI. |
| `i18n/terminology.json` | Japanese → English game terms, pulled from gbf.wiki's Cargo API. |
| `i18n/denylist.json` | Literals that are **compared against game data**, never displayed. Translating these breaks features silently. |
| `i18n/overrides.json` | Non-CJK literals we repoint, e.g. the changelog URL. |

Because no upstream file changes, `git merge upstream/main` cannot conflict — which
is what makes unattended syncing safe. A string with no glossary entry simply renders
in Chinese; it never breaks the build.

## Install

```bash
git clone https://github.com/nichwn/tarou-en.git && cd tarou-en
pnpm install
cd tools && pnpm install --ignore-workspace && cd ..   # --ignore-workspace is required
pnpm exec vite build --mode production --config vite.config.en.mts
pnpm exec tsx scripts/prepare.ts
pnpm exec vite build --config vite.config.content.en.mts
pnpm exec vite build --config vite.config.inject.en.mts
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `dist/`.

## Staying current

The `tarou_watch` job in [claude-scheduler](https://github.com/nichwn/claude-scheduler)
runs daily. On a new upstream tag it merges, translates only the new strings, runs the
gates, publishes the build, and emails the English changelog.

Chrome does not hot-reload unpacked extensions, so after a sync click **Reload** on
`chrome://extensions` (or restart the browser). Self-hosted auto-update would need CRX
signing plus an enterprise policy allowlist — disproportionate for one click.

To sync by hand:

```bash
pnpm exec tsx tools/src/sync-upstream.ts            # or --dry-run to just check
```

Gates, all of which must pass before the installed build is replaced: the tools test
suite, the production build, `vue-tsc --noEmit`, and a residual-CJK budget check.
Publication is an atomic rename, and the previous build is kept as `.prev`.

## A note on what the extension sends

Upstream Tarou POSTs drop data, boss `start.json` data, optional build uploads, and
your **GBF player uid** to `itsuki.icu`, its drop-statistics backend. The `code` header
it sends is *not* your account transfer code — `useUser.ts` generates it locally as a
UUID v4.

To disable that, point `VITE_APP_BASE_API` in `.env.production` somewhere else. That
file is not under `src/`, so editing it preserves the zero-diff property. The
drop-statistics features stop working if you do.

The extension also requests Chrome's `debugger` permission, which it uses to enable
`Network.enable` on the game tab and read responses. Chrome will show a "started
debugging this browser" banner.

## Terms of service

Tarou is an unofficial tool. Cygames has [stated](https://x.com/granblue_en/status/1353746916572467200)
that it does not ban for standard browser extensions and acts against automation,
falsified information, and revealing unpublished data. Upstream's own position is
narrower than a guarantee: *"not modifying game data, not affecting game UI, not
providing in-game automation — final interpretation rests with the officials."*
Translation changes none of that risk profile in either direction.
