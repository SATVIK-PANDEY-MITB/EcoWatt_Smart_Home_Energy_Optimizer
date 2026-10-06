function normalizeApiBase(base) {
  return String(base || "").trim().replace(/\/$/, "");
}

function resolveCandidateApiBases() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = normalizeApiBase(params.get("api"));
  const saved = normalizeApiBase(localStorage.getItem("ecowattApiBase"));
  const currentOrigin = window.location.port === "3000" ? window.location.origin : "";
  const defaults = [
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ];

  const candidates = [fromQuery, saved, normalizeApiBase(currentOrigin), ...defaults]
    .map(normalizeApiBase)
    .filter(Boolean);

  return [...new Set(candidates)];
}

function resolveApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = normalizeApiBase(params.get("api"));
  if (fromQuery) {
    localStorage.setItem("ecowattApiBase", fromQuery);
    return fromQuery;
  }

  const saved = normalizeApiBase(localStorage.getItem("ecowattApiBase"));
  if (saved) {
    return saved;
  }

  if (window.location.port === "3000") {
    return window.location.origin;
  }

  return "http://localhost:3000";
}

function toAbsoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    if (API_BASE && url.startsWith(`${API_BASE}/`)) {
      return url;
    }
    return url;
  }
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function swapApiBase(url, nextBase) {
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      return `${nextBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch (err) {
      return url;
    }
  }

  return `${nextBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

let API_BASE = resolveApiBase();
const TOKEN_KEY = "ecowattToken";
const FEATURE_GROUP_KEY = "ecowattFeatureGroup";

let breakdownChart;
let trendChart;
let advancedForecastChart;
let autoRefreshTimer;
let latestBreakdown = {};
let latestTrendRows = [];

async function resetStaleFrontendCache() {
  const cacheResetKey = "ecowattCacheResetV2";
  if (localStorage.getItem(cacheResetKey) === "done") {
    return;
  }

  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }
  }

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }

  localStorage.setItem(cacheResetKey, "done");
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function getTheme() {
  return localStorage.getItem("ecowattTheme") || "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ecowattTheme", theme);
}

function toggleTheme() {
  const nextTheme = getTheme() === "light" ? "dark" : "light";
  applyTheme(nextTheme);
}

function setAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  const minutes = Number(document.getElementById("autoRefreshMinutes").value || 5);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return;
  }

  autoRefreshTimer = setInterval(() => {
    refreshDashboard();
  }, minutes * 60 * 1000);
}

function formatNum(value) {
  return Number(value || 0).toFixed(2);
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function clearChartContainer(containerId, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) {
    return null;
  }

  container.innerHTML = "";
  if (emptyMessage) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = emptyMessage;
    container.appendChild(empty);
  }

  return container;
}

function renderBarSvg(containerId, labels, values, color) {
  const container = clearChartContainer(containerId, labels.length ? "" : "No breakdown data yet");
  if (!container || !labels.length) {
    return;
  }

  const width = container.clientWidth || 500;
  const height = 260;
  const padding = { top: 20, right: 18, bottom: 58, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...values, 1);
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none"
  });

  const axisColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#c9d9c9";
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--subtle").trim() || "#4f6d50";

  svg.appendChild(createSvgElement("line", { x1: padding.left, y1: padding.top, x2: padding.left, y2: padding.top + plotHeight, stroke: axisColor, "stroke-width": 1 }));
  svg.appendChild(createSvgElement("line", { x1: padding.left, y1: padding.top + plotHeight, x2: padding.left + plotWidth, y2: padding.top + plotHeight, stroke: axisColor, "stroke-width": 1 }));

  const barGap = 12;
  const barWidth = Math.max(18, (plotWidth - (labels.length - 1) * barGap) / labels.length);

  labels.forEach((label, index) => {
    const value = Number(values[index] || 0);
    const barHeight = Math.max(0, (value / maxValue) * plotHeight);
    const x = padding.left + index * (barWidth + barGap);
    const y = padding.top + plotHeight - barHeight;

    svg.appendChild(createSvgElement("rect", {
      x,
      y,
      width: barWidth,
      height: barHeight,
      rx: 8,
      fill: color,
      opacity: 0.9
    }));

    svg.appendChild(createSvgElement("text", {
      x: x + barWidth / 2,
      y: padding.top + plotHeight + 18,
      "text-anchor": "middle",
      fill: textColor,
      "font-size": 11
    })).textContent = label;

    svg.appendChild(createSvgElement("text", {
      x: x + barWidth / 2,
      y: y - 6,
      "text-anchor": "middle",
      fill: textColor,
      "font-size": 11
    })).textContent = formatNum(value);
  });

  container.appendChild(svg);
}

