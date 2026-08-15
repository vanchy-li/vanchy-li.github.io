const STUDY_PATH = "data/mosquito_weekly.csv";
const CLIMATE_PATH = "data/raw/df_ERA5_NDVI_SST_SSTA_long_origin_07052026.csv";
const TRAPS_PATH = "data/geo/ovitraps.geojson";
const TRAP_WEEKLY_PATH = "data/ovitrap_weekly_eggs.csv";
const BOUNDARY_PATH = "data/geo/study-area.geojson";
const LAYER3_PATH = "data/model/layer3_fitted.csv";
const COLORS = { ink: "#18312d", muted: "#6d7b75", grid: "#dfe3dc", orange: "#ff7043", teal: "#176b63", lime: "#d4f251", white: "#fffdf7" };

const PREDICTORS = {
  temperature: { label: "Mean air temperature", unit: "°C", long: "temp_mean", baseline: [1991, 2020] },
  vapor_pressure: { label: "Vapor pressure", unit: "hPa", long: "vp_mean", baseline: [1991, 2020], studyScale: 10 },
  relative_humidity: { label: "Relative humidity", unit: "%", long: "rh_mean", baseline: [1991, 2020] },
  precipitation: { label: "Weekly precipitation", unit: "mm", long: "precip_total_mm", baseline: [1991, 2020], studyScale: 1000 },
  ndvi: { label: "NDVI", unit: "index", long: "NDVI", baseline: [2014, 2020] },
  ssta: { label: "Niño 3.4 SSTA", unit: "°C anomaly", long: "SSTA", officialAnomaly: true }
};

let study = [];
let climate = [];
let monthlyEggMeans = new Map();
let monthlyBaselines = {};
let traps = null;
let boundary = null;
let layer3Fits = [];
let trapWeekly = [];

Promise.all([d3.csv(STUDY_PATH), d3.csv(CLIMATE_PATH), d3.json(TRAPS_PATH), d3.json(BOUNDARY_PATH), d3.csv(LAYER3_PATH), d3.csv(TRAP_WEEKLY_PATH)])
  .then(([studyRows, climateRows, trapGeojson, boundaryGeojson, layer3Rows, trapWeeklyRows]) => {
    study = studyRows.map(row => parseRow(row, "date")).sort((a, b) => a.date - b.date);
    climate = climateRows.map(row => parseRow(row, "dates")).sort((a, b) => a.dates - b.dates);
    traps = trapGeojson;
    boundary = boundaryGeojson;
    layer3Fits = layer3Rows.map(row => parseRow(row, "date"));
    trapWeekly = trapWeeklyRows;
    prepareAnomalies();
    initialise();
  })
  .catch(error => showError(error));

function parseRow(row, dateKey) {
  const parsed = {};
  Object.entries(row).forEach(([key, value]) => {
    if (key === dateKey) parsed[key] = new Date(`${value}T00:00:00`);
    else parsed[key] = value === "" ? null : Number(value);
  });
  return parsed;
}

function initialise() {
  populateSelect("overall-variable", "vapor_pressure");
  populateSelect("anomaly-variable", "ssta");
  updateSummary();
  bindTabs();
  document.getElementById("overall-variable").addEventListener("change", renderOverall);
  document.getElementById("overall-lag").addEventListener("input", renderOverall);
  document.getElementById("anomaly-variable").addEventListener("change", renderAnomaly);
  document.getElementById("anomaly-lag").addEventListener("input", renderAnomaly);
  document.querySelectorAll('input[name="anomaly-scale"]').forEach(input => input.addEventListener("change", changeAnomalyScale));
  document.querySelectorAll('input[name="short-scenario"]').forEach(input => input.addEventListener("change", renderShortTerm));
  renderOverall();
  renderAnomaly();
  renderShortTerm();
  renderEggMap();
  renderPrediction();
}

function populateSelect(id, selected) {
  const select = document.getElementById(id);
  Object.entries(PREDICTORS).forEach(([key, meta]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = meta.label;
    select.appendChild(option);
  });
  select.value = selected;
}

function bindTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      activateTab(tabs[next]);
    });
  });
}

