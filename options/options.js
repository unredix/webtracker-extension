import { getSettings, setSettings, normalizeHostname, getKnownHostnames } from "../lib/storage.js";
import { formatMinutes } from "../lib/time.js";
import { parseTimeToHours, formatHoursToTime } from "../lib/limits.js";

const PERIOD_MAX_MINUTES = { day: 1440, week: 10080, month: 44640 };
const PERIOD_LABEL = { day: "day", week: "week", month: "month" };

document.addEventListener("DOMContentLoaded", async function () {
  const ignoreListInput = document.getElementById("ignore-url");
  const ignoreListError = document.getElementById("ignore-url-error");
  const ignoreList = document.getElementById("ignored-sites-list");
  const ignoreIncognitoCheckbox = document.getElementById("ignore-incog");

  const limitUrlInput = document.getElementById("limit-url");
  const limitMinutesInput = document.getElementById("limit-minutes");
  const limitPeriodSelect = document.getElementById("limit-period");
  const limitError = document.getElementById("limit-error");
  const addLimitButton = document.getElementById("add-limit");
  const siteLimitsList = document.getElementById("site-limits-list");
  const limitPresets = document.getElementById("limit-presets");
  const limitMinutesPreview = document.getElementById("limit-minutes-preview");

  const globalLimitEnabled = document.getElementById("global-limit-enabled");
  const globalLimitMinutes = document.getElementById("global-limit-minutes");
  const globalLimitError = document.getElementById("global-limit-error");
  const globalLimitPresets = document.getElementById("global-limit-presets");
  const globalLimitMinutesPreview = document.getElementById("global-limit-minutes-preview");

  const globalWeeklyLimitEnabled = document.getElementById("global-weekly-limit-enabled");
  const globalWeeklyLimitMinutes = document.getElementById("global-weekly-limit-minutes");
  const globalWeeklyLimitPresets = document.getElementById("global-weekly-limit-presets");
  const globalWeeklyLimitMinutesPreview = document.getElementById("global-weekly-limit-minutes-preview");

  const globalMonthlyLimitEnabled = document.getElementById("global-monthly-limit-enabled");
  const globalMonthlyLimitMinutes = document.getElementById("global-monthly-limit-minutes");
  const globalMonthlyLimitPresets = document.getElementById("global-monthly-limit-presets");
  const globalMonthlyLimitMinutesPreview = document.getElementById("global-monthly-limit-minutes-preview");

  const graceMinutesInput = document.getElementById("grace-minutes");
  const graceError = document.getElementById("grace-error");

  const scheduleUrlInput = document.getElementById("schedule-url");
  const scheduleStartInput = document.getElementById("schedule-start");
  const scheduleEndInput = document.getElementById("schedule-end");
  const addScheduleButton = document.getElementById("add-schedule");
  const scheduleError = document.getElementById("schedule-error");
  const schedulesList = document.getElementById("schedules-list");

  const knownHostsList = document.getElementById("known-hosts");

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

  function makeListItem(labelText) {
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
      showButtons();
    });

    const label = document.createElement("span");
    label.textContent = labelText;

    listItem.appendChild(deleteButton);
    listItem.appendChild(label);
    return listItem;
  }

  function addIgnoredSiteItem(hostname) {
    const listItem = makeListItem(hostname);
    listItem.dataset.site = hostname;
    ignoreList.appendChild(listItem);
  }

  function addSiteLimitItem(hostname, minutes, period) {
    const listItem = makeListItem(`${hostname} — ${formatMinutes(minutes)} / ${PERIOD_LABEL[period]}`);
    listItem.dataset.site = hostname;
    listItem.dataset.minutes = String(minutes);
    listItem.dataset.period = period;
    siteLimitsList.appendChild(listItem);
  }

  function addScheduleItem(hostname, startHour, endHour) {
    const listItem = makeListItem(`${hostname} — ${formatHoursToTime(startHour)} to ${formatHoursToTime(endHour)}`);
    listItem.dataset.site = hostname;
    listItem.dataset.startHour = String(startHour);
    listItem.dataset.endHour = String(endHour);
    schedulesList.appendChild(listItem);
  }

  function setGlobalRow(enabledEl, minutesEl, value) {
    if (value) {
      enabledEl.checked = true;
      minutesEl.value = value;
      minutesEl.disabled = false;
    } else {
      enabledEl.checked = false;
      minutesEl.value = "";
      minutesEl.disabled = true;
    }
  }

  async function loadOptions() {
    const settings = await getSettings();

    ignoreList.innerHTML = "";
    settings.ignoredSites.forEach(addIgnoredSiteItem);

    siteLimitsList.innerHTML = "";
    Object.entries(settings.siteLimits).forEach(([hostname, minutes]) => addSiteLimitItem(hostname, minutes, "day"));
    Object.entries(settings.siteWeeklyLimits).forEach(([hostname, minutes]) => addSiteLimitItem(hostname, minutes, "week"));
    Object.entries(settings.siteMonthlyLimits).forEach(([hostname, minutes]) => addSiteLimitItem(hostname, minutes, "month"));

    schedulesList.innerHTML = "";
    Object.entries(settings.siteSchedules).forEach(([hostname, schedule]) =>
      addScheduleItem(hostname, schedule.startHour, schedule.endHour)
    );

    ignoreIncognitoCheckbox.checked = settings.ignoreInIncognito;

    setGlobalRow(globalLimitEnabled, globalLimitMinutes, settings.globalDailyLimitMinutes);
    setGlobalRow(globalWeeklyLimitEnabled, globalWeeklyLimitMinutes, settings.globalWeeklyLimitMinutes);
    setGlobalRow(globalMonthlyLimitEnabled, globalMonthlyLimitMinutes, settings.globalMonthlyLimitMinutes);

    graceMinutesInput.value = settings.graceMinutes || "";
  }

  async function populateKnownHosts() {
    const hostnames = await getKnownHostnames();
    knownHostsList.innerHTML = "";
    hostnames.forEach((hostname) => {
      const option = document.createElement("option");
      option.value = hostname;
      knownHostsList.appendChild(option);
    });
  }

  function updatePreview(input, previewEl) {
    const minutes = Number(input.value);
    previewEl.textContent = Number.isFinite(minutes) && minutes > 0 ? `= ${formatMinutes(minutes)}` : "";
  }

  function wirePresets(presetsEl, input, previewEl) {
    presetsEl.querySelectorAll(".preset-btn").forEach((button) => {
      button.addEventListener("click", function () {
        input.value = button.dataset.minutes;
        updatePreview(input, previewEl);
        input.dispatchEvent(new Event("change"));
      });
    });
    input.addEventListener("input", () => updatePreview(input, previewEl));
  }

  function wireGlobalRow(enabledEl, minutesEl) {
    enabledEl.addEventListener("change", function () {
      minutesEl.disabled = !enabledEl.checked;
      showButtons();
    });
    minutesEl.addEventListener("change", showButtons);
  }

  wirePresets(limitPresets, limitMinutesInput, limitMinutesPreview);
  wirePresets(globalLimitPresets, globalLimitMinutes, globalLimitMinutesPreview);
  wirePresets(globalWeeklyLimitPresets, globalWeeklyLimitMinutes, globalWeeklyLimitMinutesPreview);
  wirePresets(globalMonthlyLimitPresets, globalMonthlyLimitMinutes, globalMonthlyLimitMinutesPreview);

  wireGlobalRow(globalLimitEnabled, globalLimitMinutes);
  wireGlobalRow(globalWeeklyLimitEnabled, globalWeeklyLimitMinutes);
  wireGlobalRow(globalMonthlyLimitEnabled, globalMonthlyLimitMinutes);

  function refreshAllPreviews() {
    updatePreview(limitMinutesInput, limitMinutesPreview);
    updatePreview(globalLimitMinutes, globalLimitMinutesPreview);
    updatePreview(globalWeeklyLimitMinutes, globalWeeklyLimitMinutesPreview);
    updatePreview(globalMonthlyLimitMinutes, globalMonthlyLimitMinutesPreview);
  }

  await loadOptions();
  await populateKnownHosts();
  refreshAllPreviews();

  function addLimitFromInputs() {
    limitError.textContent = "";

    const hostname = normalizeHostname(limitUrlInput.value);
    if (!hostname) {
      limitError.textContent = "Enter a valid site (e.g. example.com).";
      return;
    }

    const period = limitPeriodSelect.value;
    const maxMinutes = PERIOD_MAX_MINUTES[period] || PERIOD_MAX_MINUTES.day;
    const minutes = Number(limitMinutesInput.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > maxMinutes) {
      limitError.textContent = `Enter a whole number of minutes (1-${maxMinutes}).`;
      return;
    }

    const existing = Array.from(siteLimitsList.children);
    const duplicate = existing.find((li) => li.dataset.site === hostname && li.dataset.period === period);
    if (duplicate) duplicate.remove();

    addSiteLimitItem(hostname, minutes, period);
    limitUrlInput.value = "";
    limitMinutesInput.value = "";
    limitMinutesPreview.textContent = "";
    showButtons();
  }

  function addScheduleFromInputs() {
    scheduleError.textContent = "";

    const hostname = normalizeHostname(scheduleUrlInput.value);
    if (!hostname) {
      scheduleError.textContent = "Enter a valid site (e.g. example.com).";
      return;
    }

    const startHour = parseTimeToHours(scheduleStartInput.value);
    const endHour = parseTimeToHours(scheduleEndInput.value);
    if (startHour === null || endHour === null || startHour >= endHour) {
      scheduleError.textContent = "Enter a start time earlier than the end time.";
      return;
    }

    const existing = Array.from(schedulesList.children);
    const duplicate = existing.find((li) => li.dataset.site === hostname);
    if (duplicate) duplicate.remove();

    addScheduleItem(hostname, startHour, endHour);
    scheduleUrlInput.value = "";
    showButtons();
  }

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

  addLimitButton.addEventListener("click", addLimitFromInputs);

  [limitUrlInput, limitMinutesInput].forEach((input) => {
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addLimitFromInputs();
    });
  });

  addScheduleButton.addEventListener("click", addScheduleFromInputs);
  scheduleUrlInput.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addScheduleFromInputs();
  });

  ignoreIncognitoCheckbox.addEventListener("change", showButtons);
  graceMinutesInput.addEventListener("change", showButtons);

  cancelButton.addEventListener("click", async function () {
    ignoreListError.textContent = "";
    limitError.textContent = "";
    globalLimitError.textContent = "";
    graceError.textContent = "";
    scheduleError.textContent = "";
    await loadOptions();
    refreshAllPreviews();
    hideButtons();
  });

  function readGlobalRow(enabledEl, minutesEl, maxMinutes) {
    if (!enabledEl.checked) return { value: null, valid: true };
    const minutes = Number(minutesEl.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > maxMinutes) return { value: null, valid: false };
    return { value: minutes, valid: true };
  }

  saveButton.addEventListener("click", async function () {
    globalLimitError.textContent = "";
    graceError.textContent = "";

    const ignoredSites = Array.from(ignoreList.children).map((li) => li.dataset.site);

    const siteLimits = {};
    const siteWeeklyLimits = {};
    const siteMonthlyLimits = {};
    Array.from(siteLimitsList.children).forEach((li) => {
      const target = { day: siteLimits, week: siteWeeklyLimits, month: siteMonthlyLimits }[li.dataset.period] || siteLimits;
      target[li.dataset.site] = Number(li.dataset.minutes);
    });

    const siteSchedules = {};
    Array.from(schedulesList.children).forEach((li) => {
      siteSchedules[li.dataset.site] = {
        startHour: Number(li.dataset.startHour),
        endHour: Number(li.dataset.endHour),
      };
    });

    const daily = readGlobalRow(globalLimitEnabled, globalLimitMinutes, PERIOD_MAX_MINUTES.day);
    const weekly = readGlobalRow(globalWeeklyLimitEnabled, globalWeeklyLimitMinutes, PERIOD_MAX_MINUTES.week);
    const monthly = readGlobalRow(globalMonthlyLimitEnabled, globalMonthlyLimitMinutes, PERIOD_MAX_MINUTES.month);
    if (!daily.valid || !weekly.valid || !monthly.valid) {
      globalLimitError.textContent = "Enter a whole number of minutes within range for each enabled global limit.";
      return;
    }

    const graceMinutes = graceMinutesInput.value ? Number(graceMinutesInput.value) : 0;
    if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
      graceError.textContent = "Grace period must be a whole number of minutes (0-120).";
      return;
    }

    await setSettings({
      ignoredSites,
      ignoreInIncognito: ignoreIncognitoCheckbox.checked,
      siteLimits,
      siteWeeklyLimits,
      siteMonthlyLimits,
      globalDailyLimitMinutes: daily.value,
      globalWeeklyLimitMinutes: weekly.value,
      globalMonthlyLimitMinutes: monthly.value,
      graceMinutes,
      siteSchedules,
    });

    await loadOptions();
    refreshAllPreviews();
    await populateKnownHosts();
    hideButtons();
  });
});
