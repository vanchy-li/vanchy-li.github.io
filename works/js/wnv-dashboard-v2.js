const DATA_ROOT = "data/wnv";

const state = {
  boundaries: null, records: [], recordIndex: new Map(), metrics: [], metricIndex: new Map(),
  metadata: null, importance: null, years: [], year: 2026, map: null, geoLayer: null,
  layer: "suitability", county: "All", selectedId: null,
};

const palettes = {
  suitability: ["#fff7bc", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#8c2d04"],
  classes: {"Very low":"#ffffcc", Low:"#c2e699", Moderate:"#78c679", High:"#31a354", "Very high":"#006837"},
  agreement: {"True negative":"#eeeeee", "False positive":"#fdae61", "False negative":"#67a9cf", "True positive":"#ca0020"},
};

const layerDefinitions = {
  suitability: {title:"Detection suitability"}, class: {title:"Suitability class"},
  observed: {title:"Observed reported-positive count"}, expected: {title:"Predicted expected count"},
  agreement: {title:"Observed–predicted agreement"}, residual: {title:"Prediction error (predicted − observed)"},
};

const numericFields = new Set([
  "TOWN_ID", "Year", "Observed_count", "Observed_presence", "Predicted_probability",
  "Predicted_presence", "Presence_threshold", "Predicted_expected_count",
  "Predicted_conditional_count", "Prediction_error", "Test_year", "Threshold",
  "True_negative", "False_positive", "False_negative", "True_positive",
  "Observed_positive_towns", "Predicted_positive_towns", "Sensitivity", "Specificity",
  "Precision", "F1", "Accuracy", "Balanced_accuracy", "ROC_AUC", "Average_precision",
  "Brier_score", "Number_of_towns",
]);

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter(values => values.some(value => value !== "")).map(values =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] === "" ? null : values[index]]))
  );
}

function coerceRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value !== null && numericFields.has(key) ? Number(value) : value]
  )));
}

