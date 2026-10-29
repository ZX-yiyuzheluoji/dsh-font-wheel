/**
 * 客户端半自检：不装浏览器，用最小 window / document / 主题服务桩把 bundle 跑一遍。
 *
 *   node test/client.smoke.mjs
 *
 * 覆盖：bundle 包装与导出、wheel 监听参数（capture + 非 passive）、
 *      只认 Ctrl+滚轮、默认动作被拦下、一步 1px、节流、到边界的提示、
 *      没有主题服务时退回直接写 CSS 变量、宿主取证路由的上报、
 *      以及卸载时监听器 / 浮层 / body 属性全部回收。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const CLIENT = new URL('../lib/client.js', import.meta.url)
const PACKAGE_ID = 'dsh-font-wheel'
const HUD_ROLE = 'font-wheel-hud'
const TEXT_VARIABLE = '--dsh-content-font-size'

let passed = 0
const failures = []
function ok(label, cond, extra) {
  if (cond === true) {
    passed += 1
    console.log(`  ok   ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` \u2192 ${JSON.stringify(extra)}`}`)
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class El {
  constructor(tag) {
    this.tagName = tag
    this.attrs = {}
    this.children = []
    this._text = ''
    this.parent = null
    this.removed = false
    this.style = {
      _props: {},
      setProperty(name, value) { this._props[name] = String(value) },
      getPropertyValue(name) { return this._props[name] ?? '' },
      removeProperty(name) { delete this._props[name] },
    }
  }
  set textContent(value) { this._text = String(value) }
  get textContent() { return this._text }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] ?? null }
  removeAttribute(name) { delete this.attrs[name] }
  appendChild(child) { child.parent = this; this.children.push(child); return child }
  remove() {
    this.removed = true
    if (this.parent !== null) this.parent.children = this.parent.children.filter((node) => node !== this)
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]) }
}

/** 主题服务桩：行为和真 ThemeRuntime 对齐——同步改快照、各自夹在范围内。 */
const LIMITS = { text: [10, 22], code: [10, 16], terminal: [10, 20] }
function makeTheme(initialText = 14) {
  const calls = []
  const fontSizes = { text: initialText, code: 11, terminal: 13 }
  return {
    calls,
    fontSizes,
    getTheme() {
      return { fontSizes: { ...fontSizes } }
    },
    adjustFontSizes(delta) {
      calls.push(delta)
      for (const role of ['text', 'code', 'terminal']) {
        const [min, max] = LIMITS[role]
        fontSizes[role] = Math.max(min, Math.min(max, fontSizes[role] + delta))
      }
    },
  }
}

function makeCtx(theme) {
  const effects = []
  const ctx = {
    effects,
    get(name) { return name === 'theme' ? theme : undefined },
    effect(fn, label) {
      effects.push({ label, dispose: fn() })
    },
  }
  return ctx
}

async function bootstrap(options = {}) {
  const spec = { value: null }
  const listeners = new Map()
  const fetchCalls = []
  const body = new El('body')
  const document = {
    baseURI: options.baseURI ?? 'http://127.0.0.1:57337/',
    body,
    createElement(tag) { return new El(tag) },
  }
  const window = {
    __ModuleLoader__: {
      load(value) { spec.value = value },
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(type, fn, opts) { listeners.set(type, { fn, opts }) },
    removeEventListener(type, fn) {
      const current = listeners.get(type)
      if (current !== undefined && current.fn === fn) listeners.delete(type)
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), method: init.method ?? 'GET', body: init.body })
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    },
  }
  globalThis.window = window
  globalThis.document = document
  ;(0, eval)(await readFile(CLIENT, 'utf8'))
  assert.ok(spec.value !== null, 'bundle 应该调用 window.__ModuleLoader__.load')
  const exports_ = spec.value.factory(() => {
    throw new Error('这个 bundle 不该 require 任何模块')
  })
  return { spec: spec.value, exports: exports_, listeners, fetchCalls, body, document, window }
}

/** 派发一次 wheel；返回默认动作有没有被拦下。 */
function wheel(listeners, props = {}) {
  const entry = listeners.get('wheel')
  assert.ok(entry !== undefined, 'wheel 监听器应该装上')
  let prevented = false
  entry.fn({
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    deltaY: -1,
    clientX: 400,
    clientY: 300,
    preventDefault() { prevented = true },
    ...props,
  })
  return prevented
}

const hudOf = (body) => body.children.find((node) => node.attrs['data-role'] === HUD_ROLE)

console.log(`${PACKAGE_ID} client smoke`)

// 1. 包装 / 导出
{
  const { spec, exports: api } = await bootstrap()
  ok('module id 与包名一致', spec.id === PACKAGE_ID, spec.id)
  ok('导出 apply 是函数', typeof api.apply === 'function')
  ok('导出 inject 是空数组', Array.isArray(api.inject) && api.inject.length === 0, api.inject)
}

