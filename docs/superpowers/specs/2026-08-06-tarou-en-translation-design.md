# Tarou EN — English translation layer with unattended upstream sync

**Date:** 2026-08-06
**Status:** Approved
**Upstream:** [Waaatanuki/Chrome-Extension-Tarou](https://github.com/Waaatanuki/Chrome-Extension-Tarou) @ 3.7.1

## Problem

Tarou is the most actively maintained Granblue Fantasy companion extension (three
tagged releases in the five weeks to 2026-07-30), but its UI is entirely Chinese:
~780 unique CJK string literals hardcoded across 82 `.vue` and 46 `.ts` files, with
no i18n framework.

We want an English build for personal use that:

1. Reads as English throughout the UI.
2. Uses Cygames' own English game terminology, not a paraphrase of the Chinese.
3. Tracks upstream automatically, translating only what changed, with an update log.

## Constraints discovered during exploration

| Finding | Consequence |
|---|---|
| No i18n framework; strings inline in templates | Translation must be applied mechanically, not via locale lookup |
| `src/logic/storage.ts:59` — `language = useWebExtensionStorage<'zh' \| 'ja'>` | A language seam exists but covers only 11 call sites, all artifact-related |
| `src/constants/skill.ts` carries 30 hand-written `comment_en` fields | The author already values idiomatic GBF English; these are our style reference |
| `src/constants/artifact.ts` stores `{ name: <JP>, nameZh: <CN> }` | Japanese originals are present in-source — enables JP→EN via gbf.wiki instead of CN→EN |
| `NpcDetail.vue:16` matches the literal `'EXリミットボーナス'` against API data | Locale-dependent matching; likely already broken on an English game client |
| `useVersionCheck.ts:34` fetches upstream `changelog.json` at runtime | Free update signal, and a Chinese string that reaches the UI at runtime |
| Chrome forbids content scripts on other extensions' `chrome-extension://` pages | A separate "translator extension" is impossible; this must be a modified build |
| `.env.production` → `https://www.itsuki.icu/api` | Extension POSTs drop data, boss `start.json`, and the GBF player `uid` to a third-party backend |
| Upstream releases build a ZIP via `.github/workflows/release.yml` on tag push | Tags are the sync trigger |

The `code` header sent to that backend is **not** the GBF account transfer code —
`useUser.ts:14` generates it locally as a UUID v4. It is Tarou's own anonymous
identifier for its drop-statistics service.

## Approach: zero-diff fork + build-time glossary substitution

`src/` is **never edited**. Every English string lives in data files outside the
upstream tree, applied by a Vite plugin during the build.

The decisive property is that `git merge upstream/main` can never conflict, which is
what makes unattended syncing safe. A pipeline that must resolve Vue merge conflicts
without supervision will eventually publish a broken build.

Rejected alternatives:

- **Full i18n refactor** (locale files + `t()` keys + language picker). Better end
  state and plausibly upstreamable, but rewrites all 82 components, so every future
  upstream release conflicts forever. Directly undermines the unattended requirement.
  Remains available later as an upstream PR.
- **Runtime DOM translation.** Flickers, misses attributes and tooltips, fights Vue's
  re-render, and still requires a fork.

### Layout

```
nichwn/tarou-en
├── src/…                              NEVER edited — byte-identical to upstream
├── i18n/
│   ├── terminology.json               gbf.wiki canon: JP → EN game terms
│   ├── glossary.en.json               CN literal → EN, the UI chrome
│   ├── overrides.json                 non-CJK literals we deliberately repoint
│   ├── denylist.json                  literals that are keys, not display text
│   └── untranslated.json              generated: strings with no entry yet
├── plugins/vite-plugin-translate.ts   the substitution transform
├── scripts/
│   ├── build-terminology.ts           pulls gbf.wiki Cargo → terminology.json
│   ├── extract-strings.ts             walks the tree for CJK literals
│   ├── translate-delta.ts             translates only new/changed strings
│   └── sync-upstream.ts               orchestrates the seven-step run
├── vite.config.en.mts                 wraps upstream config, injects the plugin
└── CHANGELOG.en.md                    appended every sync — the update log
```

`vite.config.en.mts` imports upstream's `sharedConfig` and appends our plugin, so
upstream's Vite configs stay untouched.

## Translation sources, in priority order

1. **`terminology.json` — canon.** Built from gbf.wiki's Cargo API, verified live:
   `characters(name, jpname, title, jptitle)` and `weapons(name, jpname)` return
   pairs such as `アビー → Abby`. Joined against the Japanese `name` fields already
   present in `constants/artifact.ts` and `constants/skill.ts`. Some rows have an
   empty `jpname`, so lookups must have a miss path. Terms here are authoritative and
   are never re-derived by the translator.
2. **`glossary.en.json` — UI chrome.** The ~780 interface strings. Machine-translated
   once at bootstrap using the existing `comment_en` fields as few-shot style
   examples, then frozen. Entries change only by hand.
3. **Fall-through.** No entry means no substitution: the string renders as Chinese.
   Cosmetic degradation, never functional breakage. Recorded in `untranslated.json`
   and reported in the notification.

Keying by the exact Chinese literal means an upstream *rewording* yields a new key
(translated fresh) while unchanged strings keep their existing English verbatim.

### The existing `language` toggle, without editing source

The 11 bilingual call sites read `language.value === 'zh' ? hitSkill.nameZh : hitSkill.name`,
i.e. Chinese or Japanese. An earlier draft proposed widening the union to `'en'` — but
that edits `src/logic/storage.ts` and forfeits zero-diff.

Unnecessary: the `nameZh` **values** in `constants/artifact.ts` are themselves CJK
literals, so the glossary translates them like any other string. With `nameZh` holding
English, the default `'zh'` mode renders English and the in-app toggle becomes
English ⇄ Japanese — more useful than Chinese ⇄ Japanese, achieved with zero source
diff and no type change.

### Overrides

`overrides.json` repoints non-CJK literals. The required entry:

```json
{
  "https://raw.githubusercontent.com/Waaatanuki/Chrome-Extension-Tarou/main/changelog.json":
  "https://raw.githubusercontent.com/nichwn/tarou-en/main/changelog.en.json"
}
```

so the extension's own update drawer reads our English changelog.

### Telemetry

`.env.production` is not under `src/`, so pointing `VITE_APP_BASE_API` away from
`itsuki.icu` preserves the zero-diff property. Default: leave upstream's value (the
drop-statistics features stop working without it). Documented so the choice is
deliberate.