function number(value, digits = 2) {
  return value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function interpolateColor(colors, t) {
  const bounded = Math.max(0, Math.min(0.999999, t));
  return colors[Math.min(colors.length - 1, Math.floor(bounded * colors.length))];
}

function featureColor(p) {
  if (state.layer === "class") return palettes.classes[p.Suitability_class] || "#d9dedb";
  if (state.layer === "agreement") return palettes.agreement[p.Agreement_class] || "#d9dedb";
  if (state.layer === "suitability") return hasValue(p.Predicted_probability)
    ? interpolateColor(palettes.suitability, Number(p.Predicted_probability)) : "#d9dedb";
  if (state.layer === "observed") {
    const value = Number(p.Observed_count || 0);
    return value <= 0 ? "#eeeeee" : interpolateColor(palettes.suitability, Math.log1p(value) / Math.log(36));
  }
  if (state.layer === "expected") return hasValue(p.Predicted_expected_count)
    ? interpolateColor(palettes.suitability, Math.log1p(Number(p.Predicted_expected_count)) / Math.log(36)) : "#d9dedb";
  if (!hasValue(p.Prediction_error)) return "#d9dedb";
  const error = Number(p.Prediction_error);
  if (Math.abs(error) < 0.5) return "#f7f7f7";
  return error < 0
    ? interpolateColor(["#d1e5f0", "#67a9cf", "#2166ac", "#053061"], Math.min(1, Math.abs(error) / 25))
    : interpolateColor(["#fddbc7", "#ef8a62", "#b2182b", "#67001f"], Math.min(1, error / 25));
}

function styleFeature(feature) {
  const visible = state.county === "All" || feature.properties.County === state.county;
  const selected = Number(feature.properties.TOWN_ID) === state.selectedId;
  return {
    fillColor: featureColor(feature.properties), fillOpacity: visible ? 0.84 : 0.08,
    color: selected ? "#101010" : visible ? "#71817b" : "#b7c0bc",
    weight: selected ? 2.2 : 0.55, opacity: visible ? 1 : 0.35,
  };
}

function recordFor(year, townId) {
  return state.recordIndex.get(`${year}:${townId}`) || null;
}

function applyYearToBoundaries() {
  state.boundaries.features.forEach(feature => {
    const {TOWN_ID, Town, County} = feature.properties;
    const record = recordFor(state.year, Number(TOWN_ID)) || {};
    feature.properties = {...record, TOWN_ID:Number(TOWN_ID), Town, County};
  });
}

function popupHtml(p) {
  const suitability = hasValue(p.Predicted_probability) ? `${number(Number(p.Predicted_probability) * 100, 1)}%` : "Not modeled";
  return `<strong>${escapeHtml(p.Town)}</strong><br>${escapeHtml(p.County)} County · ${state.year}<br><br>` +
    `Observed: ${p.Observed_count ?? "—"}<br>Suitability: ${suitability}<br>Expected count: ${number(p.Predicted_expected_count, 2)}`;
}

function renderTownHistory(townId) {
  const rows = state.records.filter(row => Number(row.TOWN_ID) === Number(townId)).sort((a,b) => a.Year - b.Year);
  const modeled = rows.filter(row => hasValue(row.Predicted_expected_count));
  Plotly.react("town-history", [
    {type:"bar",name:"Observed",x:rows.map(row => row.Year),y:rows.map(row => row.Observed_count),marker:{color:"#9ccfc4"}},
    {type:"scatter",mode:"lines+markers",name:"Expected",x:modeled.map(row => row.Year),y:modeled.map(row => row.Predicted_expected_count),line:{color:"#ffb35c",width:2},marker:{size:6}},
  ], {
    title:{text:"Annual observed and expected counts",font:{size:11,color:"#d9e2df"},x:0},
    margin:{l:34,r:8,t:42,b:34},paper_bgcolor:"transparent",plot_bgcolor:"transparent",
    font:{family:"Manrope, sans-serif",color:"#c7d2ce",size:9},
    xaxis:{dtick:2,gridcolor:"rgba(255,255,255,.08)",zeroline:false},
    yaxis:{rangemode:"tozero",gridcolor:"rgba(255,255,255,.1)",zeroline:false},
    legend:{orientation:"h",x:0,y:1.12,font:{size:9}},
  }, {responsive:true,displayModeBar:false});
}

function resetTownPanel() {
  document.querySelector("#town-name").textContent = "Massachusetts";
  document.querySelector("#town-county").textContent = `Select a municipality to inspect its ${state.year} record.`;
  ["town-observed","town-observed-presence","town-probability","town-class","town-expected","town-conditional","town-error"].forEach(id => {
    document.querySelector(`#${id}`).textContent = "—";
  });
  Plotly.purge("town-history");
}

function updateTownPanel(p) {
  state.selectedId = Number(p.TOWN_ID);
  document.querySelector("#town-name").textContent = p.Town;
  document.querySelector("#town-county").textContent = `${p.County} County · ${state.year}`;
  document.querySelector("#town-observed").textContent = p.Observed_count ?? "—";
  document.querySelector("#town-observed-presence").textContent = Number(p.Observed_presence) ? "Reported positive" : "No reported positive";
  document.querySelector("#town-probability").textContent = hasValue(p.Predicted_probability) ? `${number(Number(p.Predicted_probability) * 100, 1)}%` : "Not modeled";
  document.querySelector("#town-class").textContent = p.Suitability_class || "Not modeled";
  document.querySelector("#town-expected").textContent = number(p.Predicted_expected_count, 2);
  document.querySelector("#town-conditional").textContent = number(p.Predicted_conditional_count, 2);
  document.querySelector("#town-error").textContent = hasValue(p.Prediction_error) ? `${Number(p.Prediction_error) > 0 ? "+" : ""}${number(p.Prediction_error, 2)}` : "—";
  renderTownHistory(p.TOWN_ID);
  state.geoLayer.setStyle(styleFeature);
}

function onEachFeature(feature, layer) {
  layer.bindPopup(popupHtml(feature.properties));
  layer.on({
    click: () => updateTownPanel(feature.properties),
    mouseover: event => event.target.setStyle({weight:2,color:"#122623"}),
    mouseout: () => state.geoLayer.setStyle(styleFeature),
  });
}

function updateLegend() {
  const legend = document.querySelector("#map-legend");
  const title = `${layerDefinitions[state.layer].title} · ${state.year}`;
  let entries = [];
  if (state.layer === "class") entries = Object.entries(palettes.classes);
  else if (state.layer === "agreement") entries = Object.entries(palettes.agreement);
  else if (state.layer === "residual") entries = [["Underpredicted","#2166ac"],["Near zero","#f7f7f7"],["Overpredicted","#b2182b"]];
  else if (state.layer === "observed") entries = [["0 / no report","#eeeeee"],["1","#fff7bc"],["5","#fe9929"],["20+","#8c2d04"]];
  else if (state.layer === "expected") entries = [["Low","#fff7bc"],["Moderate","#fe9929"],["High","#8c2d04"]];
  else entries = [["0.0","#fff7bc"],["0.2","#fec44f"],["0.4","#fe9929"],["0.6","#ec7014"],["0.8+","#8c2d04"]];
  legend.innerHTML = `<strong>${escapeHtml(title)}</strong>${entries.map(([label,color]) => `<div class="legend-row"><i class="legend-swatch" style="background:${color}"></i><span>${escapeHtml(label)}</span></div>`).join("")}`;
}

function drawMap() {
  state.map = L.map("wnv-map",{zoomControl:true,scrollWheelZoom:false}).setView([42.25,-71.8],7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);
  state.geoLayer = L.geoJSON(state.boundaries,{style:styleFeature,onEachFeature}).addTo(state.map);
  state.map.fitBounds(state.geoLayer.getBounds(),{padding:[16,16]});
  updateLegend();
}

function annualRows() {
  return state.records.filter(row => Number(row.Year) === state.year);
}

function renderSummary() {
  const rows = annualRows();
  const metric = state.metricIndex.get(state.year);
  const observedTowns = rows.reduce((sum,row) => sum + Number(row.Observed_presence || 0),0);
  const observedTotal = rows.reduce((sum,row) => sum + Number(row.Observed_count || 0),0);
  const predictedRows = rows.filter(row => hasValue(row.Predicted_presence));
  const predictedTowns = predictedRows.reduce((sum,row) => sum + Number(row.Predicted_presence || 0),0);
  document.querySelector("#stat-observed-towns").textContent = observedTowns.toLocaleString();
  document.querySelector("#stat-observed-total").textContent = observedTotal.toLocaleString();
  document.querySelector("#stat-predicted-towns").textContent = predictedRows.length ? predictedTowns.toLocaleString() : "—";
  document.querySelector("#stat-balanced-accuracy").textContent = metric ? number(metric.Balanced_accuracy,3) : "—";
  document.querySelector("#header-year").textContent = state.year;
  document.querySelector("#data-version").textContent = state.metadata?.data_version || "multi-year export";
  document.querySelector("#generated-at").textContent = state.metadata?.generated_at_utc
    ? new Date(state.metadata.generated_at_utc).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}) : "—";
}