function activateTab(active) {
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    const selected = tab === active;
    tab.setAttribute("aria-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  });
  setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
}

function updateSummary() {
  const observed = study.filter(d => finite(d.total_mean_eggs));
  const peak = observed.reduce((best, row) => row.total_mean_eggs > best.total_mean_eggs ? row : best, observed[0]);
  const formatDate = d3.timeFormat("%b %Y");
  document.getElementById("study-window").textContent = `${formatDate(observed[0].date)} — ${formatDate(observed.at(-1).date)}`;
  document.getElementById("stat-weeks").textContent = observed.length;
  document.getElementById("stat-peak").textContent = d3.format(",.1f")(peak.total_mean_eggs);
  document.getElementById("stat-peak-date").textContent = `mean eggs / trap · ${d3.timeFormat("%d %b %Y")(peak.date)}`;
  document.getElementById("stat-climate").textContent = `${d3.timeYear.count(climate[0].dates, climate.at(-1).dates)}+ yrs`;
  const trapCounts = climate.filter(d => finite(d["Sensor Counts"])).map(d => d["Sensor Counts"]);
  if (trapCounts.length) document.getElementById("stat-traps").textContent = d3.max(trapCounts);
}

function renderOverall() {
  const key = document.getElementById("overall-variable").value;
  const lag = Number(document.getElementById("overall-lag").value);
  const meta = PREDICTORS[key];
  const pairs = alignStudy(key, lag);
  const rho = correlation(rank(pairs.map(d => d.eggs)), rank(pairs.map(d => d.env)));
  document.getElementById("overall-lag-value").textContent = lagLabel(lag);
  document.getElementById("overall-signal-label").textContent = meta.label;
  document.getElementById("overall-signal-unit").textContent = meta.unit;
  document.getElementById("overall-rho").textContent = signed(rho);
  document.getElementById("overall-n").textContent = `${pairs.length} paired weeks`;
  renderDualAxis("overall-plot", pairs, meta, false);
}

function renderEggMap() {
  const parseDate = d3.timeParse("%Y-%m-%d");
  const formatDate = d3.timeFormat("%B %d, %Y");
  const formatNumber = d3.format(",.0f");
  const trapIds = d3.range(1, 35).map(d => `SO-${String(d).padStart(2, "0")}`);
  const rows = trapWeekly.map(row => {
    const values = {};
    trapIds.forEach(id => values[id] = row[id] === "" ? null : +row[id]);
    return {
      date: parseDate(row["Fecha Hasta"]), total: +row["Total Eggs"],
      sensorCount: +row["Sensor Counts"], mean: +row["Total Mean Eggs"],
      week: +row["Week_Number"], values
    };
  });

  traps.features.forEach(feature => {
    const raw = feature.properties.Name || "";
    const match = raw.match(/SO-\d{2}/i);
    feature.properties.trapId = match ? match[0].toUpperCase() : raw;
  });

  const allValues = rows.flatMap(row => trapIds.map(id => row.values[id])).filter(value => value !== null && value > 0);
  const maxValue = d3.max(allValues) || 1;
  const color = d3.scaleSequentialLog([1, maxValue], d3.interpolateYlOrRd);
  const radius = d3.scaleSqrt([0, maxValue], [4, 24]);
  const map = L.map("egg-map", { zoomControl: true, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  map.fitBounds(L.geoJSON(traps).getBounds().pad(.23));

  const markers = new Map();
  traps.features.forEach(feature => {
    const id = feature.properties.trapId;
    const [lon, lat] = feature.geometry.coordinates;
    const marker = L.circleMarker([lat, lon], {
      radius: 4, color: "#fff", weight: 1.4, fillColor: "#d8dedb", fillOpacity: .92
    }).addTo(map);
    marker.on("click", () => selectTrap(id));
    markers.set(id, marker);
  });

  let currentIndex = Math.min(5, rows.length - 1);
  let selectedTrap = null;
  let timer = null;
  const slider = document.getElementById("egg-week-slider");
  const playButton = document.getElementById("egg-play-button");
  slider.max = String(rows.length - 1);
  document.querySelector(".egg-range-labels span:first-child").textContent = d3.timeFormat("%b %Y")(rows[0].date);
  document.querySelector(".egg-range-labels span:last-child").textContent = d3.timeFormat("%b %Y")(rows.at(-1).date);

  function markerStyle(value, selected) {
    const outline = selected ? COLORS.ink : "#fff";
    const weight = selected ? 3 : 1.3;
    if (value === null) return { radius: 4, fillColor: "#cdd5d1", fillOpacity: .45, color: outline, weight };
    if (value === 0) return { radius: 4, fillColor: "#f6e8a7", fillOpacity: .9, color: outline, weight };
    return { radius: radius(value), fillColor: color(value), fillOpacity: .88, color: outline, weight };
  }

  function update(index) {
    currentIndex = index;
    slider.value = String(index);
    const row = rows[index];
    document.getElementById("egg-current-date").textContent = formatDate(row.date);
    document.getElementById("egg-week-number").textContent = `Surveillance week ${row.week}`;
    document.getElementById("egg-total").textContent = formatNumber(row.total);
    document.getElementById("egg-valid-traps").textContent = row.sensorCount;
    document.getElementById("egg-mean").textContent = d3.format(".1f")(row.mean);
    markers.forEach((marker, id) => {
      const value = row.values[id];
      marker.setStyle(markerStyle(value, id === selectedTrap));
      const valueText = value === null ? "No valid observation" : `${formatNumber(value)} eggs`;
      marker.bindTooltip(`<div class="trap-tooltip"><strong>${id}</strong><br><span>${valueText}</span></div>`, { direction: "top", offset: [0, -6] });
    });
    drawTrend();
  }

  function selectTrap(id) {
    selectedTrap = selectedTrap === id ? null : id;
    document.getElementById("egg-trend-title").textContent = selectedTrap || "All ovitraps";
    document.getElementById("egg-selection-note").textContent = selectedTrap
      ? `Showing weekly observed counts at ${selectedTrap}. Click it again to return to the citywide total.`
      : "Showing the citywide weekly total.";
    update(currentIndex);
  }

  function drawTrend() {
    const svg = d3.select("#egg-trend-chart");
    const node = svg.node();
    const width = Math.max(260, node.clientWidth || 360);
    const height = Math.max(170, node.clientHeight || 205);
    const margin = { top: 12, right: 8, bottom: 27, left: 45 };
    svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
    const series = rows.map(row => ({ date: row.date, value: selectedTrap ? row.values[selectedTrap] : row.total }));
    const maxY = d3.max(series, d => d.value === null ? 0 : d.value) || 1;
    const x = d3.scaleTime().domain(d3.extent(rows, d => d.date)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, maxY * 1.06]).nice().range([height - margin.bottom, margin.top]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(3).tickFormat(d3.timeFormat("%b %Y"))).call(g => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s"))).call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").clone().attr("x2", width - margin.left - margin.right).attr("stroke-opacity", .45));
    const line = d3.line().defined(d => d.value !== null).x(d => x(d.date)).y(d => y(d.value));
    svg.append("path").datum(series).attr("fill", "none").attr("stroke", selectedTrap ? COLORS.teal : COLORS.orange).attr("stroke-width", 2.25).attr("d", line);
    const current = series[currentIndex];
    svg.append("line").attr("x1", x(current.date)).attr("x2", x(current.date)).attr("y1", margin.top).attr("y2", height - margin.bottom)
      .attr("stroke", COLORS.ink).attr("stroke-width", 1.2).attr("stroke-dasharray", "3,3");
    if (current.value !== null) svg.append("circle").attr("cx", x(current.date)).attr("cy", y(current.value)).attr("r", 4.5).attr("fill", "#fff").attr("stroke", COLORS.ink).attr("stroke-width", 2);
  }

  slider.addEventListener("input", event => update(+event.target.value));
  playButton.addEventListener("click", () => {
    if (timer) {
      clearInterval(timer); timer = null; playButton.textContent = "Play"; playButton.setAttribute("aria-label", "Play weekly animation"); return;
    }
    playButton.textContent = "Pause"; playButton.setAttribute("aria-label", "Pause weekly animation");
    timer = setInterval(() => update((currentIndex + 1) % rows.length), 650);
  });
  window.addEventListener("resize", drawTrend);
  update(currentIndex);
}

function renderPrediction() {
  const usableStudy = study.map((row, index) => {
    const vpWindow = index >= 2 ? study.slice(index - 2, index + 1).map(d => d.vapor_pressure * 10).filter(finite) : [];
    return {
      date: row.date, observed: row.total_mean_eggs, temp: row.temperature,
      vp3: vpWindow.length === 3 ? d3.mean(vpWindow) : null,
      ssta: row.ssta, ndvi: row.ndvi
    };
  });
  const tempReference = usableStudy.filter(d => finite(d.temp)).map(d => d.temp);
  const vpReference = usableStudy.filter(d => finite(d.vp3)).map(d => d.vp3);
  const tempMean = d3.mean(tempReference), tempSd = d3.deviation(tempReference);
  const vpMean = d3.mean(vpReference), vpSd = d3.deviation(vpReference);
  const rows = usableStudy.filter(d => [d.observed, d.temp, d.vp3, d.ssta, d.ndvi].every(finite)).map(d => {
    const zTemp = (d.temp - tempMean) / tempSd;
    const zVp = (d.vp3 - vpMean) / vpSd;
    const linear = 2.0722 + .6166 * zTemp + 1.0808 * zVp - .8505 * zTemp * zVp + .4960 * d.ssta + 2.7524 * d.ndvi;
    return { ...d, fitted: Math.exp(linear) };
  });
  const r = correlation(rows.map(d => d.observed), rows.map(d => d.fitted));
  document.getElementById("prediction-r").textContent = signed(r);
  document.getElementById("prediction-fit").textContent = `${rows.length} modeled weeks · in sample`;
  Plotly.react("prediction-plot", [
    {
      x: rows.map(d => d.date), y: rows.map(d => d.observed), type: "scatter", mode: "lines",
      name: "Observed", line: { color: COLORS.orange, width: 2.2 },
      hovertemplate: "<b>%{x|%d %b %Y}</b><br>Observed %{y:.1f}<extra></extra>"
    },
    {
      x: rows.map(d => d.date), y: rows.map(d => d.fitted), type: "scatter", mode: "lines",
      name: "NB-GLM fitted", line: { color: "#4f88b6", width: 2.6, dash: "dash" },
      hovertemplate: "<b>%{x|%d %b %Y}</b><br>Fitted %{y:.1f}<extra></extra>"
    }
  ], {
    paper_bgcolor: COLORS.white, plot_bgcolor: COLORS.white, margin: { t: 35, r: 35, b: 50, l: 65 },
    font: { family: "Manrope, sans-serif", color: COLORS.ink, size: 11 }, hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.08 },
    xaxis: { gridcolor: COLORS.grid, tickformat: "%b\n%Y", rangeslider: { visible: true, thickness: .09, bgcolor: "#edf0ea" } },
    yaxis: { title: "Mean eggs per valid trap", gridcolor: COLORS.grid, rangemode: "tozero" },
    shapes: seasonBands(rows.map(d => d.date))
  }, plotConfig());
}

