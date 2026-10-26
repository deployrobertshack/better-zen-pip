// Picture-in-Picture trackpad controls for Zen.
//   - two-finger swipe moves the PiP window (rubber-band wall, spring back, cursor follows)
//   - Option + two-finger swipe up/down resizes it smoothly
(function () {
  "use strict";
  if (window.__pipTrackpadMod) return;

  // The look (same rules as chrome.css), registered as a user style sheet so it
  // applies to the PiP window itself, not only to the main browser window.
  var LOOK_CSS = `/* Custom Picture-in-Picture buttons */
@-moz-document url("chrome://pictureinpicture/content/player.xhtml") {

  :root {
    --pip-icon-color: #e8e8e8;      /* icon color: light gray (#fff = pure white) */
    --pip-btn-bg: rgba(20, 20, 20, 0.65);
    --pip-btn-radius: 50%;          /* 50% = round, 8px = rounded square */
    --pip-small-icon: 16px;         /* icon size for audio and back-to-tab */
    --pip-seek-scale: 0.85;         /* skip back/forward button size (1 = original) */
    --pip-seek-size: 32px;          /* the skip buttons' original width, used to keep their spacing */
    --pip-play-scale: 1.12;         /* play/pause button size (1 = original) */
    --pip-play-size: 32px;          /* the play/pause button's original width, used to keep spacing */
  }

  /* All control buttons: round, dark translucent, light gray icons */
  .control-button {
    background-color: var(--pip-btn-bg) !important;
    border-radius: var(--pip-btn-radius) !important;
    -moz-context-properties: fill, stroke !important;
    fill: var(--pip-icon-color) !important;
    color: var(--pip-icon-color) !important;
  }

  /* Smaller icons inside the audio and back-to-tab buttons
     (the button circle keeps its normal size) */
  #audio, #unpip, #playpause {
    background-size: var(--pip-small-icon) auto !important;
  }

  /* Slightly smaller skip back / skip forward buttons. Each one shrinks toward
     its own center, so it is also slid toward play/pause by half the size it
     lost, which keeps the gap to play/pause the same as before. */
  #seekBackward, #seekForward {
    scale: var(--pip-seek-scale);
  }
  /* Slightly bigger play/pause button (grows around its center). */
  #playpause {
    scale: var(--pip-play-scale);
  }
  /* Net slide for the skip buttons: in by half of what they lost, out by half of
     what play/pause gained, so the gaps to play/pause stay the same as before. */
  #seekBackward {
    translate: calc(var(--pip-seek-size) * (1 - var(--pip-seek-scale)) / 2 - var(--pip-play-size) * (var(--pip-play-scale) - 1) / 2) 0;
  }
  #seekForward {
    translate: calc(var(--pip-play-size) * (var(--pip-play-scale) - 1) / 2 - var(--pip-seek-size) * (1 - var(--pip-seek-scale)) / 2) 0;
  }

  /* Swap the top buttons: back-to-tab on the left,
     minimize and close on the right (close in the corner) */
  #unpip {
    left: 10px !important;
    right: auto !important;
    /* Built-in Firefox left arrow icon (takes the icon color automatically) */
    background-image: url("chrome://global/skin/icons/arrow-left.svg") !important;
  }
  #close {
    left: auto !important;
    right: 10px !important;
  }
  #minimize {
    left: auto !important;
    right: 50px !important;
  }
}
`;
  try {
    var sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
    var lookUri = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(LOOK_CSS));
    if (!sss.sheetRegistered(lookUri, sss.USER_SHEET)) sss.loadAndRegisterSheet(lookUri, sss.USER_SHEET);
  } catch (err) { console.log("PiP look: could not register style sheet:", err); }

  var PIP = { SPEED: 1.35, HOLD: 300, IDLE: 120, MARGIN: 12, SNAP: true, WALL: 80, RESIST: 0.6, SETTLE_MS: 800, GLIDE_N: 6, GLIDE_MIN: 4, GLIDE_DROP: 0.85, NEW_RISE: 6, NEW_GAP: 130, CURSOR_RETURN: true, CURSOR_TOL: 5, CURSOR_GRACE: 80, OWN_TOL: 4, KEEP: 0.8, DRAG_SNAP: true, DRAG_QUIET: 400 };
  var ZOOM = { GAIN: 0.8, DIR: 1, EASE: 0.4, MIN_W: 240, MAX_FRAC: 0.9, MARGIN: 12 };
  var M = Ci.nsIDOMWindowUtils.NATIVE_MOUSE_MESSAGE_MOVE;

  var swipeSetup = w => {
    var d = w.document;
    var els = [d.documentElement, d.getElementById("browser"), d.getElementById("controls")];
    var hide = on => els.forEach(el => el && (on ? el.style.setProperty("cursor", "none", "important") : el.style.removeProperty("cursor")));
    if (w.__pipWheel) w.removeEventListener("wheel", w.__pipWheel, true);
    if (w.__pipMove) w.removeEventListener("mousemove", w.__pipMove, true);
    var st = { active: false, released: false, hidden: false, watch: false, moved: false, skipCursor: false, sent: [], graceUntil: 0, b: null, peak: 0, prev: 0, run: 0, gl: false, tailMin: Infinity, vx: 0, vy: 0, px: 0, py: 0, offX: 0, offY: 0, last: 0, raf: 0, timer: 0, animRaf: 0 };
    var clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    var rub = o => { var W = PIP.WALL; return W * (1 - 1 / (PIP.RESIST * o / W + 1)); };
    var unrub = r => { var W = PIP.WALL; r = Math.min(r, W * 0.999); return (W / PIP.RESIST) * r / (W - r); };
    var toDisp = (v, lo, hi) => v < lo ? lo - rub(lo - v) : v > hi ? hi + rub(v - hi) : v;
    var toVirt = (p, lo, hi) => p < lo ? lo - unrub(lo - p) : p > hi ? hi + unrub(p - hi) : p;
    var moveCursor = (x, y) => {
      var now = performance.now();
      st.sent.push({ x: x, y: y, t: now });
      while (st.sent.length > 1 && st.sent[0].t < now - 600) st.sent.shift();
      var r = w.devicePixelRatio;
      try { w.windowUtils.sendNativeMouseEvent(x * r, y * r, M, 0, 0, d.documentElement, null); } catch (err) { console.log("cursor move failed:", err); }
    };
    var bounds = () => {
      if (!PIP.SNAP) return null;
      var s = w.screen, m = PIP.MARGIN, ow = w.outerWidth, oh = w.outerHeight;
      var b = { minX: s.availLeft + m, maxX: s.availLeft + s.availWidth - ow - m, minY: s.availTop + m, maxY: s.availTop + s.availHeight - oh - m };
      return Object.values(b).every(Number.isFinite) && b.maxX >= b.minX && b.maxY >= b.minY ? b : null;
    };
    var unhide = () => { st.hidden = false; hide(false); };
    var frame = () => {
      st.raf = 0;
      w.moveTo(st.px, st.py);
      moveCursor(st.px + st.offX, st.py + st.offY);
    };
    var finish = (fx, fy) => {
      st.animRaf = 0; st.watch = false;
      w.moveTo(fx, fy);
      if (PIP.CURSOR_RETURN && !st.moved && !st.skipCursor) moveCursor(fx + st.offX, fy + st.offY);
      setTimeout(() => { if (!st.active) unhide(); }, 30);
    };
    var settle = () => {
      st.active = false; st.released = true; st.tailMin = Infinity;
      st.moved = false;
      clearTimeout(st.timer);
      if (st.raf) { w.cancelAnimationFrame(st.raf); st.raf = 0; }
      var b = st.b, sx = st.px, sy = st.py;
      if (!b || !Number.isFinite(sx) || !Number.isFinite(sy)) { unhide(); return; }
      var tx = clamp(sx, b.minX, b.maxX), ty = clamp(sy, b.minY, b.maxY);
      if (Math.abs(tx - sx) < 1 && Math.abs(ty - sy) < 1) { finish(sx, sy); return; }
      st.watch = true; st.graceUntil = performance.now() + PIP.CURSOR_GRACE;
      var T = PIP.SETTLE_MS, om = 6.64 / (Math.max(T, 1) / 1000), t0 = null;
      var step = now => {
        if (t0 === null) t0 = now;
        var t = (now - t0) / 1000;
        var k = (1 + om * t) * Math.exp(-om * t);
        if (T <= 0 || k < 0.01) { finish(tx, ty); return; }
        st.px = tx + (sx - tx) * k; st.py = ty + (sy - ty) * k;
        w.moveTo(st.px, st.py);
        st.animRaf = w.requestAnimationFrame(step);
      };
      st.animRaf = w.requestAnimationFrame(step);
    };
    // After a click-and-drag (moved by the OS, not by this script), spring the window
    // back inside the screen once it has stopped moving.
    var dragSettle = () => {
      var b = bounds();
      if (!b) return;
      var x = w.screenX, y = w.screenY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return;
      st.b = b; st.px = x; st.py = y; st.skipCursor = true;
      settle();
    };
    w.__pipMove = e => {
      if (!st.watch || st.moved || performance.now() < st.graceUntil) return;
      var x = e.screenX, y = e.screenY;
      if (st.sent.some(s => Math.abs(s.x - x) <= PIP.OWN_TOL && Math.abs(s.y - y) <= PIP.OWN_TOL)) return;
      var l = st.sent[st.sent.length - 1];
      if (l && Math.hypot(x - l.x, y - l.y) <= PIP.CURSOR_TOL) return;
      st.moved = true; unhide();
    };
    w.__pipWheel = e => {
      if (e.ctrlKey) return;
      e.preventDefault();
      var now = Date.now(), gap = now - st.last; st.last = now;
      var mag = Math.hypot(e.deltaX, e.deltaY);
      if (st.released) {
        var fresh = gap > PIP.NEW_GAP || mag > st.tailMin + PIP.NEW_RISE;
        st.tailMin = Math.min(st.tailMin, mag);
        if (!fresh) return;
        if (st.animRaf) { w.cancelAnimationFrame(st.animRaf); st.animRaf = 0; }
        st.released = false; st.watch = false;
      }
      if (!st.active) {
        st.b = bounds();
        var b0 = st.b;
        st.px = w.screenX; st.py = w.screenY;
        st.vx = b0 ? toVirt(st.px, b0.minX, b0.maxX) : st.px;
        st.vy = b0 ? toVirt(st.py, b0.minY, b0.maxY) : st.py;
        st.offX = clamp(e.screenX - w.screenX, 10, w.outerWidth - 10);
        st.offY = clamp(e.screenY - w.screenY, 10, w.outerHeight - 10);
        st.peak = 0; st.prev = 0; st.run = 0; st.gl = false; st.watch = false; st.sent = []; st.skipCursor = false; st.active = true;
      }
      var b = st.b;
      if (mag > st.peak) { st.peak = mag; st.run = 0; }
      else if (mag <= st.prev + 1) st.run++;
      else st.run = 0;
      st.prev = mag;
      var glideLike = st.peak >= PIP.GLIDE_MIN && mag <= st.peak * PIP.GLIDE_DROP && st.run >= PIP.GLIDE_N;
      if (glideLike) st.gl = true;
      if (!st.hidden) { st.hidden = true; hide(true); }
      clearTimeout(st.timer);
      st.timer = setTimeout(settle, glideLike ? PIP.IDLE : PIP.HOLD);
      var k = st.gl ? PIP.KEEP : 1;
      st.vx += -e.deltaX * PIP.SPEED * k; st.vy += -e.deltaY * PIP.SPEED * k;
      if (b) {
        var L = 9 * PIP.WALL / PIP.RESIST;
        st.vx = clamp(st.vx, b.minX - L, b.maxX + L); st.vy = clamp(st.vy, b.minY - L, b.maxY + L);
        st.px = toDisp(st.vx, b.minX, b.maxX); st.py = toDisp(st.vy, b.minY, b.maxY);
        if (glideLike && (st.px < b.minX || st.px > b.maxX || st.py < b.minY || st.py > b.maxY)) { settle(); return; }
      } else { st.px = st.vx; st.py = st.vy; }
      if (!st.raf) st.raf = w.requestAnimationFrame(frame);
    };
    w.addEventListener("wheel", w.__pipWheel, { passive: false, capture: true });
    w.addEventListener("mousemove", w.__pipMove, { capture: true });

    if (w.__pipWatch) w.clearInterval(w.__pipWatch);
    var lx = w.screenX, ly = w.screenY, moving = false, quietSince = 0;
    w.__pipWatch = w.setInterval(() => {
      if (!PIP.DRAG_SNAP) return;
      var x = w.screenX, y = w.screenY, now = performance.now();
      if (st.active || st.animRaf || st.raf || now < (w.__pipZoomUntil || 0)) { lx = x; ly = y; moving = false; return; }
      if (x !== lx || y !== ly) { lx = x; ly = y; moving = true; quietSince = now; return; }
      if (moving && now - quietSince >= PIP.DRAG_QUIET) { moving = false; dragSettle(); }
    }, 50);
  };

  var zoomSetup = w => {
    if (w.__pipZoomW) w.removeEventListener("wheel", w.__pipZoomW, true);
    var z = { lp: 0, raf: 0, sx: 0, sy: 0, ratio: 1 };
    var clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    var frame = () => {
      z.raf = 0;
      w.__pipZoomUntil = performance.now() + 300;
      var s = w.screen, ow = w.outerWidth, oh = w.outerHeight, m = ZOOM.MARGIN;
      if (!(ow > 0 && oh > 0)) { z.lp = 0; return; }
      var dl = z.lp * ZOOM.EASE; z.lp -= dl;
      var want = ow * Math.exp(dl);
      var maxW = Math.min(s.availWidth * ZOOM.MAX_FRAC, s.availHeight * ZOOM.MAX_FRAC * z.ratio);
      var nw = clamp(want, ZOOM.MIN_W, maxW);
      if (nw !== want) z.lp = 0;
      var nh = nw / z.ratio, f = nw / ow;
      var nl = z.sx - (z.sx - w.screenX) * f, nt = z.sy - (z.sy - w.screenY) * f;
      nl = clamp(nl, s.availLeft + m, Math.max(s.availLeft + m, s.availLeft + s.availWidth - nw - m));
      nt = clamp(nt, s.availTop + m, Math.max(s.availTop + m, s.availTop + s.availHeight - nh - m));
      w.resizeTo(Math.round(nw), Math.round(nh));
      w.moveTo(Math.round(nl), Math.round(nt));
      if (Math.abs(z.lp) > 0.002) z.raf = w.requestAnimationFrame(frame);
    };
    w.__pipZoomW = e => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!z.raf) z.ratio = w.outerWidth / w.outerHeight;
      z.lp += e.deltaY * 0.01 * ZOOM.GAIN * ZOOM.DIR; z.sx = e.screenX; z.sy = e.screenY;
      if (!z.raf) z.raf = w.requestAnimationFrame(frame);
    };
    w.addEventListener("wheel", w.__pipZoomW, { passive: false, capture: true });
  };

  // Zoom is registered first so Option+swipe is handled before the move handler sees it.
  var setupWindow = w => { zoomSetup(w); swipeSetup(w); };

  var isPip = win => win.document.documentElement.getAttribute("windowtype") == "Toolkit:PictureInPicture";
  var observer = {
    observe(win) {
      win.addEventListener("load", () => { if (isPip(win)) setupWindow(win); }, { once: true });
    }
  };
  Services.obs.addObserver(observer, "domwindowopened");

  var existing = Services.wm.getEnumerator("Toolkit:PictureInPicture");
  while (existing.hasMoreElements()) setupWindow(existing.getNext());

  var destroy = () => {
    try { Services.obs.removeObserver(observer, "domwindowopened"); } catch (e) {}
    try { sss.unregisterSheet(lookUri, sss.USER_SHEET); } catch (e) {}
    var en = Services.wm.getEnumerator("Toolkit:PictureInPicture");
    while (en.hasMoreElements()) {
      var w = en.getNext();
      if (w.__pipWheel) w.removeEventListener("wheel", w.__pipWheel, true);
      if (w.__pipMove) w.removeEventListener("mousemove", w.__pipMove, true);
      if (w.__pipZoomW) w.removeEventListener("wheel", w.__pipZoomW, true);
      if (w.__pipWatch) w.clearInterval(w.__pipWatch);
    }
    delete window.__pipTrackpadMod;
  };
  window.__pipTrackpadMod = { destroy: destroy, PIP: PIP, ZOOM: ZOOM };
  window.addEventListener("unload", destroy, { once: true });
})();
