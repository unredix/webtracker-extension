import { getRecentDayStates } from "../lib/storage.js";
import { formatCompact, formatHMS } from "../lib/time.js";

const DAYS = 7;
const BAR_RADIUS = 4;
const MAX_BAR_THICKNESS = 24;
const TOP_SITES_LIMIT = 8;

const statRow = document.getElementById("stat-row");
const dailyChartEl = document.getElementById("daily-chart");
const sitesChartEl = document.getElementById("sites-chart");
const tooltipEl = document.getElementById("tooltip");

document.addEventListener("DOMContentLoaded", async () => {
  const days = await getRecentDayStates(DAYS);
  renderStatTiles(days);
  renderDailyChart(days);
  renderSitesChart(days);
});

function dateFromKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekdayLabel(dateKey) {
  return dateFromKey(dateKey).toLocaleDateString(undefined, { weekday: "short" });
}

function renderStatTiles(days) {
  const dailyTotals = days.map((d) => d.state.tracking.total);
  const weekTotal = dailyTotals.reduce((sum, v) => sum + v, 0);
  const dailyAverage = weekTotal / DAYS;

  let busiestIndex = -1;
  let busiestValue = 0;
  dailyTotals.forEach((value, index) => {
    if (value > busiestValue) {
      busiestValue = value;
      busiestIndex = index;
    }
  });
  const busiestLabel = busiestIndex === -1 ? "—" : `${weekdayLabel(days[busiestIndex].dateKey)} · ${formatCompact(busiestValue)}`;

  const timesBlocked = days.reduce((count, { state }) => {
    const siteBlocks = Object.values(state.blocked.sites).filter(Boolean).length;
    return count + siteBlocks + (state.blocked.global ? 1 : 0);
  }, 0);

  const tiles = [
    { label: "Total this week", value: formatCompact(weekTotal) },
    { label: "Daily average", value: formatCompact(dailyAverage) },
    { label: "Busiest day", value: busiestLabel },
    { label: "Times blocked", value: String(timesBlocked) },
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
    statRow.appendChild(tileEl);
  }
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

  const width = 600;
  const height = 220;
  const topPad = 28;
  const bottomPad = 28;
  const plotHeight = height - topPad - bottomPad;
  const slotWidth = width / days.length;
  const barWidth = Math.min(MAX_BAR_THICKNESS, slotWidth * 0.5);

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

    const valueLabel = svgEl("text", {
      class: "chart-value-label",
      x: slotX + slotWidth / 2,
      y: barY - 8,
      "text-anchor": "middle",
    });
    valueLabel.textContent = formatCompact(value);
    group.appendChild(valueLabel);

    const axisLabel = svgEl("text", {
      class: "chart-axis-label",
      x: slotX + slotWidth / 2,
      y: height - 8,
      "text-anchor": "middle",
    });
    axisLabel.textContent = weekdayLabel(day.dateKey);
    group.appendChild(axisLabel);

    attachTooltip(group, weekdayLabel(day.dateKey), formatHMS(value));
    svg.appendChild(group);
  });

  dailyChartEl.innerHTML = "";
  dailyChartEl.appendChild(svg);
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

  if (topSites.length === 0) {
    sitesChartEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No tracked activity yet this week.";
    sitesChartEl.appendChild(note);
    return;
  }

  const maxValue = Math.max(...topSites.map(([, seconds]) => seconds), 1);

  const width = 600;
  const rowHeight = 36;
  const height = topSites.length * rowHeight;
  const labelWidth = 150;
  const plotWidth = width - labelWidth - 60;
  const barHeight = Math.min(MAX_BAR_THICKNESS, rowHeight * 0.6);

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": "Top sites this week" });

  svg.appendChild(
    svgEl("line", {
      class: "chart-baseline",
      x1: labelWidth,
      y1: 0,
      x2: labelWidth,
      y2: height,
    })
  );

  topSites.forEach(([hostname, seconds], index) => {
    const rowY = index * rowHeight;
    const barY = rowY + (rowHeight - barHeight) / 2;
    const barWidth = Math.max(2, (seconds / maxValue) * plotWidth);

    const group = svgEl("g", {
      class: "bar-group",
      tabindex: "0",
      role: "img",
      "aria-label": `${hostname}: ${formatCompact(seconds)}`,
    });

    const nameLabel = svgEl("text", {
      class: "chart-axis-label",
      x: labelWidth - 10,
      y: rowY + rowHeight / 2 + 4,
      "text-anchor": "end",
    });
    nameLabel.textContent = hostname;
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

    attachTooltip(group, hostname, formatHMS(seconds));
    svg.appendChild(group);
  });

  sitesChartEl.innerHTML = "";
  sitesChartEl.appendChild(svg);
}
