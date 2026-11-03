import { getRecentDayStates, getSettings } from "../lib/storage.js";
import { formatCompact, formatHMS } from "../lib/time.js";
import { computeUnderLimitStreak } from "../lib/limits.js";

const BAR_RADIUS = 4;
const MAX_BAR_THICKNESS = 24;
const TOP_SITES_LIMIT = 8;
const WEEKDAY_LABEL_MAX_DAYS = 10; // past this, weekday abbreviations repeat and get confusing

const rangeRow = document.getElementById("range-row");
const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const statRow = document.getElementById("stat-row");
const dailyChartEl = document.getElementById("daily-chart");
const sitesChartEl = document.getElementById("sites-chart");
const categoriesChartEl = document.getElementById("categories-chart");
const tooltipEl = document.getElementById("tooltip");

let currentDays = 7;

document.addEventListener("DOMContentLoaded", async () => {
  rangeRow.querySelectorAll(".range-btn").forEach((button) => {
    button.addEventListener("click", () => {
      currentDays = Number(button.dataset.days);
      render();
    });
  });
  await render();
});

async function render() {
  rangeRow.querySelectorAll(".range-btn").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.days) === currentDays);
  });

  const isMonthly = currentDays > 7;
  pageTitle.textContent = isMonthly ? "Monthly Overview" : "Weekly Overview";
  pageSubtitle.textContent = `Last ${currentDays} days of browsing activity`;

  const [days, previousDays, settings] = await Promise.all([
    getRecentDayStates(currentDays),
    getRecentDayStates(currentDays, currentDays),
    getSettings(),
  ]);

  renderStatTiles(days, previousDays, settings);
  renderDailyChart(days);
  renderSitesChart(days);
  renderCategoriesChart(days, settings);
}

function dateFromKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekdayLabel(dateKey) {
  return dateFromKey(dateKey).toLocaleDateString(undefined, { weekday: "short" });
}

function dayOfMonthLabel(dateKey) {
  return String(dateFromKey(dateKey).getDate());
}

function sumTotal(days) {
  return days.reduce((sum, { state }) => sum + state.tracking.total, 0);
}

function renderStatTiles(days, previousDays, settings) {
  const dailyTotals = days.map((d) => d.state.tracking.total);
  const periodTotal = dailyTotals.reduce((sum, v) => sum + v, 0);
  const dailyAverage = periodTotal / days.length;
  const previousTotal = sumTotal(previousDays);

  let busiestIndex = -1;
  let busiestValue = 0;
  dailyTotals.forEach((value, index) => {
    if (value > busiestValue) {
      busiestValue = value;
      busiestIndex = index;
    }
  });
  const busiestLabel =
    busiestIndex === -1 ? "—" : `${weekdayLabel(days[busiestIndex].dateKey)} · ${formatCompact(busiestValue)}`;

  const timesBlocked = days.reduce((count, { state }) => {
    const siteBlocks = Object.values(state.blocked.sites).filter(Boolean).length;
    return count + siteBlocks + (state.blocked.global ? 1 : 0);
  }, 0);

  const streak = computeUnderLimitStreak(days, settings);
  const streakLabel = settings.globalDailyLimitMinutes ? `${streak} day${streak === 1 ? "" : "s"}` : "—";

  const tiles = [
    { label: `Total this period`, value: formatCompact(periodTotal), delta: trendDelta(periodTotal, previousTotal) },
    { label: "Daily average", value: formatCompact(dailyAverage) },
    { label: "Busiest day", value: busiestLabel },
    { label: "Times blocked", value: String(timesBlocked) },
    { label: "Under-limit streak", value: streakLabel },
  ];

  statRow.innerHTML = "";
  for (const tile of tiles) {
    const tileEl = document.createElement("div");
    tileEl.className = "stat-tile";

    const labelEl = document.createElement("p");
    labelEl.className = "stat-label";
    labelEl.textContent = tile.label;

    const valueEl = document.createElement("p");
    valueEl.className = "stat-value";
    valueEl.textContent = tile.value;

    tileEl.appendChild(labelEl);
    tileEl.appendChild(valueEl);

    if (tile.delta) {
      const deltaEl = document.createElement("span");
      deltaEl.className = `stat-delta delta-${tile.delta.direction}`;
      deltaEl.textContent = tile.delta.label;
      tileEl.appendChild(deltaEl);
    }

    statRow.appendChild(tileEl);
  }
}