// 2. 监听参数 + 步进 + 浮层
{
  const theme = makeTheme(14)
  const ctx = makeCtx(theme)
  const host = await bootstrap()
  host.exports.apply(ctx)
  const entry = host.listeners.get('wheel')
  ok('装上了 wheel 监听', entry !== undefined)
  ok('capture 阶段抢在宿主前面', entry.opts?.capture === true, entry.opts)
  ok('passive:false（否则 preventDefault 无效）', entry.opts?.passive === false, entry.opts)
  ok('body 上留了插件在场标记', host.body.attrs['data-dsh-font-wheel'] !== undefined)

  const prevented = wheel(host.listeners, { deltaY: -120 })
  ok('Ctrl+上滚改大一档', theme.calls.length === 1 && theme.calls[0] === 1, theme.calls)
  ok('默认动作被拦下（页面不会自己缩放）', prevented === true)
  const hud = hudOf(host.body)
  ok('浮层出现并显示新字号', hud !== undefined && hud.textContent === '15px', hud?.textContent)
  ok('浮层是 pointer-events:none（不挡手）', hud?.style.getPropertyValue('pointer-events') === 'none')
  ok('浮层落在光标上方', hud?.style.getPropertyValue('top') === '272px', hud?.style.getPropertyValue('top'))

  await sleep(80)
  wheel(host.listeners, { deltaY: 120, clientY: 300 })
  ok('Ctrl+下滚改小一档', theme.calls.length === 2 && theme.calls[1] === -1, theme.calls)
  ok('浮层跟着下滚更新', hudOf(host.body)?.textContent === '14px', hudOf(host.body)?.textContent)
}

// 3. 只认 Ctrl+滚轮
{
  const theme = makeTheme(14)
  const ctx = makeCtx(theme)
  const host = await bootstrap()
  host.exports.apply(ctx)

  let prevented = wheel(host.listeners, { ctrlKey: false })
  ok('不按 Ctrl 不抢', theme.calls.length === 0 && prevented === false)
  prevented = wheel(host.listeners, { shiftKey: true })
  ok('Ctrl+Shift 让给别人', theme.calls.length === 0 && prevented === false)
  prevented = wheel(host.listeners, { altKey: true })
  ok('Ctrl+Alt 让给别人', theme.calls.length === 0 && prevented === false)
  prevented = wheel(host.listeners, { deltaY: 0 })
  ok('deltaY=0 不算一格', theme.calls.length === 0 && prevented === false)
  ok('没动过就不该有浮层', hudOf(host.body) === undefined)
}

// 4. 节流：一口气连发只走一格
{
  const theme = makeTheme(14)
  const ctx = makeCtx(theme)
  const host = await bootstrap()
  host.exports.apply(ctx)

  wheel(host.listeners, { deltaY: -120 })
  wheel(host.listeners, { deltaY: -120 })
  wheel(host.listeners, { deltaY: -120 })
  ok('同一口气里只算一步', theme.calls.length === 1, theme.calls)
  await sleep(80)
  wheel(host.listeners, { deltaY: -120 })
  ok('隔开之后再来一格', theme.calls.length === 2, theme.calls)
}

// 5. 到边界：不改值，但要说清楚
{
  const theme = makeTheme(22)
  const ctx = makeCtx(theme)
  const host = await bootstrap()
  host.exports.apply(ctx)
  wheel(host.listeners, { deltaY: -120 })
  ok('到上限时字号不动', theme.fontSizes.text === 22, theme.fontSizes.text)
  ok('到上限时有提示', hudOf(host.body)?.textContent === '22px \u00b7 已到上限', hudOf(host.body)?.textContent)

  const lowTheme = makeTheme(10)
  const lowCtx = makeCtx(lowTheme)
  const lowHost = await bootstrap()
  lowHost.exports.apply(lowCtx)
  wheel(lowHost.listeners, { deltaY: 120 })
  ok('到下限时有提示', hudOf(lowHost.body)?.textContent === '10px \u00b7 已到下限', hudOf(lowHost.body)?.textContent)
}

// 6. 没有主题服务：退回直接写 CSS 变量
{
  const ctx = makeCtx(undefined)
  const host = await bootstrap()
  host.exports.apply(ctx)
  wheel(host.listeners, { deltaY: -120 })
  ok('兜底读默认值并 +1', host.body.style.getPropertyValue(TEXT_VARIABLE) === '15px', host.body.style.getPropertyValue(TEXT_VARIABLE))
  await sleep(80)
  wheel(host.listeners, { deltaY: 120 })
  ok('兜底 -1', host.body.style.getPropertyValue(TEXT_VARIABLE) === '14px', host.body.style.getPropertyValue(TEXT_VARIABLE))
  ok('兜底时不碰主题服务', ctx.effects.length === 1)
}

// 7. 取证上报
{
  const theme = makeTheme(14)
  const ctx = makeCtx(theme)
  const host = await bootstrap()
  host.exports.apply(ctx)
  wheel(host.listeners, { deltaY: -120 })
  const call = host.fetchCalls[0]
  ok('每格都向宿主半报一次', host.fetchCalls.length === 1, host.fetchCalls.length)
  ok('上报路径正确', call?.url === 'http://127.0.0.1:57337/font-wheel/report', call?.url)
  ok('上报是 POST 且带 px', call?.method === 'POST' && JSON.parse(call.body).px === 15, call)
}

// 8. 卸载：监听器 / 浮层 / body 属性全部回收
{
  const theme = makeTheme(14)
  const ctx = makeCtx(theme)
  const host = await bootstrap()
  host.exports.apply(ctx)
  wheel(host.listeners, { deltaY: -120 })
  ok('卸载前浮层在', hudOf(host.body) !== undefined)
  ctx.effects[0].dispose()
  ok('监听器被摘掉', host.listeners.size === 0)
  ok('浮层被移除', hudOf(host.body) === undefined)
  ok('body 标记被还原', host.body.attrs['data-dsh-font-wheel'] === undefined)
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(failures.map((label) => ` - ${label}`).join('\n'))
  process.exitCode = 1
}