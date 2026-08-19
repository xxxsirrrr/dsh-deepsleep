/**
 * LAN -> dsh web (appliance server on 127.0.0.1:3080) password-gated proxy.
 *
 *   phone -> 0.0.0.0:3082 (this proxy, password required) -> 127.0.0.1:3080
 *
 * Unauthenticated requests get a minimal login page; a correct password
 * sets an HttpOnly session cookie, after which the browser's page, assets,
 * /api RPCs, SSE, and WebSocket downlinks all pass through with the Host
 * header rewritten to the loopback authority (so the appliance server's
 * /api trust fence — started without --trusted-host — accepts them).
 *
 * Password source (first match wins):
 *   1. env DSH_MOBILE_PASSWORD
 *   2. first line of ./proxy-password.txt (next to this script)
 * No password configured -> the process refuses to start.
 *
 * ⚠️ Plain HTTP: the password travels unencrypted over the LAN. This keeps
 * casual bystanders out, but is not real transport security — run only on
 * networks you trust (or front with Tailscale/HTTPS for stronger protection).
 */
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET_HOST = '127.0.0.1'
const COOKIE_NAME = 'dsh_mobile_token'
const AUTH_PATH = '/__auth'

const here = path.dirname(fileURLToPath(import.meta.url))
const PASSWORD_FILE = path.join(here, 'proxy-password.txt')
const PORT_FILE = path.join(here, 'proxy-port.txt')

/**
 * Listen-port resolution (first match wins):
 *   1. env DSH_MOBILE_PORT
 *   2. first line of ./proxy-port.txt
 *   3. default 3082
 */
function readListenPort() {
  if (process.env.DSH_MOBILE_PORT) {
    const fromEnv = Number(process.env.DSH_MOBILE_PORT)
    if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv
  }
  if (fs.existsSync(PORT_FILE)) {
    const fromFile = Number(fs.readFileSync(PORT_FILE, 'utf8').trim())
    if (Number.isInteger(fromFile) && fromFile > 0 && fromFile < 65536) return fromFile
  }
  return 3082
}

const LISTEN_PORT = readListenPort()
const TARGET_PORT = Number(process.env.DSH_WEB_PORT) || 3080

function loadPassword() {
  if (process.env.DSH_MOBILE_PASSWORD) return process.env.DSH_MOBILE_PASSWORD
  if (fs.existsSync(PASSWORD_FILE)) {
    const first = fs.readFileSync(PASSWORD_FILE, 'utf8').split(/\r?\n/)[0].trim()
    if (first) return first
  }
  throw new Error(
    `no password configured — create ${PASSWORD_FILE} with the password on its first line, or set DSH_MOBILE_PASSWORD`,
  )
}

const password = loadPassword()
const token = crypto.createHmac('sha256', password).update('dsh-mobile-session-v1').digest('hex')

function cookieFrom(req) {
  const header = req.headers.cookie ?? ''
  const entry = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE_NAME + '='))
  return entry ? entry.slice(COOKIE_NAME.length + 1) : undefined
}

function isAuthed(req) {
  const value = cookieFrom(req)
  if (value === undefined || value.length !== token.length) return false
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(token))
}

function setCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
  )
}

function rewriteHeaders(raw) {
  const headers = { ...raw }
  headers.host = `${TARGET_HOST}:${TARGET_PORT}`
  delete headers.origin
  delete headers['sec-fetch-site']
  delete headers['sec-fetch-mode']
  delete headers['sec-fetch-dest']
  return headers
}

const LOGIN_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 登录</title>
<style>
  body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: #0b1220; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8edf7; }
  form { width: min(86vw, 340px); padding: 28px; border-radius: 16px;
    background: #141d30; box-shadow: 0 12px 40px rgb(0 0 0 / 0.45); display: grid; gap: 14px; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; text-align: center; }
  input { font-size: 16px; padding: 12px; border-radius: 10px; border: 1px solid #2c3a56;
    background: #0f1626; color: inherit; outline: none; }
  input:focus { border-color: #4d76d8; }
  button { font-size: 16px; padding: 12px; border: 0; border-radius: 10px;
    background: #3b6adf; color: #fff; font-weight: 600; cursor: pointer; }
  p.err { margin: 0; color: #ff7b7b; text-align: center; font-size: 14px; }
</style>
<form method="post" action="${AUTH_PATH}">
  <h1>DSH 手机访问</h1>
  <input type="password" name="password" placeholder="访问密码" autofocus autocomplete="current-password">
  <button type="submit">进入</button>
  {error}
</form>`

function loginPage(error) {
  return LOGIN_PAGE.replace('{error}', error ? `<p class="err">${error}</p>` : '')
}

function respond(htmlStatus, res, body, extraHeaders) {
  res.writeHead(htmlStatus, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders })
  res.end(body)
}

async function handleAuth(req, res) {
  if (req.method !== 'POST') return respond(405, res, loginPage())
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  const submitted = decodeURIComponent(body.split('&').find((kv) => kv.startsWith('password='))?.slice(9) ?? '')
  if (submitted === password) {
    setCookie(res)
    respond(302, res, 'ok', { location: '/' })
  } else {
    respond(401, res, loginPage('密码错误，请重试'))
  }
}

function forward(req, res) {
  const upstream = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers: rewriteHeaders(req.headers) },
    (ur) => {
      res.writeHead(ur.statusCode, ur.headers)
      ur.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end('proxy: upstream unavailable (is dsh web on 3080 running?)')
  })
  req.pipe(upstream)
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith(AUTH_PATH)) return handleAuth(req, res)
  if (!isAuthed(req)) {
    if (req.method === 'GET' || req.method === 'HEAD') return respond(200, res, loginPage())
    return respond(401, res, 'unauthorized')
  }
  forward(req, res)
})

server.on('upgrade', (req, socket, head) => {
  if (!isAuthed(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const headers = rewriteHeaders(req.headers)
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    let frame = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue
      frame += Array.isArray(value)
        ? value.map((entry) => `${key}: ${entry}`).join('\r\n') + '\r\n'
        : `${key}: ${value}\r\n`
    }
    frame += '\r\n'
    upstream.write(frame)
    if (head !== undefined && head.length > 0) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`lan-proxy: 0.0.0.0:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT} (password-gated, host-rewriting)`)
})
