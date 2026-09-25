import { getSettings, setSettings, normalizeHostname } from "../lib/storage.js";

document.addEventListener("DOMContentLoaded", async function () {
  const ignoreListInput = document.getElementById("ignore-url");
  const ignoreListError = document.getElementById("ignore-url-error");
  const ignoreList = document.getElementById("ignored-sites-list");
  const ignoreIncognitoCheckbox = document.getElementById("ignore-incog");

  const limitUrlInput = document.getElementById("limit-url");
  const limitMinutesInput = document.getElementById("limit-minutes");
  const limitError = document.getElementById("limit-error");
  const addLimitButton = document.getElementById("add-limit");
  const siteLimitsList = document.getElementById("site-limits-list");

  const globalLimitEnabled = document.getElementById("global-limit-enabled");
  const globalLimitMinutes = document.getElementById("global-limit-minutes");
  const globalLimitError = document.getElementById("global-limit-error");

  const saveButton = document.getElementById("save-changes");
  const cancelButton = document.getElementById("cancel-changes");

  function showButtons() {
    saveButton.style.display = "block";
    cancelButton.style.display = "block";
  }

  function hideButtons() {
    saveButton.style.display = "none";
    cancelButton.style.display = "none";
  }

  function makeListItem(labelText, onDelete) {
    const listItem = document.createElement("li");
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "✖";
    deleteButton.type = "button";
    deleteButton.style.cursor = "pointer";
    deleteButton.style.border = "none";
    deleteButton.style.borderRadius = "3px";
    deleteButton.style.backgroundColor = "rgb(133, 133, 255)";
    deleteButton.style.marginRight = "10px";
    deleteButton.addEventListener("click", function () {
      listItem.remove();
      onDelete();
      showButtons();
    });

    const label = document.createElement("span");
    label.textContent = labelText;

    listItem.appendChild(deleteButton);
    listItem.appendChild(label);
    return listItem;
  }

  function addIgnoredSiteItem(hostname) {
    const listItem = makeListItem(hostname, function () {});
    listItem.dataset.site = hostname;
    ignoreList.appendChild(listItem);
  }

  function addSiteLimitItem(hostname, minutes) {
    const listItem = makeListItem(`${hostname} — ${minutes} min`, function () {});
    listItem.dataset.site = hostname;
    listItem.dataset.minutes = String(minutes);
    siteLimitsList.appendChild(listItem);
  }

  async function loadOptions() {
    const settings = await getSettings();

    ignoreList.innerHTML = "";
    settings.ignoredSites.forEach(addIgnoredSiteItem);

    siteLimitsList.innerHTML = "";
    Object.entries(settings.siteLimits).forEach(([hostname, minutes]) => addSiteLimitItem(hostname, minutes));

    ignoreIncognitoCheckbox.checked = settings.ignoreInIncognito;

    if (settings.globalDailyLimitMinutes) {
      globalLimitEnabled.checked = true;
      globalLimitMinutes.value = settings.globalDailyLimitMinutes;
      globalLimitMinutes.disabled = false;
    } else {
      globalLimitEnabled.checked = false;
      globalLimitMinutes.value = "";
      globalLimitMinutes.disabled = true;
    }
  }

  await loadOptions();

  ignoreListInput.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    ignoreListError.textContent = "";

    const hostname = normalizeHostname(ignoreListInput.value);
    if (!hostname) {
      ignoreListError.textContent = "Enter a valid site (e.g. example.com).";
      return;
    }

    const existing = Array.from(ignoreList.children).map((li) => li.dataset.site);
    if (existing.includes(hostname)) {
      ignoreListError.textContent = "That site is already on the list.";
      return;
    }

    addIgnoredSiteItem(hostname);
    ignoreListInput.value = "";
    showButtons();
  });

  addLimitButton.addEventListener("click", function () {
    limitError.textContent = "";

    const hostname = normalizeHostname(limitUrlInput.value);
    if (!hostname) {
      limitError.textContent = "Enter a valid site (e.g. example.com).";
      return;
    }

    const minutes = Number(limitMinutesInput.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      limitError.textContent = "Enter a whole number of minutes (1-1440).";
      return;
    }

    const existing = Array.from(siteLimitsList.children);
    const duplicate = existing.find((li) => li.dataset.site === hostname);
    if (duplicate) duplicate.remove();

    addSiteLimitItem(hostname, minutes);
    limitUrlInput.value = "";
    limitMinutesInput.value = "";
    showButtons();
  });

  ignoreIncognitoCheckbox.addEventListener("change", showButtons);

  globalLimitEnabled.addEventListener("change", function () {
    globalLimitMinutes.disabled = !globalLimitEnabled.checked;
    showButtons();
  });
  globalLimitMinutes.addEventListener("change", showButtons);

  cancelButton.addEventListener("click", async function () {
    ignoreListError.textContent = "";
    limitError.textContent = "";
    globalLimitError.textContent = "";
    await loadOptions();
    hideButtons();
  });

  saveButton.addEventListener("click", async function () {
    globalLimitError.textContent = "";

    const ignoredSites = Array.from(ignoreList.children).map((li) => li.dataset.site);

    const siteLimits = {};
    Array.from(siteLimitsList.children).forEach((li) => {
      siteLimits[li.dataset.site] = Number(li.dataset.minutes);
    });

    let globalDailyLimitMinutes = null;
    if (globalLimitEnabled.checked) {
      const minutes = Number(globalLimitMinutes.value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        globalLimitError.textContent = "Enter a whole number of minutes (1-1440).";
        return;
      }
      globalDailyLimitMinutes = minutes;
    }

    await setSettings({
      ignoredSites,
      ignoreInIncognito: ignoreIncognitoCheckbox.checked,
      siteLimits,
      globalDailyLimitMinutes,
    });

    await loadOptions();
    hideButtons();
  });
});