function renderLineSvg(containerId, labels, values, strokeColor, fillColor) {
  const container = clearChartContainer(containerId, labels.length ? "" : "No 7-day usage data yet");
  if (!container || !labels.length) {
    return;
  }

  const width = container.clientWidth || 500;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 44, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...values, 1);
  const step = labels.length > 1 ? plotWidth / (labels.length - 1) : plotWidth;
  const points = values.map((value, index) => {
    const x = padding.left + index * step;
    const y = padding.top + plotHeight - (Number(value || 0) / maxValue) * plotHeight;
    return { x, y, value: Number(value || 0) };
  });

  const axisColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#c9d9c9";
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--subtle").trim() || "#4f6d50";

  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none"
  });

  svg.appendChild(createSvgElement("line", { x1: padding.left, y1: padding.top, x2: padding.left, y2: padding.top + plotHeight, stroke: axisColor, "stroke-width": 1 }));
  svg.appendChild(createSvgElement("line", { x1: padding.left, y1: padding.top + plotHeight, x2: padding.left + plotWidth, y2: padding.top + plotHeight, stroke: axisColor, "stroke-width": 1 }));

  const pathPoints = points.map(point => `${point.x},${point.y}`).join(" ");
  const baselinePoints = `${padding.left},${padding.top + plotHeight} ${pathPoints} ${padding.left + plotWidth},${padding.top + plotHeight}`;

  svg.appendChild(createSvgElement("polygon", {
    points: baselinePoints,
    fill: fillColor,
    opacity: 0.28
  }));

  svg.appendChild(createSvgElement("polyline", {
    points: pathPoints,
    fill: "none",
    stroke: strokeColor,
    "stroke-width": 3,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  }));

  points.forEach((point, index) => {
    svg.appendChild(createSvgElement("circle", {
      cx: point.x,
      cy: point.y,
      r: 4,
      fill: strokeColor
    }));

    svg.appendChild(createSvgElement("text", {
      x: point.x,
      y: height - 12,
      "text-anchor": "middle",
      fill: textColor,
      "font-size": 11
    })).textContent = labels[index];

    svg.appendChild(createSvgElement("text", {
      x: point.x,
      y: point.y - 8,
      "text-anchor": "middle",
      fill: textColor,
      "font-size": 11
    })).textContent = formatNum(point.value);
  });

  container.appendChild(svg);
}

