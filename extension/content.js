// DubMaster Import — content script for youtube.com
//
// Two surfaces:
//  1. Watch pages: an "Import to DubMaster" button in the actions row
//     (next to Like/Share), with a floating fallback if the row isn't found.
//  2. Feeds (home, channel, search, sidebar): a small "Import" button
//     overlaid on the top-right of every video thumbnail, shown on hover.
//
// Both open DubMaster's YouTube tab via ?yt_url=..., which auto-imports.
// YouTube is an SPA — injection runs on yt-navigate-finish plus a
// MutationObserver for lazily-rendered thumbnails.

const DUBMASTER_URL = "http://localhost:3000"; // change to the deployed origin in production
const BUTTON_ID = "dubmaster-import-btn";
const THUMB_BTN_CLASS = "dubmaster-thumb-btn";

function openInDubMaster(url) {
  const target =
    `${DUBMASTER_URL}/dashboard?tab=youtube&yt_url=` +
    encodeURIComponent(url);
  window.open(target, "_blank", "noopener");
}

function watchUrl() {
  const v = new URLSearchParams(window.location.search).get("v");
  return v ? `https://www.youtube.com/watch?v=${v}` : window.location.href;
}

// ── 1. Watch-page actions button ──────────────────────────────────────────

function makeWatchButton(floating) {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.textContent = "Import to DubMaster";
  btn.style.cssText = [
    "font-family:Roboto,Arial,sans-serif",
    "font-size:14px",
    "font-weight:600",
    "color:#fff",
    "background:linear-gradient(90deg,#A855F7,#22D3EE)",
    "border:none",
    "border-radius:18px",
    "padding:8px 16px",
    "cursor:pointer",
    "margin-left:8px",
    "white-space:nowrap",
  ].join(";");
  if (floating) {
    btn.style.cssText +=
      ";position:fixed;bottom:24px;right:24px;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,.4);margin-left:0";
  }
  btn.addEventListener("click", () => openInDubMaster(watchUrl()));
  return btn;
}

function injectWatchButton() {
  const existing = document.getElementById(BUTTON_ID);
  const onWatch = window.location.pathname === "/watch";

  if (!onWatch) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const actions =
    document.querySelector("ytd-watch-metadata #actions #actions-inner") ||
    document.querySelector("ytd-watch-metadata #actions") ||
    document.querySelector("#top-level-buttons-computed");

  if (actions) {
    actions.appendChild(makeWatchButton(false));
  } else {
    document.body.appendChild(makeWatchButton(true));
  }
}

// ── 2. Thumbnail hover buttons on feeds ───────────────────────────────────

function injectThumbStyles() {
  if (document.getElementById("dubmaster-thumb-style")) return;
  const style = document.createElement("style");
  style.id = "dubmaster-thumb-style";
  style.textContent = `
    .${THUMB_BTN_CLASS} {
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 2100;
      font-family: Roboto, Arial, sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(90deg,#A855F7,#22D3EE);
      border: none;
      border-radius: 12px;
      padding: 4px 10px;
      cursor: pointer;
      opacity: .9;
      transition: opacity .15s;
      box-shadow: 0 2px 8px rgba(0,0,0,.5);
    }
    ytd-thumbnail:hover .${THUMB_BTN_CLASS},
    yt-lockup-view-model:hover .${THUMB_BTN_CLASS} {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
}

// Thumbnail anchors across YouTube layouts (home feed, search results,
// channel pages, watch-sidebar recommendations). Class names change, so
// we key off the link target instead: any anchor pointing at /watch or
// /shorts inside a thumbnail container.
const ANCHOR_SELECTORS = [
  "ytd-thumbnail a#thumbnail",
  "a#thumbnail[href*='/watch']",
  "yt-lockup-view-model a[href*='/watch']",
  "yt-lockup-view-model a[href*='/shorts']",
].join(",");

function injectThumbButton(anchor) {
  if (anchor.dataset.dubmasterThumb) return;
  anchor.dataset.dubmasterThumb = "1";
  if (!/[?&]v=|\/shorts\//.test(anchor.href)) return;

  const host = anchor.closest("ytd-thumbnail") ||
               anchor.closest(".yt-lockup-view-model__content-image") ||
               anchor;
  if (host.querySelector("." + THUMB_BTN_CLASS)) return;
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }

  const btn = document.createElement("button");
  btn.className = THUMB_BTN_CLASS;
  btn.textContent = "Import";
  btn.title = "Import to DubMaster";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInDubMaster(anchor.href);
  });
  host.appendChild(btn);
}

function scanThumbnails(root) {
  const scope = root instanceof Element ? root : document;
  if (scope.matches && scope.matches(ANCHOR_SELECTORS)) injectThumbButton(scope);
  for (const el of scope.querySelectorAll(ANCHOR_SELECTORS)) {
    injectThumbButton(el);
  }
}

function reportCount() {
  const n = document.querySelectorAll("." + THUMB_BTN_CLASS).length;
  console.debug(`[DubMaster] ${n} thumbnail buttons injected`);
}

// ── Wiring ────────────────────────────────────────────────────────────────

console.debug("[DubMaster] content script loaded");
injectThumbStyles();
injectWatchButton();
scanThumbnails(document);
setTimeout(reportCount, 1500);

window.addEventListener("yt-navigate-finish", () => {
  setTimeout(() => {
    injectWatchButton();
    scanThumbnails(document);
  }, 300);
});

// Feeds lazy-render thumbnails on scroll — observe for new nodes.
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scanThumbnails(node);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Layout races: retry briefly if the watch actions row wasn't ready.
let retries = 0;
const retryTimer = setInterval(() => {
  if (document.getElementById(BUTTON_ID) || ++retries > 10) {
    clearInterval(retryTimer);
    return;
  }
  injectWatchButton();
}, 1000);
