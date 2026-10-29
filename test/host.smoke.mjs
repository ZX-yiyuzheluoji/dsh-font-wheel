/**
 * 宿主半自检：用假的 ctx / webServer / req / res 把 lib/index.js 跑一遍。
 *
 *   node test/host.smoke.mjs
 *
 * 覆盖：导出形状（inject / apply）、注册姿势（kind=prefix + 路径）、
 *      路由回收、POST 报告 → GET 读回、未知路由 404、超大请求体 400、
 *      非法 JSON 400。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const ENTRY = pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href

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

function makeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.destroy = () => {}
  // 下一个 tick 再发数据，跟真实流的行为一致
  setTimeout(() => {
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'))
    req.emit('end')
  }, 0)
  return req
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    end(chunk) { this.body = String(chunk ?? '') },
  }
  return res
}

const call = async (handler, method, url, body) => {
  const res = makeRes()
  await handler(makeReq(method, url, body), res)
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) }
}

const module_ = await import(ENTRY)

console.log('dsh-font-wheel host smoke')

ok('导出 inject 声明 webServer', Array.isArray(module_.inject) && module_.inject.includes('webServer'), module_.inject)
ok('导出 apply 是函数', typeof module_.apply === 'function')

const effects = []
const registrations = []
const ctx = {
  logger: { warn() {}, info() {} },
  effect(fn, label) { effects.push({ label, dispose: fn() }) },
  webServer: {
    register(spec) {
      registrations.push(spec)
      return () => { spec.disposed = true }
    },
  },
}

module_.apply(ctx)

ok('注册了一个效果', effects.length === 1, effects.length)
ok('注册了一条路由', registrations.length === 1, registrations.length)
const route = registrations[0]
ok('路由是 prefix 类型', route?.kind === 'prefix', route?.kind)
ok('路由前缀是 /font-wheel', route?.path === '/font-wheel', route?.path)
ok('带 handler', typeof route?.handler === 'function')

{
  const empty = await call(route.handler, 'GET', '/font-wheel/report')
  ok('还没有报告时 GET 返回 null', empty.status === 200 && empty.json.value === null, empty.json)

  const posted = await call(route.handler, 'POST', '/font-wheel/report', { px: 16, at: '2026-10-28T06:45:12.118Z' })
  ok('POST 报告被接受', posted.status === 200 && posted.json.ok === true, posted.json)
  ok('POST 返回记录下来的 px', posted.json.value?.px === 16, posted.json.value)
  ok('响应是 no-store 的 JSON', posted.headers['cache-control'] === 'no-store' && String(posted.headers['content-type']).includes('application/json'))

  const read = await call(route.handler, 'GET', '/font-wheel/report')
  ok('GET 读回最近一次', read.json.value?.px === 16 && read.json.value?.at === '2026-10-28T06:45:12.118Z', read.json.value)
}

{
  const missing = await call(route.handler, 'GET', '/font-wheel/nope')
  ok('未知路由 404', missing.status === 404 && missing.json.error?.code === 'not-found', missing.json)
}

{
  const bad = await call(route.handler, 'POST', '/font-wheel/report', '{not json')
  ok('非法 JSON 400', bad.status === 400 && bad.json.error?.code === 'bad-request', bad.json)
}

{
  const huge = await call(route.handler, 'POST', '/font-wheel/report', 'x'.repeat(9000))
  ok('超大请求体 400', huge.status === 400, huge.status)
}

{
  // 卸载时路由要被撤掉
  effects[0].dispose()
  ok('卸载后 route.dispose 被调用', route.disposed === true)
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(failures.map((label) => ` - ${label}`).join('\n'))
  process.exitCode = 1
}