async function fetchJSON(url, options) {
  const attemptFetch = async requestUrl => {
    const requestOptions = { ...(options || {}) };
    const headers = new Headers(requestOptions.headers || {});

    if (getToken()) {
      headers.set("Authorization", `Bearer ${getToken()}`);
    }

    requestOptions.headers = headers;
    const res = await fetch(requestUrl, requestOptions);
    return res;
  };

  let res;
  try {
    res = await attemptFetch(toAbsoluteUrl(url));
  } catch (err) {
    const candidates = resolveCandidateApiBases();
    let fallbackWorked = false;

    for (const candidate of candidates) {
      if (candidate === API_BASE) continue;

      try {
        const fallbackRes = await attemptFetch(swapApiBase(url, candidate));
        API_BASE = candidate;
        localStorage.setItem("ecowattApiBase", candidate);
        res = fallbackRes;
        fallbackWorked = true;
        break;
      } catch (fallbackErr) {
        // Keep trying remaining candidates.
      }
    }

    if (!fallbackWorked) {
      throw new Error("Cannot reach API server. Start backend with: node server.js, then open http://localhost:3000");
    }
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function updateAuthStatus() {
  const statusNode = document.getElementById("authStatus");

  try {
    const data = await fetchJSON(`${API_BASE}/me`);
    const user = data.user;
    if (data.authenticated) {
      statusNode.textContent = `Signed in as ${user.name} (${user.email})`;
      return;
    }
    statusNode.textContent = "Guest mode active";
  } catch (err) {
    clearToken();
    statusNode.textContent = `Guest mode active (${err.message})`;
  }
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function refreshDashboard() {
  calculate();
}

function setAuthButtonsLoading(isLoading) {
  const registerBtn = document.getElementById("registerBtn");
  const loginBtn = document.getElementById("loginBtn");

  if (registerBtn) registerBtn.disabled = isLoading;
  if (loginBtn) loginBtn.disabled = isLoading;
}

async function register() {
  try {
    const name = document.getElementById("authName").value.trim();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    if (!email || !password) {
      alert("Email and password are required.");
      return;
    }

    if (password.length < 8) {
      alert("Password must be at least 8 characters for registration.");
      return;
    }

    setAuthButtonsLoading(true);

    const data = await fetchJSON(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });

    setToken(data.token);
    await updateAuthStatus();
    await loadAppliances();
    await loadBudget();
    await calculate();
    alert(`Welcome ${data.user.name}, your account is ready.`);
  } catch (err) {
    alert(err.message);
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function login() {
  try {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    if (!email || !password) {
      alert("Enter email and password to login.");
      return;
    }

    setAuthButtonsLoading(true);

    const data = await fetchJSON(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    setToken(data.token);
    await updateAuthStatus();
    await loadAppliances();
    await loadBudget();
    await calculate();
    alert(`Welcome back ${data.user.name}.`);
  } catch (err) {
    alert(err.message);
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function logout() {
  clearToken();
  await updateAuthStatus();
  await loadAppliances();
  await loadBudget();
  await calculate();
}

function updateSummary(data) {
  const breakdownText = Object.keys(data.breakdown || {})
    .map(key => `${key}: ${formatNum(data.breakdown[key])} units`)
    .join("\n");

  const resultText =
    `Units: ${formatNum(data.totalUnits)}\n` +
    `Cost: INR ${formatNum(data.cost)}\n\n` +
    `Predicted Units: ${formatNum(data.predictedUnits)}\n` +
    `Predicted Cost: INR ${formatNum(data.predictedCost)}\n` +
    `Average Daily Units: ${formatNum(data.averageDailyUnits)}\n` +
    `Days Tracked: ${data.daysTracked}\n` +
    `Top Appliance: ${data.topAppliance || "N/A"}\n\n` +
    `--- Breakdown ---\n${breakdownText || "No data"}\n\n` +
    `${data.warning || "No warning"}\n\n` +
    `Tip: ${data.suggestion}`;

  document.getElementById("result").textContent = resultText;
  document.getElementById("totalUnits").textContent = formatNum(data.totalUnits);
  document.getElementById("currentCost").textContent = formatNum(data.cost);
  document.getElementById("projectedCost").textContent = formatNum(data.predictedCost);

  const delta = Number(data.budgetDelta || 0);
  const budgetNode = document.getElementById("budgetDelta");
  budgetNode.textContent = formatNum(delta);
  budgetNode.className = delta < 0 ? "negative" : "positive";
}

function renderBreakdownChart(breakdown) {
  const labels = Object.keys(breakdown || {});
  const values = Object.values(breakdown || {});
  renderBarSvg("chart", labels, values, "rgba(27, 94, 32, 0.82)");
}

function renderTrendChart(trendRows) {
  const labels = trendRows.map(row => row.day.slice(5));
  const values = trendRows.map(row => row.units);
  renderLineSvg("trendChart", labels, values, "rgba(255, 111, 0, 1)", "rgba(255, 111, 0, 0.22)");
}

async function refreshAnalyticsVisuals() {
  if (Object.keys(latestBreakdown).length || latestTrendRows.length) {
    renderBreakdownChart(latestBreakdown);
    renderTrendChart(latestTrendRows);
    return;
  }

  const [summaryRes, trendRes] = await Promise.allSettled([
    fetchJSON(`${API_BASE}/calculate`),
    fetchJSON(`${API_BASE}/usage-trend?days=7`)
  ]);

  if (summaryRes.status === "fulfilled") {
    latestBreakdown = summaryRes.value.breakdown || {};
    renderBreakdownChart(latestBreakdown);
  }

  if (trendRes.status === "fulfilled") {
    latestTrendRows = trendRes.value.trend || [];
    renderTrendChart(latestTrendRows);
  }
}

function renderList(listId, items, formatter) {
  const ul = document.getElementById(listId);
  ul.innerHTML = "";

  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "No data yet";
    ul.appendChild(li);
    return;
  }

  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent = formatter(item);
    ul.appendChild(li);
  });
}

function renderCategoryList(categories) {
  renderList("categoryList", categories, row => `${row.name}: ${formatNum(row.units)} units`);
}

function renderUsageHistory(rows) {
  renderList(
    "usageHistoryList",
    rows,
    row => `${row.date.slice(0, 10)} - ${row.name} - ${formatNum(row.units)} units`
  );
}

function renderReportHistory(rows) {
  renderList(
    "reportHistoryList",
    rows,
    row => `${row.created_at.slice(0, 10)} - ${row.month} - INR ${formatNum(row.cost)} - Delta ${formatNum(row.budget_delta)}`
  );
}

function renderForecastExplanation(data) {
  if (!data || typeof data !== "object") {
    setText("forecastExplanationResult", "Error: Invalid forecast explanation data received");
    return;
  }

  const lines = [];
  
  if (data.month) {
    lines.push(`Month: ${data.month}`);
  }
  
  if (data.recentAverage !== undefined && data.recentAverage !== null) {
    lines.push(`Recent Average: ${formatNum(data.recentAverage)} units/day`);
  }
  
  if (data.reasons && data.reasons.length > 0) {
    lines.push("Reasons:");
    data.reasons.forEach(reason => {
      if (reason) lines.push(`- ${reason}`);
    });
  }
  
  if (data.anomalies && data.anomalies.length > 0) {
    lines.push("Anomalies:");
    data.anomalies.forEach(anomaly => {
      if (anomaly && anomaly.day) {
        const severity = anomaly.severity || "unknown";
        const units = anomaly.units !== undefined ? formatNum(anomaly.units) : "N/A";
        lines.push(`- ${anomaly.day}: ${units} units (${severity})`);
      }
    });
  }
  
  if (lines.length === 0) {
    lines.push("No explanation data available yet. Try adding some appliances and tracking usage.");
  }

  setText("forecastExplanationResult", lines.join("\n"));
}

function renderAnomalies(anomalies) {
  renderList(
    "anomalyList",
    anomalies,
    anomaly => `${anomaly.day}: ${formatNum(anomaly.units)} units (${anomaly.severity})`
  );
}

function renderNotificationDeliveries(rows) {
  renderList(
    "deliveryList",
    rows,
    row => `${row.created_at.slice(0, 16)} | ${row.channel.toUpperCase()} | ${row.status.toUpperCase()} | ${row.subject}`
  );
}

function renderNotificationProviderStatus(status) {
  const lines = [
    `Mode: ${(status.mode || "local").toUpperCase()}`,
    `Webhook Enabled: ${status.webhookEnabled ? "Yes" : "No"}`,
    `Webhook Configured: ${status.webhookConfigured ? "Yes" : "No"}`,
    `Timeout: ${formatNum(status.timeoutMs)} ms`
  ];

  setText("deliveryProviderStatus", lines.join("\n"));
}

function renderDigestSchedule(schedule) {
  const lines = [
    `Enabled: ${schedule.enabled ? "Yes" : "No"}`,
    `Interval: ${schedule.intervalMinutes} minutes`,
    `Channels: ${(schedule.channels || []).join(", ") || "in_app"}`,
    `Last Run: ${schedule.lastRunAt || "Never"}`,
    `Next Run: ${schedule.nextRunAt || "Not scheduled"}`
  ];

  setText("digestScheduleResult", lines.join("\n"));
  document.getElementById("digestEnabled").checked = Boolean(schedule.enabled);
  document.getElementById("digestInterval").value = String(schedule.intervalMinutes || 1440);
  document.getElementById("digestChannelInApp").checked = (schedule.channels || []).includes("in_app");
  document.getElementById("digestChannelPush").checked = (schedule.channels || []).includes("push");
  document.getElementById("digestChannelEmail").checked = (schedule.channels || []).includes("email");
}

function renderAdvancedForecast(data) {
  if (!data || typeof data !== "object") {
    setText("advancedForecastResult", "Error: Invalid advanced forecast data received");
    return;
  }

  const lines = [];
  
  if (data.horizonDays !== undefined && data.horizonDays !== null) {
    lines.push(`Horizon: ${data.horizonDays} days`);
  }
  
  if (data.forecastUnits !== undefined && data.forecastUnits !== null) {
    lines.push(`Forecast Units: ${formatNum(data.forecastUnits)}`);
  }
  
  if (data.forecastCost !== undefined && data.forecastCost !== null) {
    lines.push(`Forecast Cost: INR ${formatNum(data.forecastCost)}`);
  }
  
  if (data.budget !== undefined && data.budget !== null) {
    lines.push(`Budget: INR ${formatNum(data.budget)}`);
  }
  
  if (data.budgetDelta !== undefined && data.budgetDelta !== null) {
    lines.push(`Budget Delta: INR ${formatNum(data.budgetDelta)}`);
  }
  
  if (data.confidence !== undefined && data.confidence !== null) {
    lines.push(`Confidence: ${formatNum(data.confidence)}%`);
  }
  
  if (data.recentAverage !== undefined && data.recentAverage !== null) {
    lines.push(`Recent Avg: ${formatNum(data.recentAverage)} units/day`);
  }
  
  if (data.previousAverage !== undefined && data.previousAverage !== null) {
    lines.push(`Previous Avg: ${formatNum(data.previousAverage)} units/day`);
  }
  
  if (data.growthRate !== undefined && data.growthRate !== null) {
    lines.push(`Growth Rate: ${formatNum(data.growthRate * 100)}%`);
  }
  
  if (data.peakForecastDay) {
    lines.push(`Peak Day: ${data.peakForecastDay}`);
  }
  
  if (data.recommendations && data.recommendations.length > 0) {
    lines.push("Recommendations:");
    data.recommendations.forEach(item => {
      if (item) lines.push(`- ${item}`);
    });
  }
  
  if (data.dailyForecast && data.dailyForecast.length > 0) {
    lines.push("Daily Forecast:");
    data.dailyForecast.slice(0, 10).forEach(item => {
      if (item && item.day) {
        const units = item.units !== undefined ? formatNum(item.units) : "N/A";
        lines.push(`- ${item.day}: ${units} units`);
      }
    });
  }
  
  if (lines.length === 0) {
    lines.push("No forecast data available yet. Try adding some appliances and tracking usage.");
  }

  setText("advancedForecastResult", lines.join("\n"));

  const forecastRows = Array.isArray(data.dailyForecast) ? data.dailyForecast : [];
  const labels = forecastRows.map(item => item.day && item.day.slice ? item.day.slice(5) : "N/A");
  const values = forecastRows.map(item => Number(item.units || 0));

  if (typeof Chart === "undefined") {
    return;
  }

  if (advancedForecastChart) {
    advancedForecastChart.destroy();
  }

  const canvas = document.getElementById("advancedForecastChart");
  if (!canvas) {
    return;
  }

  advancedForecastChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Forecast Units",
        data: values,
        borderColor: "rgba(27, 94, 32, 1)",
        backgroundColor: "rgba(27, 94, 32, 0.18)",
        fill: true,
        tension: 0.25,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

async function deleteAppliance(id) {
  await fetchJSON(`${API_BASE}/appliances/${id}`, { method: "DELETE" });
  await loadAppliances();
  await calculate();
}

async function editAppliance(id) {
  const name = prompt("New appliance name?");
  const category = prompt("New category?");
  const powerValue = prompt("New power (W)?");

  if (!name && !category && !powerValue) {
    return;
  }

  const payload = {};
  if (name) payload.name = name;
  if (category) payload.category = category;
  if (powerValue) payload.power = Number(powerValue);

  await fetchJSON(`${API_BASE}/appliances/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  await loadAppliances();
  await calculate();
}

function renderAlerts(alerts) {
  const ul = document.getElementById("alertsList");
  ul.innerHTML = "";

  if (!alerts.length) {
    const li = document.createElement("li");
    li.textContent = "No active alerts";
    ul.appendChild(li);
    return;
  }

  alerts.forEach(alertItem => {
    const li = document.createElement("li");
    li.textContent = `${alertItem.type.toUpperCase()}: ${alertItem.message}`;
    if (Number(alertItem.acknowledged) === 0) {
      const btn = document.createElement("button");
      btn.className = "secondary inline-action";
      btn.textContent = "Ack";
      btn.onclick = async () => {
        await fetchJSON(`${API_BASE}/alerts/${alertItem.id}/ack`, { method: "POST" });
        await loadAlerts();
      };
      li.appendChild(btn);
    }
    ul.appendChild(li);
  });
}

async function loadAppliances() {
  const appliances = await fetchJSON(`${API_BASE}/appliances`);

  const selector = document.getElementById("appliance_id");
  const simulateSelector = document.getElementById("simulate_appliance_id");
  selector.innerHTML = "";
  simulateSelector.innerHTML = "";

  appliances.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.id} - ${a.name} (${a.power}W, ${a.category || "General"})`;
    selector.appendChild(opt);

    const simOpt = document.createElement("option");
    simOpt.value = a.id;
    simOpt.textContent = `${a.name} (${a.power}W)`;
    simulateSelector.appendChild(simOpt);
  });

  const list = document.getElementById("applianceList");
  list.innerHTML = "";

  if (!appliances.length) {
    const li = document.createElement("li");
    li.textContent = "No appliances yet";
    list.appendChild(li);
    return;
  }

  appliances.forEach(appliance => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${appliance.id}. ${appliance.name} - ${appliance.power}W - ${appliance.category || "General"}`;

    const editButton = document.createElement("button");
    editButton.className = "secondary inline-action";
    editButton.textContent = "Edit";
    editButton.onclick = () => editAppliance(appliance.id);

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary inline-action";
    deleteButton.textContent = "Delete";
    deleteButton.onclick = () => deleteAppliance(appliance.id);

    li.appendChild(label);
    li.appendChild(editButton);
    li.appendChild(deleteButton);
    list.appendChild(li);
  });
}

async function searchAppliances() {
  try {
    const query = document.getElementById("applianceSearch").value.trim();

    // Empty query should restore full list for a predictable UX.
    if (!query) {
      await loadAppliances();
      return;
    }

    const results = await fetchJSON(`${API_BASE}/appliances/search?q=${encodeURIComponent(query)}`);
    renderList(
      "applianceList",
      results,
      appliance => `${appliance.id}. ${appliance.name} - ${appliance.power}W - ${appliance.category || "General"}`
    );
  } catch (err) {
    alert(`Search failed: ${err.message}`);
  }
}

async function loadUsageHistory() {
  try {
    const start = document.getElementById("historyStart").value;
    const end = document.getElementById("historyEnd").value;

    if (start && end && start > end) {
      alert("Start date must be before or equal to end date.");
      return;
    }

    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);

    const query = params.toString();
    const endpoint = query ? `${API_BASE}/usage-history?${query}` : `${API_BASE}/usage-history`;
    const history = await fetchJSON(endpoint);
    renderUsageHistory(history);
  } catch (err) {
    alert(`Usage history load failed: ${err.message}`);
  }
}

async function loadMonthlySummary() {
  const month = getCurrentMonthKey();
  const summary = await fetchJSON(`${API_BASE}/monthly-summary?month=${encodeURIComponent(month)}`);
  setText(
    "monthlySummaryResult",
    `Month: ${summary.month}\n` +
    `Units: ${formatNum(summary.totalUnits)}\n` +
    `Cost: INR ${formatNum(summary.cost)}\n` +
    `Budget: INR ${formatNum(summary.budget)}\n` +
    `Budget Delta: INR ${formatNum(summary.budgetDelta)}\n` +
    `Top Appliance: ${summary.topAppliance || "N/A"}\n` +
    `Alerts: ${summary.alertsCount}`
  );
  renderCategoryList(Object.entries(summary.categoryBreakdown || {}).map(([name, units]) => ({ name, units })));
}

async function loadReportHistory() {
  const rows = await fetchJSON(`${API_BASE}/report-history?limit=10`);
  renderReportHistory(rows);
}

async function generateDigest() {
  const month = getCurrentMonthKey();
  await fetchJSON(`${API_BASE}/digest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month })
  });
  await loadMonthlySummary();
  await loadReportHistory();
}

async function loadBudget() {
  const budgetInfo = await fetchJSON(`${API_BASE}/budget`);
  document.getElementById("budget").value = formatNum(budgetInfo.budget);
}

async function loadAlerts() {
  const alerts = await fetchJSON(`${API_BASE}/alerts`);
  renderAlerts(alerts);

  const prefs = await fetchJSON(`${API_BASE}/notification-preferences`);
  document.getElementById("browserNotifications").checked = Boolean(prefs.browser);
  document.getElementById("inAppNotifications").checked = Boolean(prefs.inApp);

  if (prefs.browser && "Notification" in window && Notification.permission === "granted") {
    alerts.slice(0, 3).forEach(alertItem => {
      new Notification("EcoWatt Alert", { body: alertItem.message });
    });
  }
}

async function saveNotificationPreferences() {
  const browser = document.getElementById("browserNotifications").checked;
  const inApp = document.getElementById("inAppNotifications").checked;

  await fetchJSON(`${API_BASE}/notification-preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browser, inApp })
  });
}

async function enableBrowserNotifications() {
  if (!("Notification" in window)) {
    alert("Browser notifications are not supported here.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("Browser notifications were not enabled.");
    return;
  }

  document.getElementById("browserNotifications").checked = true;
  await saveNotificationPreferences();
  alert("Browser notifications have been enabled.");
}

async function loadAnomalies() {
  const data = await fetchJSON(`${API_BASE}/anomalies`);
  renderAnomalies(data.anomalies || []);
}

async function addAppliance() {
  try {
    const name = document.getElementById("name").value.trim();
    const category = document.getElementById("category").value.trim();
    const power = Number(document.getElementById("power").value);

    if (!name || power <= 0) {
      alert("Enter valid appliance name and power");
      return;
    }

    const data = await fetchJSON(`${API_BASE}/add-appliance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, power })
    });

    document.getElementById("name").value = "";
    document.getElementById("category").value = "";
    document.getElementById("power").value = "";
    await loadAppliances();
    if (data.id) {
      document.getElementById("simulate_appliance_id").value = String(data.id);
    }
    await calculate();
    await loadAlerts();
  } catch (err) {
    alert(err.message);
  }
}