function renderMetrics() {
  const p = state.metricIndex.get(state.year);
  document.querySelector("#evaluation-copy").textContent = p
    ? `The presence model was evaluated on the ${state.year} temporal holdout. Threshold-dependent and ranking metrics answer different questions.`
    : `No out-of-year prediction metrics are available for ${state.year}; the map shows reported observations only.`;
  if (!p) {
    document.querySelector("#metric-grid").innerHTML = `<article><span>${state.year}</span><strong>Observed</strong><small>No holdout prediction exported for this year</small></article>`;
  } else {
    const metrics = [
      ["ROC AUC",p.ROC_AUC,"ranking positive towns"],["Average precision",p.Average_precision,"precision–recall summary"],
      ["Sensitivity",p.Sensitivity,"share of observed positives detected"],["Specificity",p.Specificity,"share of observed zeros identified"],
      ["Precision",p.Precision,"share of model positives observed"],["F1",p.F1,"precision–recall balance"],
      ["Brier score",p.Brier_score,"probability error; lower is better"],["Threshold",p.Threshold,"selected using training data"],
    ];
    document.querySelector("#metric-grid").innerHTML = metrics.map(([label,value,note]) => `<article><span>${label}</span><strong>${number(value,3)}</strong><small>${note}</small></article>`).join("");
  }
  const showImportance = state.year === 2026;
  document.querySelector("#importance-grid").hidden = !showImportance;
  document.querySelector("#importance-note").textContent = showImportance
    ? "Permutation importance shown for the 2026 holdout model."
    : `Permutation importance for ${state.year} will appear after its model-specific export is added.`;
}

function refreshMapForYear() {
  applyYearToBoundaries();
  const byId = new Map(state.boundaries.features.map(feature => [Number(feature.properties.TOWN_ID),feature.properties]));
  state.geoLayer.eachLayer(layer => {
    layer.feature.properties = byId.get(Number(layer.feature.properties.TOWN_ID));
    layer.setPopupContent(popupHtml(layer.feature.properties));
  });
  state.geoLayer.setStyle(styleFeature);
  updateLegend();
  if (state.selectedId !== null) updateTownPanel(byId.get(state.selectedId));
  else resetTownPanel();
}