function renderAnomaly() {
  const key = document.getElementById("anomaly-variable").value;
  const lag = Number(document.getElementById("anomaly-lag").value);
  const meta = PREDICTORS[key];
  const scale = document.querySelector('input[name="anomaly-scale"]:checked').value;
  const pairs = scale === "weekly" ? weeklyAnomalyPairs(key, lag) : monthlyAnomalyPairs(key, lag);
  const r = correlation(pairs.map(d => d.eggs), pairs.map(d => d.env));
  document.getElementById("anomaly-lag-value").textContent = scale === "weekly" ? lagLabel(lag) : `${lag} month${lag === 1 ? "" : "s"}`;
  document.getElementById("anomaly-signal-label").textContent = `${meta.label} anomaly`;
  document.getElementById("anomaly-r").textContent = signed(r);
  document.getElementById("anomaly-n").textContent = `${pairs.length} paired ${scale === "weekly" ? "weeks" : "months"} · ${scale === "monthly" ? "sensitivity" : "full sample"}`;
  document.getElementById("anomaly-footnote").textContent = scale === "weekly"
    ? "The zero line marks the expected seasonal value. Weekly lags use the full climate record so all 106 egg observations remain available."
    : "Monthly values average weekly anomalies by calendar month. Aggregation smooths short-term peaks, so this is a descriptive sensitivity analysis.";
  document.getElementById("anomaly-interpretation").textContent = scale === "weekly"
    ? "SSTA reproduced the transition from negative anomalies in season one to positive anomalies in season two, but not weekly peaks."
    : "At monthly resolution, the manuscript’s two-month SSTA model reached R² = 0.724 across 23 observations; it is not directly comparable with the weekly model.";
  renderDualAxis("anomaly-plot", pairs, { ...meta, label: `${meta.label} anomaly` }, true);
}