async function simulateUsage() {
  try {
    const appliance_id = Number(document.getElementById("simulate_appliance_id").value);
    const hours = Number(document.getElementById("simulate_hours").value);

    if (appliance_id <= 0 || hours <= 0) {
      setText("simulationResult", "Enter a valid appliance and positive hours.");
      return;
    }

    const data = await fetchJSON(`${API_BASE}/simulate?appliance_id=${appliance_id}&hours=${hours}`);

    setText(
      "simulationResult",
      `Current Cost: INR ${formatNum(data.currentCost)}\n` +
      `Simulated Cost: INR ${formatNum(data.simulatedCost)}\n` +
      `Difference: INR ${formatNum(data.difference)}\n` +
      `Added Units: ${formatNum(data.unitsToAdd)}\n` +
      `Appliance: ${data.appliance.name}`
    );
  } catch (err) {
    setText("simulationResult", `Error: ${err.message}`);
  }
}

async function openReport() {
  window.open(`${API_BASE}/report`, "_blank");
}

async function downloadReportPdf() {
  try {
    const token = getToken();
    const headers = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(toAbsoluteUrl(`${API_BASE}/report.pdf`), { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ecowatt-report.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to download PDF:", err);
    alert("Failed to download PDF report");
  }
}

async function downloadReportCsv() {
  try {
    const token = getToken();
    const headers = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(toAbsoluteUrl(`${API_BASE}/report.csv`), { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ecowatt-report.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to download CSV:", err);
    alert("Failed to download CSV report");
  }
}

async function loadForecastExplanation() {
  try {
    const data = await fetchJSON(`${API_BASE}/forecast-explanation`);
    renderForecastExplanation(data);
  } catch (err) {
    console.error("Failed to load forecast explanation:", err);
    setText("forecastExplanationResult", `Error loading explanation: ${err.message || "Unknown error"}`);
  }
}

async function loadDigestSchedule() {
  const schedule = await fetchJSON(`${API_BASE}/digest-schedule`);
  renderDigestSchedule(schedule);
}

async function saveDigestSchedule() {
  const enabled = document.getElementById("digestEnabled").checked;
  const intervalMinutes = Number(document.getElementById("digestInterval").value || 1440);
  const channels = [];

  if (document.getElementById("digestChannelInApp").checked) channels.push("in_app");
  if (document.getElementById("digestChannelPush").checked) channels.push("push");
  if (document.getElementById("digestChannelEmail").checked) channels.push("email");

  const data = await fetchJSON(`${API_BASE}/digest-schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, intervalMinutes, channels })
  });

  renderDigestSchedule(data.schedule);
}

async function loadNotificationDeliveries() {
  const rows = await fetchJSON(`${API_BASE}/notification-deliveries?limit=20`);
  renderNotificationDeliveries(rows);
}

async function loadNotificationProviderStatus() {
  const status = await fetchJSON(`${API_BASE}/notification-provider-status`);
  renderNotificationProviderStatus(status);
}

async function sendTestDelivery() {
  const channels = ["in_app"];
  if (document.getElementById("digestChannelPush").checked) channels.push("push");
  if (document.getElementById("digestChannelEmail").checked) channels.push("email");

  await fetchJSON(`${API_BASE}/notification-deliveries/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channels,
      subject: "EcoWatt delivery test",
      message: "This test confirms the notification delivery pipeline."
    })
  });

  await loadNotificationDeliveries();
}

async function loadAdvancedForecast() {
  try {
    const data = await fetchJSON(`${API_BASE}/forecast-advanced?days=30`);
    renderAdvancedForecast(data);
  } catch (err) {
    console.error("Failed to load advanced forecast:", err);
    setText("advancedForecastResult", `Error loading advanced forecast: ${err.message || "Unknown error"}`);
  }
}

function showFeatureGroup(group) {
  const allSections = document.querySelectorAll(".feature-section");
  const allButtons = document.querySelectorAll(".feature-nav-btn");

  if (!allSections.length || !allButtons.length) {
    return;
  }

  allSections.forEach(section => {
    const sectionGroup = section.dataset.group || "";
    section.hidden = group !== "all" && sectionGroup !== group;
  });

  allButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.group === group);
    button.setAttribute("aria-pressed", button.dataset.group === group ? "true" : "false");
  });

  localStorage.setItem(FEATURE_GROUP_KEY, group);

  if (group === "analytics") {
    // Delay slightly so canvases are visible before Chart.js measures layout.
    setTimeout(() => {
      refreshAnalyticsVisuals().catch(() => {});
    }, 50);
  }
}

