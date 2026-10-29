/**
 * dsh-font-wheel — 宿主半（Host half）。
 *
 * 真正改字号的是客户端半 → ui-theme 的 settings 写入，宿主这边不参与。
 * 这里只留一条内存里的取证路由：
 *   POST /font-wheel/report  { px, at }  ← 客户端每调一格就报一次
 *   GET  /font-wheel/report             → 最近一次报告
 *
 * 为什么留它：改字号发生在浏览器的滚轮事件里，宿主侧看不到；
 * 有一条「刚改到几 px」的记录，就能在不开界面的时候确认插件真的活着、
 * 手势真的落地了。只存内存，不落盘，不碰任何别的插件。
 */
const PACKAGE_ID = 'dsh-font-wheel'
/** 取证路由前缀；客户端半请求 <base>/font-wheel/report。 */
const ROUTE_PREFIX = '/font-wheel'
/** 小请求体上限，够放下一次报告。 */
const MAX_BODY_BYTES = 8 * 1024

/** 需要 webServer 才能挂路由；没它插件就安静地待着（客户端半照常工作）。 */
export const inject = ['webServer']

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader?.('content-type', 'application/json; charset=utf-8')
  res.setHeader?.('cache-control', 'no-store')
  res.end?.(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节`))
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${error?.message ?? error}`))
      }
    })
  })
}

export function apply(ctx) {
  /** 最近一次报告（只存内存）。 */
  let last = null

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
        try {
          if (route === '/report' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, value: last })
            return
          }
          if (route === '/report' && req.method === 'POST') {
            const body = await readJsonBody(req)
            const px = Number.parseInt(body?.px, 10)
            last = {
              px: Number.isInteger(px) ? px : null,
              at: typeof body?.at === 'string' ? body.at : new Date().toISOString(),
            }
            sendJson(res, 200, { ok: true, value: last })
            return
          }
          sendJson(res, 404, {
            ok: false,
            error: { code: 'not-found', message: `没有这个路由：${req.method} ${route}` },
          })
        } catch (error) {
          ctx.logger?.warn?.(`${PACKAGE_ID}: ${req.method} ${route} 失败`, error)
          sendJson(res, 400, {
            ok: false,
            error: { code: 'bad-request', message: error?.message ?? String(error) },
          })
        }
      },
    }),
    `${PACKAGE_ID}: report route`,
  )
}