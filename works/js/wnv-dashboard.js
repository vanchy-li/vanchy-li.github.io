const DATA_ROOT = "data/wnv";

const state = {
  geojson: null,
  metadata: null,
  metrics: null,
  importance: null,
  summary: null,
  map: null,
  geoLayer: null,
  layer: "suitability",
  county: "All",
  selectedId: null,
};

const palettes = {
  suitability: ["#fff7bc", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#8c2d04"],
  classes: {"Very low":"#ffffcc", Low:"#c2e699", Moderate:"#78c679", High:"#31a354", "Very high":"#006837"},
  agreement: {"True negative":"#eeeeee", "False positive":"#fdae61", "False negative":"#67a9cf", "True positive":"#ca0020"},
};

const layerDefinitions = {
  suitability: {title:"Detection suitability", field:"Predicted_probability"},
  class: {title:"Suitability class", field:"Suitability_class"},
  observed: {title:"Observed reported-positive count", field:"Observed_count"},
  expected: {title:"Predicted expected count", field:"Predicted_expected_count"},
  agreement: {title:"Observed–predicted agreement", field:"Agreement_class"},
  residual: {title:"Prediction error (predicted − observed)", field:"Prediction_error"},
};

function number(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function interpolateColor(colors, t) {
  const bounded = Math.max(0, Math.min(1, t));
  return colors[Math.min(colors.length - 1, Math.floor(bounded * colors.length))];
}

function featureColor(properties) {
  const layer = state.layer;
  if (layer === "class") return palettes.classes[properties.Suitability_class] || "#ddd";
  if (layer === "agreement") return palettes.agreement[properties.Agreement_class] || "#ddd";
  if (layer === "suitability") return interpolateColor(palettes.suitability, Number(properties.Predicted_probability));
  if (layer === "observed") {
    const value = Number(properties.Observed_count);
    return value <= 0 ? "#eeeeee" : interpolateColor(palettes.suitability, Math.log1p(value) / Math.log(36));
  }
  if (layer === "expected") {
    const value = Number(properties.Predicted_expected_count);
    return interpolateColor(palettes.suitability, Math.log1p(value) / Math.log(36));
  }
  const error = Number(properties.Prediction_error);
  if (Math.abs(error) < 0.5) return "#f7f7f7";
  return error < 0 ? interpolateColor(["#d1e5f0", "#67a9cf", "#2166ac", "#053061"], Math.min(1, Math.abs(error) / 25)) : interpolateColor(["#fddbc7", "#ef8a62", "#b2182b", "#67001f"], Math.min(1, error / 25));
}

function featureVisible(properties) {
  return state.county === "All" || properties.County === state.county;
}

function styleFeature(feature) {
  const visible = featureVisible(feature.properties);
  const selected = Number(feature.properties.TOWN_ID) === state.selectedId;
  return {
    fillColor: featureColor(feature.properties), fillOpacity: visible ? 0.84 : 0.08,
    color: selected ? "#101010" : visible ? "#71817b" : "#b7c0bc",
    weight: selected ? 2.2 : 0.55, opacity: visible ? 1 : 0.35,
  };
}

function popupHtml(p) {
  return `<strong>${escapeHtml(p.Town)}</strong><br>${escapeHtml(p.County)} County<br><br>` +
    `Observed: ${p.Observed_count}<br>Suitability: ${number(Number(p.Predicted_probability) * 100, 1)}%<br>` +
    `Expected count: ${number(p.Predicted_expected_count, 2)}`;
}

function updateTownPanel(p) {
  state.selectedId = Number(p.TOWN_ID);
  document.querySelector("#town-name").textContent = p.Town;
  document.querySelector("#town-county").textContent = `${p.County} County · ${p.Year}`;
  document.querySelector("#town-observed").textContent = p.Observed_count;
  document.querySelector("#town-observed-presence").textContent = Number(p.Observed_presence) ? "Reported positive" : "No reported positive";
  document.querySelector("#town-probability").textContent = `${number(Number(p.Predicted_probability) * 100, 1)}%`;
  document.querySelector("#town-class").textContent = p.Suitability_class;
  document.querySelector("#town-expected").textContent = number(p.Predicted_expected_count, 2);
  document.querySelector("#town-conditional").textContent = number(p.Predicted_conditional_count, 2);
  document.querySelector("#town-error").textContent = `${Number(p.Prediction_error) > 0 ? "+" : ""}${number(p.Prediction_error, 2)}`;
  state.geoLayer.setStyle(styleFeature);
}

function onEachFeature(feature, layer) {
  layer.bindPopup(popupHtml(feature.properties));
  layer.on({
    click: () => updateTownPanel(feature.properties),
    mouseover: event => event.target.setStyle({weight: 2, color: "#122623"}),
    mouseout: () => state.geoLayer.setStyle(styleFeature),
  });
}

function updateLegend() {
  const legend = document.querySelector("#map-legend");
  const title = layerDefinitions[state.layer].title;
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
  state.map = L.map("wnv-map", {zoomControl:true, scrollWheelZoom:false}).setView([42.25, -71.8], 7);
  // Use the public OpenStreetMap raster tiles. Unlike the former CARTO URL,
  // this endpoint does not require an API key for this low-traffic research
  // dashboard. Municipality predictions remain a separate GeoJSON overlay.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.map);
  state.geoLayer = L.geoJSON(state.geojson, {style:styleFeature, onEachFeature}).addTo(state.map);
  state.map.fitBounds(state.geoLayer.getBounds(), {padding:[16,16]});
  updateLegend();
}

function populateControls() {
  const counties = [...new Set(state.geojson.features.map(f => f.properties.County))].sort();
  const select = document.querySelector("#county-select");
  counties.forEach(county => select.add(new Option(county, county)));
  document.querySelector("#layer-select").addEventListener("change", event => {
    state.layer = event.target.value; state.geoLayer.setStyle(styleFeature); updateLegend();
  });
  select.addEventListener("change", event => {
    state.county = event.target.value; state.geoLayer.setStyle(styleFeature);
    if (state.county === "All") state.map.fitBounds(state.geoLayer.getBounds(), {padding:[16,16]});
    else {
      const layers = [];
      state.geoLayer.eachLayer(layer => {if (layer.feature.properties.County === state.county) layers.push(layer);});
      if (layers.length) state.map.fitBounds(L.featureGroup(layers).getBounds(), {padding:[24,24]});
    }
  });
  document.querySelector("#reset-map").addEventListener("click", () => {
    state.county = "All"; state.selectedId = null; select.value = "All";
    state.geoLayer.setStyle(styleFeature); state.map.fitBounds(state.geoLayer.getBounds(), {padding:[16,16]});
  });
}

function renderSummary() {
  const summary = state.summary["2026"];
  const presence = state.metrics.presence[0];
  document.querySelector("#stat-observed-towns").textContent = summary.observed_positive_towns;
  document.querySelector("#stat-observed-total").textContent = summary.observed_total;
  document.querySelector("#stat-predicted-towns").textContent = summary.predicted_positive_towns;
  document.querySelector("#stat-balanced-accuracy").textContent = number(presence.Balanced_accuracy, 3);
  document.querySelector("#data-version").textContent = state.metadata.data_version;
  document.querySelector("#generated-at").textContent = new Date(state.metadata.generated_at_utc).toLocaleDateString("en-US", {year:"numeric",month:"short",day:"numeric"});
}

function renderMetrics() {
  const p = state.metrics.presence[0];
  const metrics = [
    ["ROC AUC", p.ROC_AUC, "ranking positive towns"], ["Average precision", p.Average_precision, "precision–recall summary"],
    ["Sensitivity", p.Sensitivity, "share of observed positives detected"], ["Specificity", p.Specificity, "share of observed zeros identified"],
    ["Precision", p.Precision, "share of model positives observed"], ["F1", p.F1, "precision–recall balance"],
    ["Brier score", p.Brier_score, "probability error; lower is better"], ["Threshold", p.Threshold, "selected using training data"],
  ];
  document.querySelector("#metric-grid").innerHTML = metrics.map(([label,value,note]) => `<article><span>${label}</span><strong>${number(value,3)}</strong><small>${note}</small></article>`).join("");
}

function renderImportance(target, rows, color, xTitle) {
  const data = rows.slice().sort((a,b) => Number(b.Importance_mean)-Number(a.Importance_mean)).slice(0,12).reverse();
  Plotly.newPlot(target, [{type:"bar",orientation:"h",y:data.map(d => d.Predictor.replaceAll("_"," ")),x:data.map(d => d.Importance_mean),error_x:{type:"data",array:data.map(d => d.Importance_sd),visible:true,color:"#687873"},marker:{color}}],
    {margin:{l:190,r:20,t:10,b:65},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",color:"#122623",size:11},xaxis:{title:xTitle,gridcolor:"rgba(18,38,35,.12)",zerolinecolor:"#122623"},yaxis:{automargin:true}},
    {responsive:true,displayModeBar:false});
}

async function initialize() {
  try {
    const [geojson, metadata, metrics, importance, summary] = await Promise.all([
      fetch(`${DATA_ROOT}/town_predictions.geojson`).then(r => {if(!r.ok) throw new Error("town_predictions.geojson failed"); return r.json();}),
      fetch(`${DATA_ROOT}/metadata.json`).then(r => r.json()), fetch(`${DATA_ROOT}/model_metrics.json`).then(r => r.json()),
      fetch(`${DATA_ROOT}/feature_importance.json`).then(r => r.json()), fetch(`${DATA_ROOT}/summary.json`).then(r => r.json()),
    ]);
    Object.assign(state, {geojson, metadata, metrics, importance, summary});
    renderSummary(); renderMetrics(); drawMap(); populateControls();
    renderImportance("presence-importance", importance.presence, "#4c88b5", "Decrease in average precision");
    renderImportance("abundance-importance", importance.conditional_abundance, "#d95f59", "Increase in MAE");
    document.querySelector("#loading").classList.add("is-hidden");
  } catch (error) {
    console.error(error);
    document.querySelector("#loading").innerHTML = `<div class="error-message"><strong>Dashboard data could not be loaded.</strong><br>${escapeHtml(error.message)}<br><br>Run this page through a local HTTP server rather than opening the HTML file directly.</div>`;
  }
}

initialize();