function initFeatureNavigation() {
  const navButtons = document.querySelectorAll(".feature-nav-btn");
  const defaultGroup = navButtons[0] ? navButtons[0].dataset.group : "auth";

  navButtons.forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const group = button.dataset.group || defaultGroup;
      showFeatureGroup(group);
    });
  });

  const savedGroupRaw = localStorage.getItem(FEATURE_GROUP_KEY);
  const allowedGroups = new Set(Array.from(navButtons).map(button => button.dataset.group));
  const savedGroup = allowedGroups.has(savedGroupRaw) ? savedGroupRaw : defaultGroup;
  showFeatureGroup(savedGroup);
}

async function loadDeliveryStats() {
  const stats = await fetchJSON(`${API_BASE}/notification-deliveries/stats`);
  setText("deliveryStatsResult", formatJson(stats));
}

async function retryDeliveryById() {
  const id = Number(document.getElementById("deliveryRetryId").value);
  if (!id) {
    alert("Enter a valid delivery ID.");
    return;
  }

  const result = await fetchJSON(`${API_BASE}/notification-deliveries/${id}/retry`, {
    method: "POST"
  });
  setText("deliveryStatsResult", formatJson(result));
  await loadNotificationDeliveries();
}

async function retryFailedDeliveries() {
  const limit = Number(document.getElementById("deliveryRetryLimit").value || 10);
  const result = await fetchJSON(`${API_BASE}/notification-deliveries/retry-failed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit })
  });
  setText("deliveryStatsResult", formatJson(result));
  await loadNotificationDeliveries();
}

async function exportDeliveriesCsv() {
  try {
    const token = getToken();
    const headers = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(toAbsoluteUrl(`${API_BASE}/notification-deliveries.csv?limit=200`), { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "notification-deliveries.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to export CSV:", err);
    alert("Failed to export deliveries CSV");
  }
}

async function deleteDeliveryById() {
  const id = Number(document.getElementById("deliveryDeleteId").value);
  if (!id) {
    alert("Enter a valid delivery ID.");
    return;
  }

  const result = await fetchJSON(`${API_BASE}/notification-deliveries/${id}`, {
    method: "DELETE"
  });
  setText("deliveryStatsResult", formatJson(result));
  await loadNotificationDeliveries();
}

async function bulkDeleteDeliveries() {
  const status = document.getElementById("deliveryDeleteStatus").value.trim();
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await fetchJSON(`${API_BASE}/notification-deliveries${suffix}`, {
    method: "DELETE"
  });
  setText("deliveryStatsResult", formatJson(result));
  await loadNotificationDeliveries();
}

async function loadDigestPreview() {
  const month = document.getElementById("digestRunMonth").value.trim();
  const suffix = month ? `?month=${encodeURIComponent(month)}` : "";
  const preview = await fetchJSON(`${API_BASE}/digest-preview${suffix}`);
  setText("digestPreviewResult", formatJson(preview));
}

async function runDigestNow() {
  const month = document.getElementById("digestRunMonth").value.trim();
  const result = await fetchJSON(`${API_BASE}/digest/run-now`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month: month || undefined })
  });
  setText("digestPreviewResult", formatJson(result));
  await loadNotificationDeliveries();
  await loadDigestJobStatus();
}

async function loadDigestJobStatus() {
  const status = await fetchJSON(`${API_BASE}/digest-jobs/status`);
  setText("digestJobStatusResult", formatJson(status));
}

async function enableDigestScheduleQuick() {
  const intervalMinutes = Number(document.getElementById("digestEnableInterval").value || 1440);
  const channels = [];
  if (document.getElementById("digestChannelInApp")?.checked) channels.push("in_app");
  if (document.getElementById("digestChannelPush")?.checked) channels.push("push");
  if (document.getElementById("digestChannelEmail")?.checked) channels.push("email");
  if (channels.length === 0) {
    alert("Please select at least one channel for the digest.");
    return;
  }
  const result = await fetchJSON(`${API_BASE}/digest-schedule/enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intervalMinutes, channels })
  });
  setText("digestJobStatusResult", formatJson(result));
  alert("Digest schedule enabled with selected channels.");
  await loadDigestSchedule();
}