## Sync pipeline

Runs locally as a `claude-scheduler` job (`tarou_watch`), daily. Local rather than CI
because the deliverable is an unpacked extension directory Chrome loads from disk;
CI would build in the cloud and still require a manual download.

1. **Detect** — compare upstream's latest tag to the last synced tag. No change → exit
   silently.
2. **Merge** — `git merge upstream/main`. Clean by construction; a conflict aborts the
   run and emails rather than guessing.
3. **Extract** — diff CJK literals in the new tree against the glossary → added /
   changed / removed.
4. **Translate the delta** — headless `claude -p` translates only new strings, with
   `terminology.json` pinned in the prompt for consistency. Existing entries are never
   re-translated.
5. **Verify** — `pnpm bp`, `vue-tsc --noEmit`, lint, residual-CJK scan, smoke load.
6. **Publish** — build to `dist.new`, then atomic rename into the Chrome load path, so
   a partial build can never be what Chrome reloads into.
7. **Notify** — email with the English changelog entry, version delta, newly translated
   strings, and anything left untranslated.

`CHANGELOG.en.md` is appended each run; `changelog.en.json` is written for the
in-extension update drawer.

**Not automatable:** Chrome does not hot-reload unpacked extensions. One manual
Reload click on `chrome://extensions` after each sync, or it applies on next browser
restart. Self-hosted CRX auto-update would require signing plus an enterprise policy
allowlist — disproportionate machinery for one click.

## Verification

The pipeline's contract: **never break a working install.** The installed `dist/` is
replaced only after every gate passes.

- **Typecheck and lint** — `vue-tsc --noEmit` on the transformed sources. Never piped;
  gate on true exit status.
- **Residual-CJK scan** — count remaining CJK characters in `dist/`. The regression
  signal: a release adding 40 strings should raise the count, and the email says so.
- **Literal-safety guard** — substitution only occurs for literals present in the
  glossary, and glossary keys are validated against `denylist.json` (storage keys, API
  paths, `nameZh` values used in comparisons). A string is never translated where
  Tarou compares it.
- **Smoke load** — load the built extension in headless Chrome over CDP; assert the
  side panel mounts with no console errors. Catches transforms that produce
  syntactically valid but semantically wrong JS.

**Accepted limitation:** correctness-in-context cannot be verified automatically, only
presence and buildability. The first run after a large upstream feature warrants a
manual look.

## Out of scope

- Upstreaming the i18n refactor (possible follow-up, not this work).
- Translating gbf.wiki content itself, or any runtime JP→EN mapping of game data — the
  game client is set to English, so game data already arrives in English.
- Fixing upstream's locale-dependent matching beyond the artifact call sites (e.g. the
  `'EXリミットボーナス'` lookup). Noted as a known upstream bug on English clients.