function populateControls() {
  const yearSelect = document.querySelector("#year-select");
  state.years.slice().reverse().forEach(year => yearSelect.add(new Option(String(year),String(year))));
  yearSelect.value = String(state.year);
  yearSelect.addEventListener("change",event => {
    state.year = Number(event.target.value);
    const hasPredictions = annualRows().some(row => hasValue(row.Predicted_probability));
    if (!hasPredictions && state.layer !== "observed") {
      state.layer = "observed";
      document.querySelector("#layer-select").value = "observed";
    }
    renderSummary(); renderMetrics(); refreshMapForYear();
  });
  const countySelect = document.querySelector("#county-select");
  [...new Set(state.boundaries.features.map(feature => feature.properties.County))].sort().forEach(county => countySelect.add(new Option(county,county)));
  document.querySelector("#layer-select").addEventListener("change",event => {
    state.layer = event.target.value; state.geoLayer.setStyle(styleFeature); updateLegend();
  });
  countySelect.addEventListener("change",event => {
    state.county = event.target.value; state.geoLayer.setStyle(styleFeature);
    if (state.county === "All") state.map.fitBounds(state.geoLayer.getBounds(),{padding:[16,16]});
    else {
      const layers = [];
      state.geoLayer.eachLayer(layer => {if (layer.feature.properties.County === state.county) layers.push(layer);});
      if (layers.length) state.map.fitBounds(L.featureGroup(layers).getBounds(),{padding:[24,24]});
    }
  });
  document.querySelector("#reset-map").addEventListener("click",() => {
    state.county = "All"; state.selectedId = null; countySelect.value = "All";
    resetTownPanel(); state.geoLayer.setStyle(styleFeature); state.map.fitBounds(state.geoLayer.getBounds(),{padding:[16,16]});
  });
}

function renderImportance(target, rows, color, xTitle) {
  const data = rows.slice().sort((a,b) => Number(b.Importance_mean)-Number(a.Importance_mean)).slice(0,12).reverse();
  Plotly.newPlot(target,[{type:"bar",orientation:"h",y:data.map(d => d.Predictor.replaceAll("_"," ")),x:data.map(d => d.Importance_mean),error_x:{type:"data",array:data.map(d => d.Importance_sd),visible:true,color:"#687873"},marker:{color}}],
    {margin:{l:190,r:20,t:10,b:65},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",color:"#122623",size:11},xaxis:{title:xTitle,gridcolor:"rgba(18,38,35,.12)",zerolinecolor:"#122623"},yaxis:{automargin:true}},
    {responsive:true,displayModeBar:false});
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path.split("/").pop()} failed (${response.status})`);
  return response.text();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path.split("/").pop()} failed (${response.status})`);
  return response.json();
}

async function initialize() {
  try {
    const [boundaries,recordText,metricText,metadata,importance] = await Promise.all([
      fetchJson(`${DATA_ROOT}/massachusetts_towns.geojson`),
      fetchText(`${DATA_ROOT}/dashboard_town_year.csv`),
      fetchText(`${DATA_ROOT}/model_metrics_by_year.csv`),
      fetchJson(`${DATA_ROOT}/metadata.json`),
      fetchJson(`${DATA_ROOT}/feature_importance.json`),
    ]);
    state.boundaries = boundaries;
    state.records = coerceRows(parseCsv(recordText));
    state.metrics = coerceRows(parseCsv(metricText));
    state.metadata = metadata;
    state.importance = importance;
    state.recordIndex = new Map(state.records.map(row => [`${row.Year}:${row.TOWN_ID}`,row]));
    state.metricIndex = new Map(state.metrics.map(row => [Number(row.Test_year),row]));
    state.years = [...new Set(state.records.map(row => Number(row.Year)))].sort((a,b) => a-b);
    state.year = state.years.includes(2026) ? 2026 : state.years[state.years.length - 1];
    applyYearToBoundaries();
    renderSummary(); renderMetrics(); drawMap(); populateControls(); resetTownPanel();
    renderImportance("presence-importance",importance.presence,"#4c88b5","Decrease in average precision");
    renderImportance("abundance-importance",importance.conditional_abundance,"#d95f59","Increase in MAE");
    document.querySelector("#loading").classList.add("is-hidden");
  } catch (error) {
    console.error(error);
    document.querySelector("#loading").innerHTML = `<div class="error-message"><strong>Dashboard data could not be loaded.</strong><br>${escapeHtml(error.message)}<br><br>Run this page through a local HTTP server rather than opening the HTML file directly.</div>`;
  }
}

initialize();