async function disableDigestScheduleQuick() {
  const result = await fetchJSON(`${API_BASE}/digest-schedule/disable`, {
    method: "POST"
  });
  setText("digestJobStatusResult", formatJson(result));
  await loadDigestSchedule();
}

async function loadForecastWhatIf() {
  const deltaPercent = Number(document.getElementById("whatIfDelta").value || 0);
  const data = await fetchJSON(`${API_BASE}/forecast-advanced/what-if?days=30&deltaPercent=${encodeURIComponent(deltaPercent)}`);
  setText("whatIfResult", formatJson(data));
}

async function loadForecastRisk() {
  const data = await fetchJSON(`${API_BASE}/forecast-risk?days=30`);
  setText("forecastRiskResult", formatJson(data));
}

async function loadForecastTrendScore() {
  const data = await fetchJSON(`${API_BASE}/forecast-trend-score?days=30`);
  setText("forecastTrendScoreResult", formatJson(data));
}

async function loadForecastWeekdayProfile() {
  const data = await fetchJSON(`${API_BASE}/forecast-weekday-profile?days=30`);
  setText("forecastWeekdayProfileResult", formatJson(data));
}

async function loadForecastSavingsPlan() {
  const data = await fetchJSON(`${API_BASE}/forecast-savings-plan`);
  setText("forecastSavingsPlanResult", formatJson(data));
}

