console.log("Popup script loaded");

document.addEventListener("DOMContentLoaded", async function () {
  // [variable] <- Stores the first element that returns
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  // This is the clean name without the unnecessary parts
  const hostname = new URL(tab.url).hostname;
  document.getElementById("cSite").textContent = hostname.toUpperCase();
});
