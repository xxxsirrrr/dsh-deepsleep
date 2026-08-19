// Smoke test: run the built bundle in a vm sandbox with minimal DOM stubs.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class El {
  constructor(tag) {
    this.tagName = tag
    this.parentNode = null
    this.children = []
    this.dataset = {}
    this.attrs = new Map()
  }
  setAttribute(k, v) { this.attrs.set(k, v) }
  removeAttribute(k) { this.attrs.delete(k) }
  hasAttribute(k) { return this.attrs.has(k) }
  prepend(n) { this.children.unshift(n); n.parentNode = this }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); n.parentNode = null; return n }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null }
}

const docEl = new El('html')
const body = new El('body')
const results = []
let loadedSurface = null

const sandbox = {
  console,
  setTimeout,
  window: {
    matchMedia: (q) => ({ matches: q.includes('768'), addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    __ModuleLoader__: {
      load(entry) {
        const noExternals = () => { throw new Error('no externals expected') }
        loadedSurface = entry.factory(noExternals)
      },
    },
  },
  document: {
    documentElement: docEl,
    head: new El('head'),
    body,
    createElement: (t) => new El(t),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  },
  MutationObserver: class { observe() {} disconnect() {} },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)

vm.runInContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)

const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`) }

check('factory executed, exports apply', loadedSurface !== null && typeof loadedSurface.apply === 'function')
const dispose = loadedSurface.apply()
check('apply returned disposer', typeof dispose === 'function')
check('mobile scope attribute set', docEl.hasAttribute('data-dsh-mobile'))
check('backdrop mounted into body', body.children.some((c) => c.dataset && c.dataset.dshMobileBackdrop !== undefined))
dispose()
check('dispose removed scope attribute', !docEl.hasAttribute('data-dsh-mobile'))
check('dispose removed owned nodes', body.children.length === 0)

if (results.some(([, ok]) => !ok)) process.exit(1)
console.log('SMOKE PASS')