async function loadAlertsSummary() {
  const data = await fetchJSON(`${API_BASE}/alerts/summary`);
  setText("alertsSummaryResult", formatJson(data));
}

async function ackAllAlerts() {
  const data = await fetchJSON(`${API_BASE}/alerts/ack-all`, { method: "POST" });
  setText("alertsSummaryResult", formatJson(data));
  await loadAlerts();
}

async function deleteAlertById() {
  const id = Number(document.getElementById("alertsDeleteId").value);
  if (!id) {
    alert("Enter a valid alert ID.");
    return;
  }

  const data = await fetchJSON(`${API_BASE}/alerts/${id}`, { method: "DELETE" });
  setText("alertsSummaryResult", formatJson(data));
  await loadAlerts();
}

async function bulkDeleteAlerts() {
  const mode = document.getElementById("alertsBulkDeleteAck").value.trim().toLowerCase();
  let suffix = "";
  if (mode === "ack") suffix = "?acknowledged=true";
  if (mode === "pending") suffix = "?acknowledged=false";

  const data = await fetchJSON(`${API_BASE}/alerts${suffix}`, { method: "DELETE" });
  setText("alertsSummaryResult", formatJson(data));
  await loadAlerts();
}

async function loadSustainability() {
  const emissionFactor = Number(document.getElementById("sustainabilityFactor").value || 0.82);
  const data = await fetchJSON(`${API_BASE}/sustainability?emissionFactor=${encodeURIComponent(emissionFactor)}`);
  setText("sustainabilityResult", formatJson(data));
}

