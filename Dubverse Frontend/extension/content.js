// DubMaster Import — content script for youtube.com
//
// Adds an "Import to DubMaster" button on watch pages, next to the
// Like/Share action row. Clicking it opens DubMaster's YouTube tab and
// starts the import automatically (?yt_url=...).
//
// YouTube is an SPA, so injection runs on yt-navigate-finish as well as
// initial load. If the actions row isn't found (layout change), a
// floating fallback button appears bottom-right on watch pages instead.

const DUBMASTER_URL = "http://localhost:3000"; // change to the deployed origin in production
const BUTTON_ID = "dubmaster-import-btn";

function videoUrl() {
  const v = new URLSearchParams(window.location.search).get("v");
  return v ? `https://www.youtube.com/watch?v=${v}` : window.location.href;
}

function openInDubMaster() {
  const target =
    `${DUBMASTER_URL}/dashboard?tab=youtube&yt_url=` +
    encodeURIComponent(videoUrl());
  window.open(target, "_blank", "noopener");
}

function makeButton(floating) {
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
  btn.addEventListener("click", openInDubMaster);
  return btn;
}

function inject() {
  const existing = document.getElementById(BUTTON_ID);
  const onWatch = window.location.pathname === "/watch";

  if (!onWatch) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already injected for this video

  // Preferred spot: the actions row (Like / Share / ...) under the player.
  const actions =
    document.querySelector("ytd-watch-metadata #actions #actions-inner") ||
    document.querySelector("ytd-watch-metadata #actions") ||
    document.querySelector("#top-level-buttons-computed");

  if (actions) {
    actions.appendChild(makeButton(false));
  } else {
    document.body.appendChild(makeButton(true));
  }
}

// Initial load + every SPA navigation.
inject();
window.addEventListener("yt-navigate-finish", () => {
  // Give the actions row a tick to mount before injecting.
  setTimeout(inject, 300);
});

// Layout races: retry briefly if the actions row wasn't ready.
let retries = 0;
const retryTimer = setInterval(() => {
  if (document.getElementById(BUTTON_ID) || ++retries > 10) {
    clearInterval(retryTimer);
    return;
  }
  inject();
}, 1000);
