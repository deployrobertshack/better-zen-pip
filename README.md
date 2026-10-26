# PiP Buttons and Trackpad

A Sine mod for Zen Browser.

**Look (chrome.css):** round dark translucent PiP buttons, light gray icons, 16px icons, left-arrow back-to-tab button, top buttons swapped (back-to-tab left, minimize and close right), slightly smaller skip buttons, slightly bigger play/pause button.

**Behavior (pip-trackpad.uc.js):**
- Two-finger swipe over the PiP window moves it, with a rubber-band wall past the screen edge and a spring back.
- Hold Option and swipe up/down to resize it smoothly.
- After a click-and-drag, the window springs back inside the screen if it was left past the edge.

Tuning values are at the top of `pip-trackpad.uc.js` (`PIP` and `ZOOM`) and `chrome.css` (the `--pip-*` variables).

## Install

1. In Zen: Settings > Sine Mods, enable JavaScript from unofficial sources (`sine.allow-unsafe-js`).
2. Push these files (at the top level of the repo) to a public GitHub repository.
3. Add `your-username/your-repo` in Sine's GitHub repository field, install, enable, and restart Zen.