async function loadExtendedHealth() {
  const data = await fetchJSON(`${API_BASE}/health/extended`);
  setText("healthExtendedResult", formatJson(data));
}

async function loadMetricsOverview() {
  const data = await fetchJSON(`${API_BASE}/metrics/overview`);
  setText("metricsOverviewResult", formatJson(data));
}

async function addUsage() {
  try {
    const appliance_id = Number(document.getElementById("appliance_id").value);
    const hours = Number(document.getElementById("hours").value);

    if (appliance_id <= 0 || hours <= 0) {
      alert("Select appliance and enter valid hours");
      return;
    }

    await fetchJSON(`${API_BASE}/add-usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliance_id, hours, date: new Date().toISOString() })
    });

    document.getElementById("hours").value = "";
    await calculate();
    await loadAlerts();
  } catch (err) {
    alert(err.message);
  }
}

async function setBudget() {
  try {
    const budget = Number(document.getElementById("budget").value);

    if (budget <= 0) {
      alert("Enter a valid budget amount");
      return;
    }

    await fetchJSON(`${API_BASE}/set-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget })
    });

    await calculate();
    await loadAlerts();
  } catch (err) {
    alert(err.message);
  }
}

async function calculate() {
  try {
    const [summary, trend, top, categoryData] = await Promise.all([
      fetchJSON(`${API_BASE}/calculate`),
      fetchJSON(`${API_BASE}/usage-trend?days=7`),
      fetchJSON(`${API_BASE}/top-appliances?limit=5`),
      fetchJSON(`${API_BASE}/category-analytics`)
    ]);

    updateSummary(summary);
    latestBreakdown = summary.breakdown || {};
    latestTrendRows = trend.trend || [];
    renderBreakdownChart(summary.breakdown || {});
    renderTrendChart(trend.trend || []);
    renderList("topAppliances", top, row => `${row.name}: ${formatNum(row.units)} units`);
    renderList("tipsList", summary.recommendedTips || [], tip => tip);
    renderCategoryList(categoryData.categories || []);

    await Promise.allSettled([
      loadAlerts(),
      loadUsageHistory(),
      loadReportHistory(),
      loadAnomalies(),
      loadForecastExplanation(),
      loadAdvancedForecast(),
      loadNotificationDeliveries(),
      loadNotificationProviderStatus()
    ]);
  } catch (err) {
    document.getElementById("result").textContent = `Error: ${err.message}`;
  }
}

function getCurrentMonthKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    await resetStaleFrontendCache();
    initFeatureNavigation();

    const passwordNode = document.getElementById("authPassword");
    if (passwordNode) {
      passwordNode.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          login();
        }
      });
    }

    applyTheme(getTheme());
    await updateAuthStatus();
    await loadAppliances();
    await loadBudget();
    await loadAlerts();
    await loadDigestSchedule();
    await loadNotificationDeliveries();
    await loadNotificationProviderStatus();
    await loadDeliveryStats();
    await loadDigestPreview();
    await loadDigestJobStatus();
    await loadForecastRisk();
    await loadForecastTrendScore();
    await loadForecastWeekdayProfile();
    await loadForecastSavingsPlan();
    await loadAlertsSummary();
    await loadSustainability();
    await loadExtendedHealth();
    await loadMetricsOverview();
    await calculate();
    await loadMonthlySummary();
    await loadReportHistory();
    await loadAnomalies();
    await loadForecastExplanation();
    await loadAdvancedForecast();
    setAutoRefresh();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  } catch (err) {
    document.getElementById("result").textContent = `Startup error: ${err.message}`;
  }
});