// "down" (less time tracked than the prior period) reads as the good
// direction here, since the whole point of this extension is managing time
// spent - the opposite of how a growth metric would be colored.
function trendDelta(current, previous) {
  if (previous <= 0) return current > 0 ? { direction: "up", label: "new activity" } : null;

  const changeRatio = (current - previous) / previous;
  const percent = Math.round(Math.abs(changeRatio) * 100);
  if (percent === 0) return { direction: "flat", label: "= vs. previous period" };

  const arrow = changeRatio > 0 ? "↑" : "↓";
  const direction = changeRatio > 0 ? "up" : "down";
  return { direction, label: `${arrow} ${percent}% vs. previous period` };
}

function roundedTopBarPath(x, y, width, height, radius) {
  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    "Z",
  ].join(" ");
}

function roundedEndBarPath(x, y, width, height, radius) {
  if (width <= 0) return "";
  const r = Math.min(radius, height / 2, width);
  return [
    `M ${x} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `L ${x} ${y + height}`,
    "Z",
  ].join(" ");
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function attachTooltip(groupEl, label, value) {
  const show = (event) => {
    tooltipEl.innerHTML = "";
    const valueSpan = document.createElement("span");
    valueSpan.className = "tooltip-value";
    valueSpan.textContent = value;
    tooltipEl.appendChild(valueSpan);
    tooltipEl.appendChild(document.createTextNode(` · ${label}`));
    tooltipEl.hidden = false;
    const point = "clientX" in event ? event : groupEl.getBoundingClientRect();
    const x = "clientX" in event ? event.clientX : point.left + point.width / 2;
    const y = "clientY" in event ? event.clientY - 12 : point.top;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  };
  const hide = () => {
    tooltipEl.hidden = true;
  };

  groupEl.addEventListener("pointermove", show);
  groupEl.addEventListener("pointerenter", show);
  groupEl.addEventListener("pointerleave", hide);
  groupEl.addEventListener("focus", show);
  groupEl.addEventListener("blur", hide);
}

function renderDailyChart(days) {
  const dailyTotals = days.map((d) => d.state.tracking.total);
  const maxValue = Math.max(...dailyTotals, 1);
  const showValueLabels = days.length <= WEEKDAY_LABEL_MAX_DAYS;
  const axisLabelFor = days.length <= WEEKDAY_LABEL_MAX_DAYS ? weekdayLabel : dayOfMonthLabel;

  const width = 600;
  const height = 220;
  const topPad = 28;
  const bottomPad = 28;
  const plotHeight = height - topPad - bottomPad;
  const slotWidth = width / days.length;
  const barWidth = Math.min(MAX_BAR_THICKNESS, slotWidth * 0.7);

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": "Time tracked per day" });

  svg.appendChild(
    svgEl("line", {
      class: "chart-baseline",
      x1: 0,
      y1: height - bottomPad,
      x2: width,
      y2: height - bottomPad,
    })
  );

  days.forEach((day, index) => {
    const value = dailyTotals[index];
    const barHeight = value > 0 ? Math.max(2, (value / maxValue) * plotHeight) : 0;
    const slotX = index * slotWidth;
    const barX = slotX + (slotWidth - barWidth) / 2;
    const barY = height - bottomPad - barHeight;

    const group = svgEl("g", {
      class: "bar-group",
      tabindex: "0",
      role: "img",
      "aria-label": `${weekdayLabel(day.dateKey)}: ${formatCompact(value)}`,
    });

    if (barHeight > 0) {
      group.appendChild(svgEl("path", { class: "bar", d: roundedTopBarPath(barX, barY, barWidth, barHeight, BAR_RADIUS) }));
    } else {
      group.appendChild(svgEl("rect", { class: "bar", x: barX, y: height - bottomPad - 2, width: barWidth, height: 2 }));
    }

    if (showValueLabels) {
      const valueLabel = svgEl("text", {
        class: "chart-value-label",
        x: slotX + slotWidth / 2,
        y: barY - 8,
        "text-anchor": "middle",
      });
      valueLabel.textContent = formatCompact(value);
      group.appendChild(valueLabel);
    }

    const axisLabel = svgEl("text", {
      class: "chart-axis-label",
      x: slotX + slotWidth / 2,
      y: height - 8,
      "text-anchor": "middle",
    });
    axisLabel.textContent = axisLabelFor(day.dateKey);
    group.appendChild(axisLabel);

    attachTooltip(group, weekdayLabel(day.dateKey), formatHMS(value));
    svg.appendChild(group);
  });

  dailyChartEl.innerHTML = "";
  dailyChartEl.appendChild(svg);
}

// Shared by the "top sites" and "time by category" charts - both are a
// single-hue, sorted-descending horizontal bar comparing magnitude, just
// grouped by a different key.
function renderHorizontalBarChart(containerEl, entries, ariaLabel, emptyMessage) {
  if (entries.length === 0) {
    containerEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = emptyMessage;
    containerEl.appendChild(note);
    return;
  }

  const maxValue = Math.max(...entries.map(([, seconds]) => seconds), 1);

  const width = 600;
  const rowHeight = 36;
  const height = entries.length * rowHeight;
  const labelWidth = 150;
  const plotWidth = width - labelWidth - 60;
  const barHeight = Math.min(MAX_BAR_THICKNESS, rowHeight * 0.6);

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": ariaLabel });

  svg.appendChild(
    svgEl("line", {
      class: "chart-baseline",
      x1: labelWidth,
      y1: 0,
      x2: labelWidth,
      y2: height,
    })
  );

  entries.forEach(([name, seconds], index) => {
    const rowY = index * rowHeight;
    const barY = rowY + (rowHeight - barHeight) / 2;
    const barWidth = Math.max(2, (seconds / maxValue) * plotWidth);

    const group = svgEl("g", {
      class: "bar-group",
      tabindex: "0",
      role: "img",
      "aria-label": `${name}: ${formatCompact(seconds)}`,
    });

    const nameLabel = svgEl("text", {
      class: "chart-axis-label",
      x: labelWidth - 10,
      y: rowY + rowHeight / 2 + 4,
      "text-anchor": "end",
    });
    nameLabel.textContent = name;
    group.appendChild(nameLabel);

    group.appendChild(
      svgEl("path", {
        class: "bar",
        d: roundedEndBarPath(labelWidth, barY, barWidth, barHeight, BAR_RADIUS),
      })
    );

    const valueLabel = svgEl("text", {
      class: "chart-value-label",
      x: labelWidth + barWidth + 8,
      y: rowY + rowHeight / 2 + 4,
      "text-anchor": "start",
    });
    valueLabel.textContent = formatCompact(seconds);
    group.appendChild(valueLabel);

    attachTooltip(group, name, formatHMS(seconds));
    svg.appendChild(group);
  });

  containerEl.innerHTML = "";
  containerEl.appendChild(svg);
}

function renderSitesChart(days) {
  const totals = {};
  for (const { state } of days) {
    for (const [hostname, seconds] of Object.entries(state.tracking.sites)) {
      totals[hostname] = (totals[hostname] || 0) + seconds;
    }
  }

  const topSites = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SITES_LIMIT);

  renderHorizontalBarChart(sitesChartEl, topSites, "Top sites", "No tracked activity yet in this period.");
}

function renderCategoriesChart(days, settings) {
  const totals = {};
  for (const { state } of days) {
    for (const [hostname, seconds] of Object.entries(state.tracking.sites)) {
      const category = settings.siteCategories[hostname] || "Uncategorized";
      totals[category] = (totals[category] || 0) + seconds;
    }
  }

  const categories = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  renderHorizontalBarChart(
    categoriesChartEl,
    categories,
    "Time by category",
    "No tracked activity yet in this period. Assign categories to sites in Options to see a breakdown here."
  );
}
