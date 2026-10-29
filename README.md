# dsh-font-wheel

**Hold <kbd>Ctrl</kbd> and scroll the mouse wheel anywhere in the DeepSeek Harness workspace to change the font size.**

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![build](https://img.shields.io/badge/build-no%20build%20step-success)

- Scroll up = bigger, scroll down = smaller, **1px per notch**
- A small `16px` pill follows the cursor and fades out after a second; at the ends of the range it says `已到上限` / `已到下限`
- The gesture's default action is suppressed, so the page itself never zooms
- Range follows the built-in `ui-theme` font-size specs (text 10–22px, code 10–16px, terminal 10–20px)
- Text, code and terminal move together — the exact same call the desktop app's <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> uses — and the value is persisted by `ui-theme`'s settings, so it survives a reload

[中文说明见下方](#中文说明)。

## How it works

`--dsh-content-font-size` is not yours to write. The `@deepseek-ai/dsh-client-ui-layout`
presenter pushes every theme snapshot back onto `body`:

```js
for (const [role, name] of Object.entries(FONT_SIZE_VARIABLES))
  body.style.setProperty(name, `${snapshot.fontSizes[role]}px`)
```

So poking the CSS variable directly gets overwritten on the next snapshot. This plugin
goes through the theme service instead:

```js
ctx.get("theme").adjustFontSizes(+1)   // sync snapshot → publish → async persist
```

Because it is the same entry point the built-in shortcut uses, the two never disagree.
Only when no theme service is reachable (a host without UI services, a test harness)
does it fall back to writing `--dsh-content-font-size` on `body` — there is no presenter
there to overwrite it.

The client half is a hand-written CommonJS bundle loaded through
`window.__ModuleLoader__.load({ id, factory })`. **No build step**, no bundler, no
dependencies: what you read in `lib/client.js` is what runs.

## Install

```bash
# from a local checkout (a real symlink — edits under lib/ go live on page refresh)
dsh plugin --profile desktop add link:/absolute/path/to/dsh-font-wheel

# or straight from GitHub (pnpm resolves the tarball; no git binary needed)
dsh plugin --profile desktop add github:ZX-yiyuzheluoji/dsh-font-wheel
```

Then **restart the app once**. A brand-new bundle row is inserted into the profile's
composition but is not hot-mounted in the running session (the plugin manager reports
this as `state: "restart"`); after the restart it loads normally and later edits only
need a page refresh.

Without the CLI, two manual steps are enough:

1. in the profile's `package.json`
   - add `"dsh-font-wheel": "link:/absolute/path/to/dsh-font-wheel"` to `dependencies`
   - append `"dsh-font-wheel"` to `dsh.profile.bundles`
2. run `pnpm install` inside the profile directory

The bundled helper does both and backs up the profile file first:

```bash
node tools/install-profile.mjs --dry     # show what would change
node tools/install-profile.mjs           # edit package.json + pnpm install
node tools/install-profile.mjs --file    # copy instead of link
```

## Is it alive?

Font-size changes happen in a browser event handler, so the host never sees them. The
host half therefore keeps one in-memory route the client pings on every step — handy
when you cannot look at the screen:

```bash
curl http://127.0.0.1:<dsh-web-port>/font-wheel/report
# {"ok":true,"value":{"px":16,"at":"2026-10-28T07:02:28.364Z"}}
```

Nothing is written to disk, and if the host half is absent this is just a 404.

## Tuning

Constants live at the top of `lib/client.js`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `STEP_INTERVAL_MS` | `55` | Minimum ms between two steps. A trackpad gesture fires dozens of `wheel` events; unthrottled you hit the ceiling instantly. |
| `HUD_IDLE_MS` | `1000` | How long the pill stays after the last scroll. |
| `HUD_OFFSET_Y` | `28` | Pill offset above the cursor. |
| `TEXT_VARIABLE` | `--dsh-content-font-size` | Variable written by the fallback path. |

- **Only inside the conversation area?** listen on the message container instead of
  `view` in `install()`, or bail out early with
  `if (event.target.closest("[data-...]") === null) return`.
- **Wheel only touches prose, not code/terminal?** replace
  `service.adjustFontSizes(delta)` in `stepFontSize()` with
  `service.setFontSize("text", next)` (clamp the range yourself).

## Tests

```bash
npm test        # = node test/client.smoke.mjs && node test/host.smoke.mjs
```

No browser and no install: the client bundle is evaluated against a minimal
`window` / `document` / theme-service stub, asserting listener options
(`capture`, non-`passive`), Ctrl-only matching, the prevented default, throttling,
range hints, the no-service fallback, the report ping and teardown. The host half runs
against a fake `ctx` and fake `req`/`res`: registration shape, `POST`/`GET` round-trip,
404 / 400 paths, and that disposing the effect removes the route.

## Compatibility

- Verified against DeepSeek Harness desktop on Windows; the web build uses the same
  client bundle contract.
- Primary path needs `@deepseek-ai/dsh-client-ui-theme` (settings namespace `ui-theme`).
  Without it the plugin still changes the size via the CSS variable, it just will not
  persist or sync with the settings UI.
- `dsh.client.platform` is `web`, so it loads in the browser/renderer, not in the host.

## Non-goals

- No global hotkeys are registered — `shortcuts` is left alone, so nothing competes with
  the built-in <kbd>Ctrl</kbd>+<kbd>=</kbd>.
- No other plugin's styles are touched, no theme is replaced, no model requests are made.
- The only write is the one `ui-theme` already owns.

## License

[MIT](LICENSE)

---

## 中文说明

按住 <kbd>Ctrl</kbd> 滚鼠标滚轮 → 调 DSH 工作区字号。

- 上滚放大，下滚缩小，一格 **1px**（和桌面端 <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> 同一条路）
- 字号范围沿用 `ui-theme` 的三档规格：text 档 10–22px，到边界提示「已到上限 / 已到下限」
- 光标旁边浮一个小药丸显示当前 px，1 秒后自己淡掉
- 手势期间 <kbd>Ctrl</kbd>+滚轮的默认动作被拦下，页面本身不会跟着缩放
- text / code / terminal 三档一起动，值由 `ui-theme` 的 settings 持久化，刷新后还是这个字号

### 为什么不能直接改 CSS 变量

字号变量 `--dsh-content-font-size` 是 `@deepseek-ai/dsh-client-ui-layout` 的 presenter
在每次 theme snapshot 时写回 `body` 的，**直接改会在下一次 snapshot 时被盖掉**。
所以客户端半走主题服务自己的入口：

```js
ctx.get("theme").adjustFontSizes(+1)   // 同步改内存快照 → publish → 异步落盘
```

拿不到主题服务的外壳（没有 UI 服务的宿主、测试环境）才退回直接写 `body` 的 CSS 变量——
那种环境里没有 presenter，写进去不会被覆盖。

客户端半是手写的 CJS bundle，按 `window.__ModuleLoader__.load({ id, factory })` 约定包装，
**无需构建**、零依赖。

### 安装

```bash
# 本地签出（真符号链接：改 lib/ 刷新页面即生效，不用重装）
dsh plugin --profile desktop add link:/absolute/path/to/dsh-font-wheel

# 或直接从 GitHub 装（pnpm 走 tarball，不需要 git 命令）
dsh plugin --profile desktop add github:ZX-yiyuzheluoji/dsh-font-wheel
```

装完**重启一次桌面应用**：全新的 bundle 行会写进 profile 组合，但不会热挂载到当前会话
（插件管理器会把它报成 `state: "restart"`）；重启后就正常了，之后改代码只需要刷新页面。

手工两步：profile 的 `package.json` 里 `dependencies` 加
`"dsh-font-wheel": "link:/absolute/path/to/dsh-font-wheel"`、`dsh.profile.bundles` 末尾加
`"dsh-font-wheel"`，然后在 profile 目录跑 `pnpm install`。
包里附了等价脚本，会先备份 profile 的 package.json：

```bash
node tools/install-profile.mjs --dry     # 只看会改什么
node tools/install-profile.mjs           # 改 package.json + pnpm install
node tools/install-profile.mjs --file    # 想拷一份而不是链接时
```

### 取证路由

改字号发生在浏览器的滚轮事件里，宿主看不到，所以宿主半留了一条只存内存的路由，
客户端每调一格就报一次——看不到界面的时候可以靠它确认插件真的活着：

```bash
curl http://127.0.0.1:<dsh-web-port>/font-wheel/report
# {"ok":true,"value":{"px":16,"at":"2026-10-28T07:02:28.364Z"}}
```

不落盘、不碰别的插件；没装宿主半也只是这条路由 404 而已。

### 可调的旋钮

| 常量 | 默认 | 作用 |
| --- | --- | --- |
| `STEP_INTERVAL_MS` | `55` | 两格之间最快多少毫秒；触控板一次手势会连发几十个 `wheel`，不节流会直接冲到边界 |
| `HUD_IDLE_MS` | `1000` | 浮层在最后一次滚动后保留多久 |
| `HUD_OFFSET_Y` | `28` | 浮层相对光标的竖向偏移 |
| `TEXT_VARIABLE` | `--dsh-content-font-size` | 兜底路径写的变量名 |

想改成「只在对话区生效」，把 `install()` 里的 `view.addEventListener("wheel", onWheel, options)`
换成对消息容器的监听，或 `onWheel` 开头加一句 `if (event.target.closest("[data-...]") === null) return`。
想改「滚轮只动正文、不动代码/终端」，把 `stepFontSize()` 里的 `service.adjustFontSizes(delta)`
换成 `service.setFontSize("text", 新值)`（需要自己夹范围）。

### 自检

```bash
npm test
```

不装浏览器：客户端半用最小的 `window` / `document` / 主题服务桩跑一遍（监听参数 capture +
非 passive、只认 Ctrl、默认动作被拦、节流、边界提示、无服务兜底、上报、卸载回收）；
宿主半用假的 `ctx` 和 `req`/`res` 跑注册形状、`POST`/`GET` 往返、404 / 400、卸载回收。

### 它不做什么

- 不注册全局快捷键（不占用 `shortcuts` 服务，不会和自带的 <kbd>Ctrl</kbd>+<kbd>=</kbd> 抢）
- 不改别的插件的样式、不换主题、不发模型请求
- 唯一的写入就是 `ui-theme` 本来就持有的那个字号字段