function changeAnomalyScale() {
  const monthly = document.getElementById("anomaly-monthly").checked;
  const slider = document.getElementById("anomaly-lag");
  slider.max = monthly ? 3 : 8;
  slider.value = monthly ? 2 : 0;
  document.getElementById("anomaly-range-start").textContent = monthly ? "Same month" : "Same week";
  document.getElementById("anomaly-range-end").textContent = monthly ? "3 months prior" : "8 weeks prior";
  renderAnomaly();
}

function weeklyAnomalyPairs(key, lag) {
  const climateByDate = new Map(climate.map(row => [dateKey(row.dates), row]));
  return climate.filter(d => finite(d["Total Mean Eggs"])).map(row => {
    const exposureDate = new Date(row.dates);
    exposureDate.setDate(exposureDate.getDate() - lag * 7);
    const envRow = climateByDate.get(dateKey(exposureDate));
    return { date: row.dates, eggs: row["Total Mean Eggs"] - monthlyEggMeans.get(row.dates.getMonth()), env: envRow ? anomalyValue(envRow, key) : null };
  }).filter(d => finite(d.eggs) && finite(d.env));
}

function monthlyAnomalyPairs(key, lag) {
  const eggWeekly = climate.filter(d => finite(d["Total Mean Eggs"])).map(row => ({
    date: row.dates, value: row["Total Mean Eggs"] - monthlyEggMeans.get(row.dates.getMonth())
  }));
  const firstStudyDate = d3.min(eggWeekly, d => d.date);
  const lastStudyDate = d3.max(eggWeekly, d => d.date);
  const eggMonthly = monthlyMeanMap(eggWeekly);
  const envMonthly = monthlyMeanMap(climate
    .filter(row => row.dates >= firstStudyDate && row.dates <= lastStudyDate)
    .map(row => ({ date: row.dates, value: anomalyValue(row, key) }))
    .filter(d => finite(d.value)));
  return [...eggMonthly.entries()].map(([month, egg]) => {
    const exposure = shiftMonthKey(month, -lag);
    return { date: new Date(`${month}-01T00:00:00`), eggs: egg, env: envMonthly.get(exposure) };
  }).filter(d => finite(d.eggs) && finite(d.env));
}

