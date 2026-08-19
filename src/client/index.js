'use strict'

/**
 * Secure-context polyfill: crypto.randomUUID is only exposed to secure
 * contexts (HTTPS / localhost). The dsh client mints an RPC id with it on
 * every request, so a phone/tablet page opened over plain HTTP on the LAN
 * dies with "crypto.randomUUID is not a function" before the first RPC.
 * getRandomValues deliberately stays available on insecure origins, so a
 * spec-shaped UUID v4 built from it restores full function. Installed at
 * factory registration time — before this plugin's own code — and the
 * connection loop's infinite retry self-heals pages already stuck on the
 * error.
 */
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues === 'function') {
  crypto.randomUUID = function randomUuidPolyfill() {
    var bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    var hex = ''
    for (var i = 0; i < 16; i++) hex += (bytes[i] + 0x100).toString(16).slice(1)
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
  }
}

/**
 * dsh web GUI mobile companion (client half).
 *
 * Pure DOM/CSS layout adaptation for phone-class viewports: the desktop
 * three-column AppFrame (sidebar | center | details, JS-computed inline
 * grid tracks) becomes a single full-width column with the sidebar and
 * details pane re-mounted as off-canvas overlays. No cordis services, no
 * model surface; every DOM/CSS/attribute write is restored by the
 * disposer returned from apply().
 *
 * Stable selector vocabulary (mirrors the skin ecosystem):
 *   - hashed class substrings: [class*='sidebarCol'] / 'centerCol' /
 *     'detailsCol' / '_frame' / '_handle' / 'logoRow' / 'toggle'
 *   - progressive data attributes when present:
 *     [data-pane='sidebar'|'conversation'|'details'], [data-composer-card],
 *     [data-slot='sidebar.settings']
 * Open/close state keys off documentElement attributes:
 *   data-dsh-mobile         mobile mode active (media query driven)
 *   data-dsh-mobile-drawer  sidebar drawer open
 */

var SCOPE_ATTR = 'data-dsh-mobile'
var DRAWER_ATTR = 'data-dsh-mobile-drawer'

/** Phone widths, plus coarse-pointer tablets up to laptop size. */
var MOBILE_QUERY = '(max-width: 768px), ((pointer: coarse) and (max-width: 1180px))'

var SIDEBAR_PANE = ":is([data-pane='sidebar'], [class*='sidebarCol'])"
var CENTER_PANE = ":is([data-pane='conversation'], [class*='centerCol'])"

/** Drawer toggle icon: plain strokes, inherits currentColor. */
var TOGGLE_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
  ' stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 5h14M3 10h14M3 15h14"/></svg>'

/** Elements created and owned by this plugin. */
var ownedNodes = []
/** Registered { target, type, fn } triples. */
var listeners = []
/** Live MutationObservers. */
var observers = []
var mediaQuery = null
var scheduled = 0

function listen(target, type, fn, options) {
  target.addEventListener(type, fn, options)
  listeners.push({ target: target, type: type, fn: fn, options: options })
}

function own(node) {
  ownedNodes.push(node)
  return node
}

function html() {
  return document.documentElement
}

function isDrawerOpen() {
  return html().hasAttribute(DRAWER_ATTR)
}

function openDrawer() {
  html().setAttribute(DRAWER_ATTR, '')
  var toggle = document.querySelector('[data-dsh-mobile-toggle]')
  if (toggle) toggle.setAttribute('aria-expanded', 'true')
}

function closeDrawer() {
  html().removeAttribute(DRAWER_ATTR)
  var toggle = document.querySelector('[data-dsh-mobile-toggle]')
  if (toggle) toggle.setAttribute('aria-expanded', 'false')
}

function toggleDrawer() {
  if (isDrawerOpen()) closeDrawer()
  else openDrawer()
}

/** The drawer button lives at the left edge of the conversation header. */
function ensureToggle() {
  if (document.querySelector('[data-dsh-mobile-toggle]')) return
  var header = document.querySelector(CENTER_PANE + " header")
  if (!header) return
  var button = document.createElement('button')
  button.type = 'button'
  button.dataset.dshMobileToggle = ''
  button.setAttribute('aria-label', 'Menu')
  button.setAttribute('aria-expanded', 'false')
  button.innerHTML = TOGGLE_ICON
  listen(button, 'click', function (event) {
    event.stopPropagation()
    toggleDrawer()
  })
  header.prepend(own(button))
}

/** Dimmed layer under the drawer; taps close it. Always mounted, CSS gates it. */
function ensureBackdrop() {
  if (document.querySelector('[data-dsh-mobile-backdrop]')) return
  var backdrop = document.createElement('div')
  backdrop.dataset.dshMobileBackdrop = ''
  backdrop.setAttribute('aria-hidden', 'true')
  listen(backdrop, 'click', closeDrawer)
  document.body.appendChild(own(backdrop))
}

function ensureChrome() {
  ensureToggle()
  ensureBackdrop()
}

/**
 * SPA re-renders (route/session changes) can drop the toggle; re-check on
 * any DOM mutation, coalesced into one rAF tick.
 */
function scheduleEnsure() {
  if (scheduled) return
  scheduled = 1
  var raf = window.requestAnimationFrame || function (fn) { setTimeout(fn, 16) }
  raf(function () {
    scheduled = 0
    ensureChrome()
  })
}

/**
 * Close the drawer after meaningful taps inside it (session pick, new
 * session, workspace switch). Text inputs keep focus; the settings
 * trigger also closes — its dialog renders above everything anyway.
 */
function onDocumentClick(event) {
  if (!isDrawerOpen()) return
  var target = event.target
  if (!target || typeof target.closest !== 'function') return
  if (target.closest('[data-dsh-mobile-backdrop]')) return
  if (target.closest('input, textarea, select, [contenteditable]')) return
  var inSidebar = target.closest(SIDEBAR_PANE)
  if (!inSidebar) return
  if (target.closest("button, [role='button'], [role='option'], a")) closeDrawer()
}

function onKeyDown(event) {
  if (event.key === 'Escape') closeDrawer()
}

/** Media query drives the scope attribute both ways; leaving mobile closes. */
function syncScope() {
  if (mediaQuery.matches) html().setAttribute(SCOPE_ATTR, '')
  else {
    html().removeAttribute(SCOPE_ATTR)
    closeDrawer()
  }
}

/** Cordis client plugin entry. Returns a disposer restoring every write. */
function apply() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return function () {}
  mediaQuery = window.matchMedia(MOBILE_QUERY)

  syncScope()
  ensureChrome()

  listen(mediaQuery, 'change', syncScope)
  listen(document, 'click', onDocumentClick, true)
  listen(document, 'keydown', onKeyDown)

  var observer = new MutationObserver(scheduleEnsure)
  observer.observe(document.body, { childList: true, subtree: true })
  observers.push(observer)
  scheduleEnsure()

  return function dispose() {
    for (var i = 0; i < observers.length; i++) observers[i].disconnect()
    observers = []
    for (var j = 0; j < listeners.length; j++) {
      var entry = listeners[j]
      entry.target.removeEventListener(entry.type, entry.fn, entry.options)
    }
    listeners = []
    for (var k = 0; k < ownedNodes.length; k++) {
      var node = ownedNodes[k]
      if (node.parentNode) node.parentNode.removeChild(node)
    }
    ownedNodes = []
    html().removeAttribute(SCOPE_ATTR)
    html().removeAttribute(DRAWER_ATTR)
  }
}

module.exports = { apply: apply }