function monthlyMeanMap(rows) {
  return d3.rollup(rows, values => d3.mean(values, d => d.value), d => d.date.toISOString().slice(0, 7));
}

function shiftMonthKey(key, offset) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function renderDualAxis(id, pairs, meta, anomaly) {
  const traces = [
    { x: pairs.map(d => d.date), y: pairs.map(d => d.eggs), name: anomaly ? "Egg anomaly" : "Egg rate", type: "scatter", mode: "lines", line: { color: COLORS.orange, width: 2.5 }, hovertemplate: `<b>%{x|%d %b %Y}</b><br>%{y:.1f} ${anomaly ? "egg anomaly" : "mean eggs / trap"}<extra></extra>` },
    { x: pairs.map(d => d.date), y: pairs.map(d => d.env), name: meta.label, yaxis: "y2", type: "scatter", mode: "lines", line: { color: COLORS.teal, width: 2 }, hovertemplate: `<b>%{x|%d %b %Y}</b><br>%{y:.2f} ${meta.unit}<extra></extra>` }
  ];
  const shapes = anomaly ? [
    { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#c5cac4", dash: "dot" } },
    { type: "line", xref: "paper", yref: "y2", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#9aa8a2", dash: "dot" } }
  ] : seasonBands(pairs.map(d => d.date));
  Plotly.react(id, traces, {
    paper_bgcolor: COLORS.white, plot_bgcolor: COLORS.white, margin: { t: 35, r: 70, b: 50, l: 65 },
    font: { family: "Manrope, sans-serif", color: COLORS.ink, size: 11 }, hovermode: "x unified", showlegend: false,
    xaxis: { gridcolor: COLORS.grid, rangeslider: { visible: true, thickness: .09, bgcolor: "#edf0ea" }, tickformat: "%b\n%Y" },
    yaxis: { title: anomaly ? "Egg anomaly (eggs / trap)" : "Mean eggs / trap", gridcolor: COLORS.grid, rangemode: anomaly ? "normal" : "tozero" },
    yaxis2: { title: `${meta.label} (${meta.unit})`, overlaying: "y", side: "right", showgrid: false },
    shapes
  }, plotConfig());
}

function renderShortTerm() {
  if (!layer3Fits.length) return;
  const withTemperature = document.getElementById("short-temperature").checked;
  const firstKey = withTemperature ? "spline_temp" : "spline";
  const secondKey = withTemperature ? "spline_lag1_temp" : "spline_lag1";
  document.getElementById("short-chart-title").textContent = withTemperature
    ? "Spline models after adding current-week temperature"
    : "Spline-only and spline + lag-1 models";
  document.getElementById("short-footnote").textContent = withTemperature
    ? "Temperature lets the fitted trajectories respond to short-term thermal variation after controlling the broader temporal pattern."
    : "Both fitted lines control broad seasonality and between-season variation; the lag-1 model additionally uses previous-week egg abundance.";
  Plotly.react("short-plot", [
    { x: layer3Fits.map(d => d.date), y: layer3Fits.map(d => d.observed), type: "scatter", mode: "lines", name: "Observed", line: { color: COLORS.ink, width: 1.4 }, opacity: .55 },
    { x: layer3Fits.map(d => d.date), y: layer3Fits.map(d => d[firstKey]), type: "scatter", mode: "lines", name: withTemperature ? "Spline + temperature" : "Spline only", line: { color: COLORS.teal, width: 2.5 } },
    { x: layer3Fits.map(d => d.date), y: layer3Fits.map(d => d[secondKey]), type: "scatter", mode: "lines", name: withTemperature ? "Spline + lag-1 + temperature" : "Spline + lag-1", line: { color: COLORS.orange, width: 2.3, dash: "dash" } }
  ], {
    paper_bgcolor: COLORS.white, plot_bgcolor: COLORS.white, margin: { t: 25, r: 30, b: 50, l: 60 },
    font: { family: "Manrope, sans-serif", color: COLORS.ink, size: 11 }, hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.12 },
    xaxis: { gridcolor: COLORS.grid, tickformat: "%b\n%Y" },
    yaxis: { title: "Mean eggs per valid trap", gridcolor: COLORS.grid, rangemode: "tozero" },
    shapes: seasonBands(layer3Fits.map(d => d.date))
  }, plotConfig());
}

function prepareAnomalies() {
  const observed = climate.filter(d => finite(d["Total Mean Eggs"]));
  monthlyEggMeans = d3.rollup(observed, values => d3.mean(values, d => d["Total Mean Eggs"]), d => d.dates.getMonth());
  Object.entries(PREDICTORS).forEach(([key, meta]) => {
    if (meta.officialAnomaly) return;
    const rows = climate.filter(d => d.dates.getFullYear() >= meta.baseline[0] && d.dates.getFullYear() <= meta.baseline[1] && finite(d[meta.long]));
    monthlyBaselines[key] = d3.rollup(rows, values => d3.mean(values, d => d[meta.long]), d => d.dates.getMonth());
  });
}

function anomalyValue(row, key) {
  const meta = PREDICTORS[key];
  if (meta.officialAnomaly) return row[meta.long];
  const baseline = monthlyBaselines[key].get(row.dates.getMonth());
  return finite(row[meta.long]) && finite(baseline) ? row[meta.long] - baseline : null;
}

function alignStudy(key, lag) {
  return study.map((row, index) => {
    const envRow = index >= lag ? study[index - lag] : null;
    const scale = PREDICTORS[key].studyScale || 1;
    return { date: row.date, eggs: row.total_mean_eggs, env: envRow && finite(envRow[key]) ? envRow[key] * scale : null };
  }).filter(d => finite(d.eggs) && finite(d.env));
}

function seasonBands(dates) {
  if (!dates.length) return [];
  const shapes = [];
  for (let year = d3.min(dates, d => d.getFullYear()) - 1; year <= d3.max(dates, d => d.getFullYear()); year += 1) {
    shapes.push({ type: "rect", xref: "x", yref: "paper", x0: `${year}-12-01`, x1: `${year + 1}-05-31`, y0: 0, y1: 1, fillcolor: "rgba(255,112,67,.055)", line: { width: 0 }, layer: "below" });
  }
  return shapes;
}

function correlation(xs, ys) {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = d3.mean(xs), my = d3.mean(ys);
  let numerator = 0, dx = 0, dy = 0;
  xs.forEach((x, i) => { numerator += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  return dx && dy ? numerator / Math.sqrt(dx * dy) : null;
}

function rank(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j += 1;
    const average = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) result[sorted[k].index] = average;
    i = j + 1;
  }
  return result;
}

function finite(value) { return value !== null && Number.isFinite(value); }
function dateKey(date) { return date.toISOString().slice(0, 10); }
function lagLabel(lag) { return lag === 0 ? "0 weeks" : `${lag} week${lag === 1 ? "" : "s"}`; }
function signed(value) { return finite(value) ? d3.format("+.2f")(value) : "—"; }
function plotConfig() { return { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] }; }
function showError(error) {
  console.error(error);
  const message = document.getElementById("error-message");
  message.hidden = false;
  message.textContent = "The explorer could not load its data. Open it through a local web server and check the data files.";
}
