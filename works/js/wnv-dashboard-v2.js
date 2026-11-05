const DATA_ROOT = "data/wnv";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const state = {
  boundaries: null, countyBoundaries: null, monthly: [], townRows: [], countyRows: [], stateRows: [],
  correlationRows: [], correlationMonth: "All", correlationOutcome: "count",
  correlationLag: "same", correlationPredictor: "air_temperature_c_mean",
  allTownRows: [], allCountyRows: [], allStateRows: [],
  townIndex: new Map(), countyIndex: new Map(), stateIndex: new Map(),
  metrics: [], metricIndex: new Map(), metadata: null, importance: null,
  predictions: [], modelComparison: [], rollingMetrics: [], rfPresenceImportance: [], rfCountImportance: [], rollingPresenceImportance: [], rollingCountImportance: [], rfMetadata: null, rollingMetadata: null,
  predictionYear: 2026, predictionMetric: "probability", predictionMap: null, predictionLayer: null,
  years: [], year: 2026, yearStart: 2026, yearEnd: 2026,
  months: [6, 7, 8, 9], month: 9, monthStart: 9, monthEnd: 9,
  county: "All", selectedId: null, selectedIds: new Set(), map: null, geoLayer: null, countyLayer: null,
  playTimer: null,
};

const correlationPredictors = {
  air_temperature_c_mean:"Mean air temperature (°C)",
  precipitation_mm_total:"Total precipitation (mm)",
  vapor_pressure_hpa_mean:"Mean vapor pressure (hPa)",
  NDVI_mean:"Mean NDVI", VBI_mean:"Mean VBI", MNDWI_mean:"Mean MNDWI",
  LST_Day_1km_C_mean:"Mean daytime LST (°C)",
  LST_Night_1km_C_mean:"Mean nighttime LST (°C)",
  LST_diurnal_1km_C_mean:"Mean diurnal LST range (°C)",
  nlcd_prop_developed_total:"Developed land (%)",
  nlcd_mean_impervious_pct:"Impervious surface (%)",
  nlcd_prop_forest_total:"Forest cover (%)",
  nlcd_prop_wetland_total:"Wetland cover (%)",
  nlcd_prop_open_water:"Open water (%)",
  nlcd_prop_grassland:"Grassland cover (%)",
  nlcd_shannon_diversity:"Landscape diversity",
};

const landscapePredictors = new Set([
  "nlcd_prop_developed_total", "nlcd_mean_impervious_pct",
  "nlcd_prop_forest_total", "nlcd_prop_wetland_total",
  "nlcd_prop_open_water", "nlcd_prop_grassland",
  "nlcd_shannon_diversity",
]);

const numericFields = new Set([
  "TOWN_ID", "Year", "Month", "WNV_count", "EEE_count", "Test_year", "Threshold",
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

function coerceCorrelationRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) =>
    [key, value !== null && !["Geography","Town","County"].includes(key) ? Number(value) : value]
  )));
}

function coerceModelRows(rows, textFields) {
  return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>
    [key,value!==null&&!textFields.includes(key)?Number(value):value]
  )));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}
function number(value, digits = 2) {
  return value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}
function key(...parts) { return parts.join(":"); }
function townRecord(year, month, townId) { return state.townIndex.get(key(year, month, townId)); }
function countyRecord(year, month, county) { return state.countyIndex.get(key(year, month, county)); }
function stateRecord(year, month) { return state.stateIndex.get(key(year, month)); }
function selectedMonths() {
  return state.months.filter(month=>month>=state.monthStart && month<=state.monthEnd);
}
function selectedYears() {
  return state.years.filter(year=>year>=state.yearStart && year<=state.yearEnd);
}
function selectedYearLabel() {
  if (state.yearStart===state.yearEnd) return String(state.yearStart);
  const unavailable=state.yearStart<=2021 && state.yearEnd>=2021?" (excluding 2021)":"";
  return `${state.yearStart}–${state.yearEnd}${unavailable}`;
}
function isMultiYear() { return selectedYears().length>1; }
function observationPeriodSentenceLead() {
  if (state.monthStart===state.monthEnd && state.yearStart===state.yearEnd) return `In ${selectedPeriodLabel()} ${selectedYearLabel()}`;
  if (state.monthStart===state.monthEnd) return `In ${selectedPeriodLabel()} across ${selectedYearLabel()}`;
  if (state.yearStart===state.yearEnd) return `From ${selectedPeriodLabel()} in ${selectedYearLabel()}`;
  return `From ${selectedPeriodLabel()} across ${selectedYearLabel()}`;
}
function selectedPeriodLabel() {
  return state.monthStart===state.monthEnd
    ? MONTH_NAMES[state.monthStart-1]
    : `${MONTH_NAMES[state.monthStart-1]}–${MONTH_NAMES[state.monthEnd-1]}`;
}

function sumRecords(rows, fallback={}) {
  const valid=rows.filter(Boolean);
  return {
    ...fallback,
    ...(valid[0]||{}),
    WNV_count:valid.reduce((sum,row)=>sum+Number(row.WNV_count||0),0),
    EEE_count:valid.reduce((sum,row)=>sum+Number(row.EEE_count||0),0),
  };
}

function townRangeRecord(townId) {
  const years=selectedYears(),months=selectedMonths();
  const rows=state.townRows.filter(row=>row.TOWN_ID===Number(townId)&&years.includes(row.Year)&&months.includes(row.Month));
  const any=rows[0]||state.townRows.find(row=>row.TOWN_ID===Number(townId));
  return sumRecords(rows,any?{TOWN_ID:any.TOWN_ID,Town:any.Town,County:any.County,Year:selectedYearLabel()}:{});
}
function countyRangeRecord(county) {
  const years=selectedYears(),months=selectedMonths();
  const rows=state.countyRows.filter(row=>row.County===county&&years.includes(row.Year)&&months.includes(row.Month));
  return sumRecords(rows,{County:county,Year:selectedYearLabel()});
}
function stateRangeRecord() {
  const years=selectedYears(),months=selectedMonths();
  return sumRecords(state.stateRows.filter(row=>years.includes(row.Year)&&months.includes(row.Month)));
}

function selectedTownMetadata() {
  return [...new Map(state.townRows
    .filter(row => state.selectedIds.has(Number(row.TOWN_ID)))
    .map(row => [Number(row.TOWN_ID), {TOWN_ID:Number(row.TOWN_ID),Town:row.Town,County:row.County}]))
    .values()].sort((a,b) => a.Town.localeCompare(b.Town));
}

function selectedCountyNames() {
  return [...new Set(selectedTownMetadata().map(town => town.County))].sort();
}

function aggregateAcrossYears(rows, geographyFields) {
  const grouped = new Map();
  rows.forEach(row => {
    const groupKey = key(row.Month, ...geographyFields.map(field => row[field] ?? ""));
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {...row, Year:"All", WNV_count:0, EEE_count:0});
    }
    const aggregate = grouped.get(groupKey);
    aggregate.WNV_count += Number(row.WNV_count || 0);
    aggregate.EEE_count += Number(row.EEE_count || 0);
  });
  return [...grouped.values()];
}

function observedColor(value) {
  const count = Number(value || 0);
  if (count <= 0) return "#f2efe9";
  const limits = isMultiYear() ? [5, 10, 25, 50, 100] : [1, 2, 5, 10, 25];
  if (count <= limits[0]) return "#fee0b6";
  if (count <= limits[1]) return "#fdbb84";
  if (count <= limits[2]) return "#fc8d59";
  if (count <= limits[3]) return "#e34a33";
  if (count <= limits[4]) return "#b30000";
  return "#6f0000";
}

function featureRecord(feature) {
  const townId=Number(feature.properties.TOWN_ID);
  return townRangeRecord(townId) || {
    TOWN_ID: townId, Town: feature.properties.Town,
    County: feature.properties.County, WNV_count: 0,
  };
}

function styleFeature(feature) {
  const record = featureRecord(feature);
  const visible = state.county === "All" || record.County === state.county;
  const selected = state.selectedIds.has(Number(record.TOWN_ID));
  return {
    fillColor: observedColor(record.WNV_count), fillOpacity: visible ? 0.88 : 0.08,
    color: selected ? "#151515" : visible ? "#8c9691" : "#c2c8c5",
    weight: selected ? 2.4 : 0.6, opacity: visible ? 1 : 0.3,
  };
}

function popupHtml(feature) {
  const record = featureRecord(feature);
  const count = Number(record.WNV_count || 0);
  return `<strong>${escapeHtml(record.Town)}</strong><br>${escapeHtml(record.County)} County` +
    `<br>${escapeHtml(selectedPeriodLabel())} · ${escapeHtml(selectedYearLabel())}<br><br>` +
    `<strong>${count.toLocaleString()}</strong> reported-positive sample${count === 1 ? "" : "s"}`;
}

function updateLegend() {
  const entries = isMultiYear()
    ? [["0 reported / sampling unknown","#f2efe9"],["1–5","#fee0b6"],["6–10","#fdbb84"],["11–25","#fc8d59"],["26–50","#e34a33"],["51–100","#b30000"],["101+","#6f0000"]]
    : [["0 reported / sampling unknown","#f2efe9"],["1","#fee0b6"],["2","#fdbb84"],["3–5","#fc8d59"],["6–10","#e34a33"],["11–25","#b30000"],["26+","#6f0000"]];
  document.querySelector("#map-legend").innerHTML = `<strong>Reported-positive samples · ${escapeHtml(selectedPeriodLabel())} · ${escapeHtml(selectedYearLabel())}</strong>` +
    entries.map(([label,color]) => `<div class="legend-row"><i class="legend-swatch" style="background:${color}"></i><span>${label}</span></div>`).join("");
}

function renderSummary() {
  const sourceTownRows=state.townRows,sourceCountyRows=state.countyRows;
  const rangeMonths=selectedMonths(),rangeYears=selectedYears();
  const rangeRows=sourceTownRows.filter(row=>rangeYears.includes(row.Year)&&rangeMonths.includes(row.Month));
  const townTotals=new Map();
  rangeRows.forEach(row=>townTotals.set(row.TOWN_ID,(townTotals.get(row.TOWN_ID)||0)+Number(row.WNV_count||0)));
  const total = stateRangeRecord().WNV_count || 0;
  const positiveTowns = [...townTotals.values()].filter(value=>value>0).length;
  const activeMonths=rangeMonths.filter(month=>state.stateRows.filter(row=>rangeYears.includes(row.Year)&&row.Month===month).reduce((sum,row)=>sum+Number(row.WNV_count||0),0)>0);
  const first = activeMonths.length ? activeMonths[0] : null;
  const recent = activeMonths.length ? activeMonths[activeMonths.length - 1] : null;
  const countyTotals=new Map();
  sourceCountyRows.filter(row=>rangeYears.includes(row.Year)&&rangeMonths.includes(row.Month)).forEach(row=>countyTotals.set(row.County,(countyTotals.get(row.County)||0)+Number(row.WNV_count||0)));
  const peakCounty=[...countyTotals.entries()].map(([County,WNV_count])=>({County,WNV_count})).sort((a,b)=>b.WNV_count-a.WNV_count)[0];
  const countyLabel = month => {
    if (!month) return "No reported detection";
    const rowsByCounty=new Map();
    sourceCountyRows.filter(row=>rangeYears.includes(row.Year)&&row.Month===month&&row.WNV_count>0).forEach(row=>rowsByCounty.set(row.County,(rowsByCounty.get(row.County)||0)+Number(row.WNV_count||0)));
    const rows=[...rowsByCounty.entries()].map(([County,WNV_count])=>({County,WNV_count}));
    if (!rows.length) return "No reported detection";
    const peak = rows.slice().sort((a,b) => b.WNV_count - a.WNV_count)[0];
    return `${peak.County} County has the largest count`;
  };
  document.querySelector("#stat-observed-total").textContent = Number(total).toLocaleString();
  document.querySelector("#stat-observed-towns").textContent = positiveTowns.toLocaleString();
  document.querySelector("#stat-period-label").textContent = `in Massachusetts · ${selectedPeriodLabel()} · ${selectedYearLabel()}`;
  document.querySelector("#stat-first-detection").textContent = first ? MONTH_NAMES[first - 1] : "None";
  document.querySelector("#stat-first-place").textContent = countyLabel(first);
  document.querySelector("#stat-recent-detection").textContent = recent ? MONTH_NAMES[recent - 1] : "None";
  document.querySelector("#stat-recent-place").textContent = countyLabel(recent);
  document.querySelector("#header-year").textContent = selectedYearLabel();
  document.querySelector("#timeline-year").textContent = selectedYearLabel();
  document.querySelector("#timeline-month").textContent = selectedPeriodLabel();
  document.querySelector("#month-start-label").textContent = MONTH_NAMES[state.monthStart - 1];
  document.querySelector("#month-end-label").textContent = MONTH_NAMES[state.monthEnd - 1];
  document.querySelector("#timeline-note").textContent = `${rangeMonths.length}-month range across ${rangeYears.length} available year${rangeYears.length===1?"":"s"}${state.yearStart<=2021&&state.yearEnd>=2021?"; 2021 unavailable":""}.`;
  document.querySelector("#observation-takeaway").textContent = total > 0
    ? `${observationPeriodSentenceLead()}, ${Number(total).toLocaleString()} reported-positive samples were recorded in ${positiveTowns.toLocaleString()} municipalities. ${peakCounty?.County || "No county"} County had the largest county total (${Number(peakCounty?.WNV_count || 0).toLocaleString()}).`
    : `${observationPeriodSentenceLead()}, no reported-positive samples appear. This does not confirm that every municipality was sampled.`;
}

function townYearRows(townId) {
  const years=selectedYears();
  return state.months.map(month=>sumRecords(
    state.townRows.filter(row=>row.TOWN_ID===Number(townId)&&years.includes(row.Year)&&row.Month===month),
    {Month:month},
  ));
}
function countyYearRows(county) {
  const years=selectedYears();
  return state.months.map(month=>sumRecords(
    state.countyRows.filter(row=>row.County===county&&years.includes(row.Year)&&row.Month===month),
    {Month:month,County:county},
  ));
}

function renderTrend(town) {
  const townRows = townYearRows(town.TOWN_ID);
  const countyRows = countyYearRows(town.County);
  const labels = state.months.map(month => MONTH_NAMES[month - 1].slice(0,3));
  const valueByMonth = rows => new Map(rows.map(row => [row.Month, row.WNV_count]));
  const townValues = valueByMonth(townRows);
  const countyValues = valueByMonth(countyRows);
  document.querySelector("#trend-title").textContent = `${town.Town} and ${town.County} County, ${selectedYearLabel()}`;
  Plotly.react("town-history", [
    {type:"scatter",mode:"lines+markers",name:town.Town,x:labels,y:state.months.map(month => townValues.get(month) || 0),line:{color:"#bd4f12",width:3},marker:{size:7}},
    {type:"scatter",mode:"lines+markers",name:`${town.County} County`,x:labels,y:state.months.map(month => countyValues.get(month) || 0),line:{color:"#294f46",width:2,dash:"dot"},marker:{size:6}},
  ], {
    margin:{l:50,r:18,t:44,b:44},paper_bgcolor:"transparent",plot_bgcolor:"transparent",
    font:{family:"Manrope, sans-serif",color:"#122623",size:10},
    xaxis:{gridcolor:"rgba(18,38,35,.1)",fixedrange:true},
    yaxis:{title:"Reported-positive samples",rangemode:"tozero",gridcolor:"rgba(18,38,35,.12)",fixedrange:true},
    legend:{orientation:"h",x:0,y:1.17,font:{size:9}},
    shapes:[
      {type:"line",xref:"x",x0:labels[state.months.indexOf(state.monthStart)],x1:labels[state.months.indexOf(state.monthStart)],yref:"paper",y0:0,y1:1,line:{color:"#d99158",width:1,dash:"dot"}},
      {type:"line",xref:"x",x0:labels[state.months.indexOf(state.monthEnd)],x1:labels[state.months.indexOf(state.monthEnd)],yref:"paper",y0:0,y1:1,line:{color:"#d99158",width:1,dash:"dot"}},
    ],
  }, {responsive:true,displayModeBar:false});
}

function renderSelectionTrend(towns) {
  const townIds=new Set(towns.map(town=>town.TOWN_ID));
  const counties=selectedCountyNames();
  const years=selectedYears();
  const labels=state.months.map(month=>MONTH_NAMES[month-1].slice(0,3));
  const townValues=state.months.map(month=>state.townRows
    .filter(row=>townIds.has(Number(row.TOWN_ID))&&years.includes(row.Year)&&row.Month===month)
    .reduce((sum,row)=>sum+Number(row.WNV_count||0),0));
  const countyValues=state.months.map(month=>state.countyRows
    .filter(row=>counties.includes(row.County)&&years.includes(row.Year)&&row.Month===month)
    .reduce((sum,row)=>sum+Number(row.WNV_count||0),0));
  document.querySelector("#trend-title").textContent=`${towns.length} selected municipalities and ${counties.length} parent ${counties.length===1?"county":"counties"}, ${selectedYearLabel()}`;
  Plotly.react("town-history",[
    {type:"scatter",mode:"lines+markers",name:`Selected towns (${towns.length})`,x:labels,y:townValues,line:{color:"#bd4f12",width:3},marker:{size:7}},
    {type:"scatter",mode:"lines+markers",name:`Parent counties (${counties.length})`,x:labels,y:countyValues,line:{color:"#294f46",width:2,dash:"dot"},marker:{size:6}},
  ],{
    margin:{l:50,r:18,t:44,b:44},paper_bgcolor:"transparent",plot_bgcolor:"transparent",
    font:{family:"Manrope, sans-serif",color:"#122623",size:10},
    xaxis:{gridcolor:"rgba(18,38,35,.1)",fixedrange:true},
    yaxis:{title:"Reported-positive samples",rangemode:"tozero",gridcolor:"rgba(18,38,35,.12)",fixedrange:true},
    legend:{orientation:"h",x:0,y:1.17,font:{size:9}},
    shapes:[
      {type:"line",xref:"x",x0:labels[state.months.indexOf(state.monthStart)],x1:labels[state.months.indexOf(state.monthStart)],yref:"paper",y0:0,y1:1,line:{color:"#d99158",width:1,dash:"dot"}},
      {type:"line",xref:"x",x0:labels[state.months.indexOf(state.monthEnd)],x1:labels[state.months.indexOf(state.monthEnd)],yref:"paper",y0:0,y1:1,line:{color:"#d99158",width:1,dash:"dot"}},
    ],
  },{responsive:true,displayModeBar:false});
}

function renderSelectedTown() {
  const towns=selectedTownMetadata();
  const clearButton=document.querySelector("#clear-town-selection");
  clearButton.hidden=towns.length===0;
  if (!towns.length) {
    document.querySelector("#town-name").textContent = state.county === "All" ? "Massachusetts" : `${state.county} County`;
    document.querySelector("#town-county").textContent = "Click municipalities on the map or choose them from the menu.";
    ["town-observed","county-observed","town-year-total","town-detection-window"].forEach(id => document.querySelector(`#${id}`).textContent = "—");
    document.querySelector("#trend-title").textContent = "Reported-positive samples";
    Plotly.purge("town-history");
    return;
  }
  const townTotal=towns.reduce((sum,town)=>sum+Number(townRangeRecord(town.TOWN_ID)?.WNV_count||0),0);
  const counties=selectedCountyNames();
  const countyTotal=counties.reduce((sum,county)=>sum+Number(countyRangeRecord(county).WNV_count||0),0);
  const selectedNames=towns.length<=4?towns.map(town=>town.Town).join(", "):`${towns.slice(0,3).map(town=>town.Town).join(", ")} +${towns.length-3} more`;
  const years=selectedYears(),months=selectedMonths(),townIds=new Set(towns.map(town=>town.TOWN_ID));
  const positiveMonths=[...new Set(state.townRows
    .filter(row=>townIds.has(Number(row.TOWN_ID))&&years.includes(row.Year)&&months.includes(row.Month)&&Number(row.WNV_count)>0)
    .map(row=>row.Month))].sort((a,b)=>a-b);
  document.querySelector("#town-name").textContent = towns.length===1?towns[0].Town:`${towns.length} municipalities selected`;
  document.querySelector("#town-county").textContent = `${selectedNames} · ${counties.length} ${counties.length===1?"county":"counties"} · ${selectedPeriodLabel()} · ${selectedYearLabel()}`;
  document.querySelector("#town-observed").textContent = townTotal.toLocaleString();
  document.querySelector("#county-observed").textContent = countyTotal.toLocaleString();
  document.querySelector("#town-year-total").textContent = `${selectedMonths().length} month${selectedMonths().length===1?"":"s"}`;
  document.querySelector("#town-detection-window").textContent = positiveMonths.length
    ? `${MONTH_NAMES[positiveMonths[0]-1].slice(0,3)}–${MONTH_NAMES[positiveMonths[positiveMonths.length-1]-1].slice(0,3)}` : "No reports";
  if (towns.length===1) renderTrend(towns[0]); else renderSelectionTrend(towns);
}

function selectTown(townId, openPopup = false) {
  stopPlayback();
  const id=Number(townId);
  if (state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id);
  state.selectedId=state.selectedIds.has(id)?id:([...state.selectedIds].at(-1)??null);
  document.querySelector("#town-select").value = "All";
  state.geoLayer.setStyle(styleFeature);
  renderSelectedTown();
  renderCorrelation();
  renderPrediction();
  if (openPopup) state.geoLayer.eachLayer(layer => {
    if (Number(layer.feature.properties.TOWN_ID) === id) layer.openPopup();
  });
}

function clearTownSelection() {
  state.selectedIds.clear();
  state.selectedId=null;
  document.querySelector("#town-select").value="All";
  state.geoLayer.setStyle(styleFeature);
  renderSelectedTown();
  renderCorrelation();
  renderPrediction();
}

function onEachFeature(feature, layer) {
  layer.bindPopup(() => popupHtml(feature));
  layer.on({
    click: () => selectTown(feature.properties.TOWN_ID),
    mouseover: event => event.target.setStyle({weight:2,color:"#122623"}),
    mouseout: () => state.geoLayer.setStyle(styleFeature),
  });
}

function drawMap() {
  state.map = L.map("wnv-map",{zoomControl:true,scrollWheelZoom:false}).setView([42.25,-71.8],7);
  state.geoLayer = L.geoJSON(state.boundaries,{style:styleFeature,onEachFeature}).addTo(state.map);
  state.countyLayer = L.geoJSON(state.countyBoundaries,{
    interactive:false,
    style:{fill:false,color:"#405a51",weight:1.55,opacity:0.82},
  }).addTo(state.map);
  state.map.fitBounds(state.geoLayer.getBounds(),{padding:[16,16]});
  updateLegend();
}

function refreshMap() {
  state.geoLayer.eachLayer(layer => layer.setPopupContent(popupHtml(layer.feature)));
  state.geoLayer.setStyle(styleFeature);
  updateLegend();
}

function fitCounty() {
  if (state.county === "All") { state.map.fitBounds(state.geoLayer.getBounds(),{padding:[16,16]}); return; }
  const layers = [];
  state.geoLayer.eachLayer(layer => { if (featureRecord(layer.feature).County === state.county) layers.push(layer); });
  if (layers.length) state.map.fitBounds(L.featureGroup(layers).getBounds(),{padding:[24,24]});
}

function populateTownSelect() {
  const select = document.querySelector("#town-select");
  select.innerHTML = '<option value="All">Choose a municipality…</option>';
  const towns = [...new Map(state.townRows
    .filter(row => state.county === "All" || row.County === state.county)
    .map(row => [row.TOWN_ID,{TOWN_ID:row.TOWN_ID,Town:row.Town,County:row.County}])).values()]
    .sort((a,b) => a.Town.localeCompare(b.Town));
  towns.forEach(town => select.add(new Option(town.Town,String(town.TOWN_ID))));
}

function setMonthRange(startMonth,endMonth) {
  state.monthStart=Number(startMonth);
  state.monthEnd=Number(endMonth);
  state.month=state.monthEnd;
  document.querySelector("#month-start-slider").value=String(state.months.indexOf(state.monthStart));
  document.querySelector("#month-end-slider").value=String(state.months.indexOf(state.monthEnd));
  renderSummary(); refreshMap(); renderSelectedTown(); renderPrediction();
}

function setMonth(month) { setMonthRange(month,month); }

function stopPlayback() {
  if (state.playTimer) window.clearInterval(state.playTimer);
  state.playTimer = null;
  const button = document.querySelector("#play-timeline");
  button.classList.remove("is-playing"); button.setAttribute("aria-pressed","false");
  button.innerHTML = '<span aria-hidden="true">▶</span> Play';
}

function togglePlayback() {
  if (state.playTimer) { stopPlayback(); return; }
  if (state.month === state.months[state.months.length - 1]) setMonth(state.months[0]);
  const button = document.querySelector("#play-timeline");
  button.classList.add("is-playing"); button.setAttribute("aria-pressed","true");
  button.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
  state.playTimer = window.setInterval(() => {
    const current = state.months.indexOf(state.month);
    setMonth(state.months[(current + 1) % state.months.length]);
  }, 1400);
}

function downloadDisplayedData() {
  const sourceRows=state.townRows,months=selectedMonths(),years=selectedYears();
  const rows = sourceRows.filter(row => years.includes(row.Year) && months.includes(row.Month) && (state.county === "All" || row.County === state.county));
  const columns = ["TOWN_ID","Town","County","Year","Month","WNV_count","EEE_count"];
  const csv = [columns.join(","), ...rows.map(row => columns.map(column => {
    const value = row[column] ?? "";
    const escaped = String(value).replaceAll('"','""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = `wnv_observations_${state.yearStart}-${state.yearEnd}_${String(state.monthStart).padStart(2,"0")}-${String(state.monthEnd).padStart(2,"0")}${state.county === "All" ? "" : `_${state.county.toLowerCase().replaceAll(" ","_")}`}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function rankValues(values) {
  const sorted = values.map((value,index) => ({value,index})).sort((a,b) => a.value-b.value);
  const ranks = Array(values.length);
  for (let i=0;i<sorted.length;) {
    let j=i+1;
    while (j<sorted.length && sorted[j].value===sorted[i].value) j+=1;
    const rank=(i+j-1)/2+1;
    for (let k=i;k<j;k+=1) ranks[sorted[k].index]=rank;
    i=j;
  }
  return ranks;
}

function pearson(x,y) {
  if (x.length<3) return null;
  const mx=x.reduce((a,b)=>a+b,0)/x.length, my=y.reduce((a,b)=>a+b,0)/y.length;
  let numerator=0, dx=0, dy=0;
  x.forEach((value,index)=>{const a=value-mx,b=y[index]-my;numerator+=a*b;dx+=a*a;dy+=b*b;});
  return dx>0 && dy>0 ? numerator/Math.sqrt(dx*dy) : null;
}

function normalCdf(value) {
  const sign=value<0?-1:1, x=Math.abs(value)/Math.sqrt(2);
  const t=1/(1+.3275911*x);
  const erf=sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x));
  return .5*(1+erf);
}

function approximateSpearmanP(rho,n) {
  if (rho===null || n<4) return null;
  if (Math.abs(rho)>=1) return 0;
  const z=Math.atanh(rho)*Math.sqrt(n-3);
  return Math.max(0,Math.min(1,2*(1-normalCdf(Math.abs(z)))));
}

function significanceMark(p) {
  if (p===null || !Number.isFinite(p)) return "—";
  if (p<.001) return "***";
  if (p<.01) return "**";
  if (p<.05) return "*";
  return "ns";
}

function formatP(p) {
  if (p===null || !Number.isFinite(p)) return "—";
  return p<.001?"< .001":p.toFixed(3);
}

function spearman(rows,column) {
  const pairs=rows.map(row=>[Number(row[column]),state.correlationOutcome==="presence"?(Number(row.WNV_count)>0?1:0):Number(row.WNV_count)])
    .filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
  const rho=pearson(rankValues(pairs.map(pair=>pair[0])),rankValues(pairs.map(pair=>pair[1])));
  return {rho,p:approximateSpearmanP(rho,pairs.length),pairs};
}

function logCountTrend(rows) {
  if (rows.length<3) return null;
  const xs=rows.map(row=>row.x), ys=rows.map(row=>Math.log1p(row.count));
  const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
  let numerator=0,denominator=0;
  xs.forEach((x,index)=>{numerator+=(x-mx)*(ys[index]-my);denominator+=(x-mx)**2;});
  if (!denominator) return null;
  const slope=numerator/denominator, intercept=my-slope*mx;
  const minimum=Math.min(...xs),maximum=Math.max(...xs);
  const trendX=Array.from({length:60},(_,index)=>minimum+(maximum-minimum)*index/59);
  return {x:trendX,y:trendX.map(x=>Math.max(0,Math.expm1(intercept+slope*x)))};
}

function median(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

function correlationRowsForView(level) {
  const selectedIds=state.selectedIds;
  const selectedCounties=selectedCountyNames();
  const years=selectedYears();
  return state.correlationRows.filter(row =>
    row.Geography===level &&
    years.includes(row.Year) &&
    (selectedIds.size
      ? (level==="town" ? selectedIds.has(Number(row.TOWN_ID)) : selectedCounties.includes(row.County))
      : (state.county==="All" || row.County===state.county)) &&
    (state.correlationMonth==="All" || row.Month===Number(state.correlationMonth))
  );
}

function predictorColumn(name) {
  return landscapePredictors.has(name) ? name : (state.correlationLag==="lag1"?`${name}_lag1`:name);
}
function formatRho(value) { return value===null?"—":`${value>=0?"+":""}${value.toFixed(2)}`; }

function updateCorrelationTimingControl() {
  const select=document.querySelector("#correlation-lag");
  let landscapeOption=select.querySelector('option[value="landscape"]');
  if (!landscapeOption) {
    landscapeOption=new Option("Previous-year landscape","landscape");
    select.add(landscapeOption);
  }
  const isLandscape=landscapePredictors.has(state.correlationPredictor);
  select.disabled=isLandscape;
  select.value=isLandscape?"landscape":state.correlationLag;
  select.closest("label").querySelector("span").textContent=isLandscape?"Landscape timing":"Environmental timing";
}

function correlationPlaceLabel(level) {
  const towns=selectedTownMetadata(),counties=selectedCountyNames();
  if (towns.length) {
    if (level==="town") return towns.length<=3?towns.map(town=>town.Town).join(", "):`${towns.length} selected municipalities`;
    return counties.length===1?`${counties[0]} County`:counties.length<=3?counties.map(county=>`${county} County`).join(", "):`${counties.length} selected counties`;
  }
  if (state.county!=="All") return level==="town"?`${state.county} County municipalities`:`${state.county} County`;
  return "Massachusetts";
}

function correlationTimeLabel(level) {
  const month=state.correlationMonth==="All"?"June–September":MONTH_NAMES[Number(state.correlationMonth)-1];
  return `${month} · ${selectedYearLabel()} · ${correlationPlaceLabel(level)}`;
}

function renderRelationship(level,rows,column,label) {
  const {rho,p,pairs}=spearman(rows,column);
  document.querySelector(`#${level}-relationship-title`).textContent=`${level==="town"?"Town":"County"} level · ${label} and WNV reports · ${correlationTimeLabel(level)}`;
  document.querySelector(`#${level}-rho`).textContent=formatRho(rho);
  document.querySelector(`#${level}-n`).textContent=pairs.length.toLocaleString();
  document.querySelector(`#${level}-p`).textContent=formatP(p);
  document.querySelector(`#${level}-significance`).textContent=significanceMark(p);

  const plotRows=rows.map(row=>({x:Number(row[column]),count:Number(row.WNV_count),month:Number(row.Month),town:row.Town,county:row.County})).filter(row=>Number.isFinite(row.x)&&Number.isFinite(row.count));
  const target=`${level}-relationship-chart`;
  const common={margin:{l:62,r:18,t:20,b:58},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",color:"#122623",size:10}};
  if (state.correlationOutcome==="presence") {
    const absent=plotRows.filter(row=>row.count===0).map(row=>row.x), present=plotRows.filter(row=>row.count>0).map(row=>row.x);
    Plotly.react(target,[
      {type:"box",name:"0 reported",y:absent,boxpoints:"outliers",marker:{color:"#9ea7a2"},fillcolor:"rgba(158,167,162,.35)"},
      {type:"box",name:"Reported detection",y:present,boxpoints:"outliers",marker:{color:"#76519a"},fillcolor:"rgba(118,81,154,.35)"},
    ],{...common,yaxis:{title:label,gridcolor:"rgba(18,38,35,.12)"},xaxis:{title:"Detection group"},showlegend:false},{responsive:true,displayModeBar:false});
  } else {
    const colors={6:"#4f7cac",7:"#61a5a0",8:"#d28b45",9:"#8a5aa5"};
    const months=state.correlationMonth==="All"?[6,7,8,9]:[Number(state.correlationMonth)];
    const traces=months.map(month=>{
      const monthRows=plotRows.filter(row=>row.month===month);
      return {type:"scattergl",mode:"markers",name:MONTH_NAMES[month-1],x:monthRows.map(row=>row.x),y:monthRows.map(row=>row.count),text:monthRows.map(row=>level==="town"?`${row.town}, ${row.county} County`:`${row.county} County`),marker:{color:colors[month],size:level==="town"?6:8,opacity:.42},hovertemplate:`%{text}<br>${label}: %{x}<br>Reported-positive samples: %{y}<extra>${MONTH_NAMES[month-1]}</extra>`};
    });
    const trend=logCountTrend(plotRows);
    if (trend) traces.push({type:"scatter",mode:"lines",name:"Overall log-count trend",x:trend.x,y:trend.y,line:{color:"#241d28",width:3,dash:"dash"},hoverinfo:"skip"});
    Plotly.react(target,traces,
      {...common,xaxis:{title:label,gridcolor:"rgba(18,38,35,.12)"},yaxis:{title:"Reported-positive samples",rangemode:"tozero",gridcolor:"rgba(18,38,35,.12)"},legend:{orientation:"h",x:0,y:1.12,font:{size:9}}},{responsive:true,displayModeBar:false});
  }
  return {rho,p,n:pairs.length};
}

function renderRanking(level,rows) {
  const ranking=Object.entries(correlationPredictors).map(([name,predictorLabel])=>({name,label:predictorLabel,...spearman(rows,predictorColumn(name))})).filter(item=>item.rho!==null).sort((a,b)=>Math.abs(a.rho)-Math.abs(b.rho));
  document.querySelector(`#${level}-ranking-title`).textContent=`${level==="town"?"Town":"County"} correlation ranking · ${correlationTimeLabel(level)}`;
  Plotly.react(`${level}-correlation-ranking`,[{type:"bar",orientation:"h",y:ranking.map(item=>`${item.label} ${significanceMark(item.p)}`),x:ranking.map(item=>item.rho),customdata:ranking.map(item=>[formatP(item.p),significanceMark(item.p),item.pairs.length]),marker:{color:ranking.map(item=>item.rho>=0?"#76519a":"#54a19a")},hovertemplate:"%{y}<br>Spearman rₛ = %{x:.2f}<br>p %{customdata[0]} (%{customdata[1]})<br>n = %{customdata[2]}<extra></extra>"}],
    {margin:{l:185,r:18,t:12,b:48},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",color:"#122623",size:9},xaxis:{title:"Spearman correlation",range:[-1,1],gridcolor:"rgba(18,38,35,.12)",zerolinecolor:"#122623"},yaxis:{automargin:true}},{responsive:true,displayModeBar:false});
}

function renderCorrelation() {
  const base=state.correlationPredictor;
  const column=predictorColumn(base);
  const baseLabel=correlationPredictors[base];
  const label=landscapePredictors.has(base)
    ? `${baseLabel} (${state.yearStart===state.yearEnd?`NLCD ${state.yearStart-1}`:`NLCD ${state.yearStart-1}–${state.yearEnd-1}`})`
    : baseLabel;
  const townRows=correlationRowsForView("town");
  const countyRows=correlationRowsForView("county");
  const town=renderRelationship("town",townRows,column,label);
  const county=renderRelationship("county",countyRows,column,label);
  renderRanking("town",townRows);
  renderRanking("county",countyRows);
  const timing=landscapePredictors.has(base)?"previous-year landscape":(state.correlationLag==="lag1"?"previous-month":"same-month");
  document.querySelector("#correlation-takeaway").textContent=town.rho===null
    ? `There are not enough valid town observations to estimate the selected ${timing} association.`
    : `${label}: town-level rₛ = ${formatRho(town.rho)} (${significanceMark(town.p)}, n = ${town.n.toLocaleString()}); county-level rₛ = ${formatRho(county.rho)} (${significanceMark(county.p)}, n = ${county.n.toLocaleString()}). Compare direction and magnitude across levels; county aggregation can change an association and does not establish causation.`;
}

function populateCorrelationControls() {
  const predictor=document.querySelector("#correlation-predictor");
  const environmentGroup=document.createElement("optgroup");
  environmentGroup.label="Monthly climate and satellite conditions";
  const landscapeGroup=document.createElement("optgroup");
  landscapeGroup.label="Previous-year landscape (NLCD)";
  Object.entries(correlationPredictors).forEach(([value,label])=>
    (landscapePredictors.has(value)?landscapeGroup:environmentGroup).appendChild(new Option(label,value))
  );
  predictor.append(environmentGroup,landscapeGroup);
  predictor.value=state.correlationPredictor;
  updateCorrelationTimingControl();
  predictor.addEventListener("change",event=>{state.correlationPredictor=event.target.value;updateCorrelationTimingControl();renderCorrelation();});
  document.querySelector("#correlation-month").addEventListener("change",event=>{state.correlationMonth=event.target.value;renderCorrelation();});
  document.querySelector("#correlation-outcome").addEventListener("change",event=>{state.correlationOutcome=event.target.value;renderCorrelation();});
  document.querySelector("#correlation-lag").addEventListener("change",event=>{if(event.target.value!=="landscape")state.correlationLag=event.target.value;renderCorrelation();});
}

function predictionTownAggregate(townId) {
  const rows=state.predictions.filter(row=>row.year===state.predictionYear&&row.Town_id===Number(townId)&&selectedMonths().includes(row.month));
  if (!rows.length) return null;
  const probability=1-rows.reduce((product,row)=>product*(1-Number(row.detection_probability||0)),1);
  const predicted=rows.some(row=>Number(row.predicted_presence)===1);
  const observed=rows.some(row=>Number(row.WNV_presence)===1);
  const agreement=predicted?(observed?"True positive":"False positive"):(observed?"False negative":"True negative");
  return {
    Town_id:Number(townId),town:rows[0].town,county:rows[0].county,probability,
    expected:rows.reduce((sum,row)=>sum+Number(row.expected_count||0),0),
    observedCount:rows.reduce((sum,row)=>sum+Number(row.WNV_positive_monthly||0),0),
    predicted,observed,agreement,rows,
  };
}

function predictionColor(value,metric) {
  if (metric==="agreement") return ({"True positive":"#237b68","True negative":"#dfe5e1","False positive":"#e3a43b","False negative":"#c92535"})[value]||"#ecefeb";
  const v=Number(value||0);
  if (metric==="expected") return v<=0.1?"#fff3e8":v<=0.5?"#fdd0a2":v<=1?"#fdae6b":v<=2?"#f16913":"#a63603";
  return v<0.1?"#e8f3f0":v<0.25?"#b9ddd4":v<0.5?"#72b7a7":v<0.75?"#2f8875":"#0e5548";
}

function predictionFeatureAggregate(feature) { return predictionTownAggregate(feature.properties.TOWN_ID); }

function predictionStyle(feature) {
  const aggregate=predictionFeatureAggregate(feature);
  const visible=state.county==="All"||feature.properties.County===state.county;
  const selected=state.selectedIds.has(Number(feature.properties.TOWN_ID));
  const value=state.predictionMetric==="probability"?aggregate?.probability:state.predictionMetric==="expected"?aggregate?.expected:aggregate?.agreement;
  return {fillColor:predictionColor(value,state.predictionMetric),fillOpacity:visible?0.9:0.08,color:selected?"#111":visible?"#73827d":"#bdc7c2",weight:selected?2.5:0.65,opacity:visible?1:0.25};
}

function predictionPopup(feature) {
  const a=predictionFeatureAggregate(feature);
  if (!a) return `<strong>${escapeHtml(feature.properties.Town)}</strong><br>No ${state.predictionYear} prediction`;
  return `<strong>${escapeHtml(a.town)}</strong><br>${escapeHtml(a.county)} County<br>${escapeHtml(selectedPeriodLabel())} ${state.predictionYear}<br><br>`+
    `<strong>${(a.probability*100).toFixed(1)}%</strong> seasonal detection probability<br>`+
    `${a.expected.toFixed(2)} expected · ${a.observedCount.toLocaleString()} observed<br>${escapeHtml(a.agreement)}`;
}

function renderPredictionLegend() {
  let entries,title;
  if (state.predictionMetric==="agreement") {title="Observed–predicted agreement";entries=[["True positive","#237b68"],["True negative","#dfe5e1"],["False positive","#e3a43b"],["False negative","#c92535"]];}
  else if (state.predictionMetric==="expected") {title="Expected reported-positive count";entries=[["0–0.10","#fff3e8"],["0.11–0.50","#fdd0a2"],["0.51–1.00","#fdae6b"],["1.01–2.00","#f16913"],["> 2.00","#a63603"]];}
  else {title="Seasonal detection probability";entries=[["< 10%","#e8f3f0"],["10–24%","#b9ddd4"],["25–49%","#72b7a7"],["50–74%","#2f8875"],["≥ 75%","#0e5548"]];}
  document.querySelector("#prediction-legend").innerHTML=`<strong>${title} · ${escapeHtml(selectedPeriodLabel())} ${state.predictionYear}</strong>`+entries.map(([label,color])=>`<div class="legend-row"><i class="legend-swatch" style="background:${color}"></i><span>${label}</span></div>`).join("");
}

function drawPredictionMap() {
  state.predictionMap=L.map("prediction-map",{zoomControl:true,scrollWheelZoom:false}).setView([42.25,-71.8],7);
  state.predictionLayer=L.geoJSON(state.boundaries,{style:predictionStyle,onEachFeature:(feature,layer)=>{
    layer.bindPopup(()=>predictionPopup(feature));
    layer.on({click:()=>selectTown(feature.properties.TOWN_ID),mouseover:event=>event.target.setStyle({weight:2,color:"#122623"}),mouseout:()=>state.predictionLayer.setStyle(predictionStyle)});
  }}).addTo(state.predictionMap);
  L.geoJSON(state.countyBoundaries,{interactive:false,style:{fill:false,color:"#405a51",weight:1.5,opacity:.8}}).addTo(state.predictionMap);
  state.predictionMap.fitBounds(state.predictionLayer.getBounds(),{padding:[16,16]});
}

function renderPredictionDetail() {
  const availableIds=[...new Set(state.predictions.filter(row=>row.year===state.predictionYear&&(state.county==="All"||row.county===state.county)).map(row=>row.Town_id))];
  const ids=state.selectedIds.size?[...state.selectedIds]:availableIds;
  const aggregates=ids.map(predictionTownAggregate).filter(Boolean);
  if (!aggregates.length) return;
  const probability=aggregates.reduce((sum,row)=>sum+row.probability,0)/aggregates.length;
  const expected=aggregates.reduce((sum,row)=>sum+row.expected,0);
  const observed=aggregates.reduce((sum,row)=>sum+row.observedCount,0);
  const counts=Object.fromEntries(["True positive","True negative","False positive","False negative"].map(label=>[label,aggregates.filter(row=>row.agreement===label).length]));
  const towns=selectedTownMetadata();
  document.querySelector("#prediction-place").textContent=towns.length===1?towns[0].Town:towns.length?`${towns.length} selected municipalities`:state.county==="All"?"Massachusetts":`${state.county} County`;
  document.querySelector("#prediction-place-note").textContent=`${selectedPeriodLabel()} ${state.predictionYear} · ${aggregates.length} municipalit${aggregates.length===1?"y":"ies"}`;
  document.querySelector("#prediction-probability").textContent=`${(probability*100).toFixed(1)}% mean`;
  document.querySelector("#prediction-expected").textContent=expected.toFixed(2);
  document.querySelector("#prediction-observed").textContent=observed.toLocaleString();
  document.querySelector("#prediction-agreement").textContent=`${counts["True positive"]} TP · ${counts["False negative"]} FN`;
  const monthRows=state.months.map(month=>{
    const rows=state.predictions.filter(row=>row.year===state.predictionYear&&ids.includes(row.Town_id)&&row.month===month);
    return {month,observed:rows.reduce((sum,row)=>sum+row.WNV_positive_monthly,0),expected:rows.reduce((sum,row)=>sum+row.expected_count,0),probability:rows.length?rows.reduce((sum,row)=>sum+row.detection_probability,0)/rows.length:0};
  });
  const labels=monthRows.map(row=>MONTH_NAMES[row.month-1].slice(0,3));
  Plotly.react("prediction-history",[
    {type:"bar",name:"Observed",x:labels,y:monthRows.map(row=>row.observed),marker:{color:"#122623"}},
    {type:"bar",name:"Expected",x:labels,y:monthRows.map(row=>row.expected),marker:{color:"#e89042"}},
    {type:"scatter",mode:"lines+markers",name:"Mean probability",x:labels,y:monthRows.map(row=>row.probability*100),yaxis:"y2",line:{color:"#237b68",width:2}},
  ],{margin:{l:45,r:48,t:44,b:40},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",size:9,color:"#122623"},barmode:"group",legend:{orientation:"h",x:0,y:1.18},xaxis:{fixedrange:true},yaxis:{title:"Count",rangemode:"tozero",gridcolor:"rgba(18,38,35,.1)",fixedrange:true},yaxis2:{title:"Probability (%)",overlaying:"y",side:"right",range:[0,100],fixedrange:true}}, {responsive:true,displayModeBar:false});
}

function activeMetricRow() {
  if (state.predictionYear===2026) return state.modelComparison.find(row=>row.model===state.rfMetadata?.selected_model)||state.modelComparison[0];
  return state.rollingMetrics.find(row=>row.holdout_year===state.predictionYear);
}

function activePredictionThreshold() {
  const metric=activeMetricRow();
  return Number(metric?.threshold??state.rfMetadata?.probability_threshold??0);
}

function updateYearSpecificModelPanels() {
  const is2026=state.predictionYear===2026;
  document.querySelector("#model-comparison-card").hidden=!is2026;
  document.querySelector("#importance-note").textContent=`Permutation importance is calculated on the untouched ${state.predictionYear} June–September holdout. Positive values indicate performance loss after shuffling; values near or below zero indicate negligible or unstable independent contribution.${is2026?" Model ablation is also available for 2026.":" Model ablation was calculated for 2026 only."}`;
  renderYearImportance();
}

function renderPrediction() {
  if (!state.predictions.length||!document.querySelector("#prediction-map")) return;
  document.querySelector("#prediction-period").textContent=`${selectedPeriodLabel()} ${state.predictionYear}`;
  document.querySelector("#prediction-threshold").textContent=`${(activePredictionThreshold()*100).toFixed(1)}% monthly`;
  document.querySelector("#prediction-model-name").textContent="Environment + landscape + county";
  if (!state.predictionMap) drawPredictionMap();
  state.predictionLayer.eachLayer(layer=>layer.setPopupContent(predictionPopup(layer.feature)));
  state.predictionLayer.setStyle(predictionStyle);
  renderPredictionLegend();renderPredictionDetail();renderPredictionErrors();
}

function renderMetrics() {
  const selected=activeMetricRow();
  if (!selected) return;
  const metrics=[["ROC AUC",selected.roc_auc,"ranking positive town-months"],["Average precision",selected.average_precision,"precision–recall summary"],["Sensitivity",selected.sensitivity,"observed positives detected"],["Specificity",selected.specificity,"observed zeros identified"],["Precision",selected.precision,"model positives observed"],["F1",selected.f1,"precision–recall balance"],["Brier score",selected.brier_score,"probability error; lower is better"],["Count MAE",selected.count_mae??selected.expected_count_mae,"expected-count error"]];
  document.querySelector("#metric-grid").innerHTML=metrics.map(([label,value,note])=>`<article><span>${label}</span><strong>${number(value,3)}</strong><small>${note}</small></article>`).join("");
  renderModelContext(selected);
}

function renderModelContext(selected) {
  const firstYear=selected.training_first_year??2014;
  const lastYear=selected.training_last_year??2025;
  const positives=selected.holdout_positive_rows??(Number(selected.false_negative||0)+Number(selected.true_positive||0));
  const facts=[
    ["Training window",`${firstYear}–${lastYear}`,`${Number(selected.n_training).toLocaleString()} town-month rows · 2021 excluded`],
    ["Training positives",Number(selected.n_positive_training).toLocaleString(),"reported-positive town-months used to fit the count stage"],
    ["Untouched holdout",`${Number(selected.n_holdout).toLocaleString()} rows`,`${Number(positives).toLocaleString()} reported-positive rows · June–September ${state.predictionYear}`],
    ["Confusion counts",`${Number(selected.true_positive)} TP · ${Number(selected.false_negative)} FN`,`${Number(selected.true_negative)} TN · ${Number(selected.false_positive)} FP at the selected threshold`],
  ];
  document.querySelector("#model-context").innerHTML=facts.map(([label,value,note])=>`<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
}

function predictorLabel(name) {
  const direct={target_month_cat:"Prediction month",town_id_cat:"Municipality identity",county_id_cat:"County identity",log_town_area_km2:"Municipality area"};
  if (direct[name]) return direct[name];
  return name.replace(/^lag1_/,"Previous-month ").replaceAll("LST_Night_1km_C","nighttime LST").replaceAll("LST_Day_1km_C","daytime LST").replaceAll("LST_diurnal_1km_C","diurnal LST range").replaceAll("nlcd_prop_","").replaceAll("nlcd_mean_","").replaceAll("_stdDev"," SD").replaceAll("_mean"," mean").replaceAll("_total"," total").replaceAll("_"," ");
}

function renderRFImportance(target,rows,color,xTitle) {
  const data=rows.slice().sort((a,b)=>b.importance_mean-a.importance_mean).slice(0,14).reverse();
  Plotly.react(target,[{type:"bar",orientation:"h",y:data.map(row=>predictorLabel(row.predictor)),x:data.map(row=>row.importance_mean),error_x:{type:"data",array:data.map(row=>row.importance_sd),visible:true,color:"#687873"},marker:{color:data.map(row=>["town_id_cat","county_id_cat","log_town_area_km2"].includes(row.predictor)?"#d28b45":color)}}],{margin:{l:210,r:24,t:12,b:62},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",color:"#122623",size:10},xaxis:{title:xTitle,gridcolor:"rgba(18,38,35,.12)",zerolinecolor:"#122623"},yaxis:{automargin:true}}, {responsive:true,displayModeBar:false});
}

function renderYearImportance() {
  const presenceRows=state.predictionYear===2026?state.rfPresenceImportance:state.rollingPresenceImportance.filter(row=>row.holdout_year===state.predictionYear);
  const countRows=state.predictionYear===2026?state.rfCountImportance:state.rollingCountImportance.filter(row=>row.holdout_year===state.predictionYear);
  document.querySelector("#presence-importance-title").textContent=`Permutation importance · ${state.predictionYear} holdout`;
  document.querySelector("#count-importance-title").textContent=`Permutation importance · ${state.predictionYear} holdout`;
  renderRFImportance("presence-importance",presenceRows,"#76519a","Decrease in average precision");
  renderRFImportance("abundance-importance",countRows,"#4c88b5","Increase in MAE");
}

function renderModelComparison() {
  const labels={environment:"Environment",environment_landscape_area:"+ Landscape + area",environment_landscape_county:"+ County proxy",environment_landscape_town:"+ Town proxy"};
  const rows=state.modelComparison.slice().sort((a,b)=>a.average_precision-b.average_precision);
  Plotly.react("model-comparison-chart",[
    {type:"bar",orientation:"h",name:"Average precision",y:rows.map(row=>labels[row.model]||row.model),x:rows.map(row=>row.average_precision),marker:{color:"#76519a"}},
    {type:"scatter",mode:"markers",name:"ROC AUC",y:rows.map(row=>labels[row.model]||row.model),x:rows.map(row=>row.roc_auc),marker:{color:"#237b68",size:10,symbol:"diamond"}},
  ],{margin:{l:135,r:20,t:35,b:55},paper_bgcolor:"transparent",plot_bgcolor:"transparent",font:{family:"Manrope, sans-serif",color:"#122623",size:10},xaxis:{title:"Holdout score",range:[0,1],gridcolor:"rgba(18,38,35,.12)"},legend:{orientation:"h",x:0,y:1.16}}, {responsive:true,displayModeBar:false});
}

function renderPredictionErrors() {
  if (!state.predictions.length) return;
  document.querySelector("#prediction-error-title").textContent=`Largest ${state.predictionYear} disagreements`;
  const rows=state.predictions.filter(row=>row.year===state.predictionYear&&selectedMonths().includes(row.month)&&(state.county==="All"||row.county===state.county)).map(row=>({...row,classLabel:Number(row.predicted_presence)?(Number(row.WNV_presence)?"TP":"FP"):(Number(row.WNV_presence)?"FN":"TN"),error:Math.abs(Number(row.WNV_positive_monthly)-Number(row.expected_count))})).sort((a,b)=>(b.classLabel==="FN")-(a.classLabel==="FN")||b.error-a.error).slice(0,10);
  document.querySelector("#prediction-error-table").innerHTML=rows.map(row=>`<tr><td><button type="button" data-town-id="${row.Town_id}">${escapeHtml(row.town)}</button></td><td>${MONTH_NAMES[row.month-1].slice(0,3)}</td><td>${row.WNV_positive_monthly}</td><td>${Number(row.expected_count).toFixed(2)}</td><td><span class="error-class ${row.classLabel.toLowerCase()}">${row.classLabel}</span></td></tr>`).join("");
  document.querySelectorAll("#prediction-error-table button").forEach(button=>button.addEventListener("click",()=>selectTown(button.dataset.townId,true)));
}

function populateControls() {
  const yearStartSelect=document.querySelector("#year-start-select");
  const yearEndSelect=document.querySelector("#year-end-select");
  state.years.forEach(year=>{yearStartSelect.add(new Option(String(year),String(year)));yearEndSelect.add(new Option(String(year),String(year)));});
  yearStartSelect.value=String(state.yearStart);yearEndSelect.value=String(state.yearEnd);
  const updateYearRange=(changed)=>{
    stopPlayback();
    let start=Number(yearStartSelect.value),end=Number(yearEndSelect.value);
    if(start>end){if(changed==="start")end=start;else start=end;}
    state.yearStart=start;state.yearEnd=end;state.year=start===end?start:"Range";
    yearStartSelect.value=String(start);yearEndSelect.value=String(end);
    renderSummary();refreshMap();renderSelectedTown();renderMetrics();renderCorrelation();
  };
  yearStartSelect.addEventListener("change",()=>updateYearRange("start"));
  yearEndSelect.addEventListener("change",()=>updateYearRange("end"));
  const countySelect = document.querySelector("#county-select");
  [...new Set(state.townRows.map(row => row.County))].sort().forEach(county => countySelect.add(new Option(county,county)));
  countySelect.addEventListener("change", event => {
    state.county = event.target.value;
    if (state.county !== "All") {
      const allowedIds=new Set(state.townRows.filter(row=>row.County===state.county).map(row=>Number(row.TOWN_ID)));
      [...state.selectedIds].forEach(id=>{if(!allowedIds.has(id))state.selectedIds.delete(id);});
      state.selectedId=[...state.selectedIds].at(-1)??null;
    }
    populateTownSelect(); refreshMap(); fitCounty(); renderSelectedTown(); renderCorrelation(); renderPrediction();
  });
  document.querySelector("#town-select").addEventListener("change", event => {
    if (event.target.value !== "All") selectTown(event.target.value,true);
  });
  document.querySelector("#clear-town-selection").addEventListener("click",clearTownSelection);
  document.querySelector("#month-start-slider").addEventListener("input", event => {
    stopPlayback();
    const start=state.months[Number(event.target.value)];
    setMonthRange(start,Math.max(start,state.monthEnd));
  });
  document.querySelector("#month-end-slider").addEventListener("input", event => {
    stopPlayback();
    const end=state.months[Number(event.target.value)];
    setMonthRange(Math.min(state.monthStart,end),end);
  });
  document.querySelector("#play-timeline").addEventListener("click",togglePlayback);
  document.querySelector("#download-view").addEventListener("click",downloadDisplayedData);
  document.querySelector("#prediction-metric").addEventListener("change",event=>{state.predictionMetric=event.target.value;renderPrediction();});
  document.querySelector("#prediction-year").addEventListener("change",event=>{
    state.predictionYear=Number(event.target.value);
    renderMetrics();renderPrediction();updateYearSpecificModelPanels();
  });
  populateTownSelect();
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
    const [boundaries,countyBoundaries,monthlyText,correlationText,metricText,metadata,importance,predictionText,rollingPredictionText,comparisonText,rollingMetricsText,presenceImportanceText,countImportanceText,rollingPresenceImportanceText,rollingCountImportanceText,rfMetadata,rollingMetadata] = await Promise.all([
      fetchJson(`${DATA_ROOT}/massachusetts_towns.geojson`), fetchJson(`${DATA_ROOT}/massachusetts_counties.geojson`),
      fetchText(`${DATA_ROOT}/monthly_observations.csv`),
      fetchText(`${DATA_ROOT}/correlation_town_month.csv`),
      fetchText(`${DATA_ROOT}/model_metrics_by_year.csv`), fetchJson(`${DATA_ROOT}/metadata.json`),
      fetchJson(`${DATA_ROOT}/feature_importance.json`),
      fetchText(`${DATA_ROOT}/rf_predictions_2026.csv`),fetchText(`${DATA_ROOT}/rf_predictions_2024_2025.csv`),fetchText(`${DATA_ROOT}/rf_model_comparison.csv`),fetchText(`${DATA_ROOT}/rf_metrics_2024_2025.csv`),
      fetchText(`${DATA_ROOT}/rf_presence_permutation_importance.csv`),fetchText(`${DATA_ROOT}/rf_positive_count_permutation_importance.csv`),
      fetchText(`${DATA_ROOT}/rf_presence_permutation_importance_2024_2025.csv`),fetchText(`${DATA_ROOT}/rf_positive_count_permutation_importance_2024_2025.csv`),
      fetchJson(`${DATA_ROOT}/rf_metadata.json`),fetchJson(`${DATA_ROOT}/rf_rolling_metadata.json`),
    ]);
    state.boundaries = boundaries;
    state.countyBoundaries = countyBoundaries;
    state.monthly = coerceRows(parseCsv(monthlyText));
    state.correlationRows = coerceCorrelationRows(parseCsv(correlationText));
    state.townRows = state.monthly.filter(row => row.spatial_level === "town");
    state.countyRows = state.monthly.filter(row => row.spatial_level === "county");
    state.stateRows = state.monthly.filter(row => row.spatial_level === "state");
    state.allTownRows = aggregateAcrossYears(state.townRows,["TOWN_ID"]);
    state.allCountyRows = aggregateAcrossYears(state.countyRows,["County"]);
    state.allStateRows = aggregateAcrossYears(state.stateRows,[]);
    state.townIndex = new Map([...state.townRows,...state.allTownRows].map(row => [key(row.Year,row.Month,row.TOWN_ID),row]));
    state.countyIndex = new Map([...state.countyRows,...state.allCountyRows].map(row => [key(row.Year,row.Month,row.County),row]));
    state.stateIndex = new Map([...state.stateRows,...state.allStateRows].map(row => [key(row.Year,row.Month),row]));
    state.years = [...new Set(state.townRows.map(row => row.Year))].sort((a,b) => a-b);
    state.year = state.years.includes(2026) ? 2026 : state.years[state.years.length - 1];
    state.yearStart=state.year;state.yearEnd=state.year;
    state.metrics = coerceRows(parseCsv(metricText));
    state.metricIndex = new Map(state.metrics.map(row => [Number(row.Test_year),row]));
    state.metadata = metadata; state.importance = importance;
    state.predictions=[...coerceModelRows(parseCsv(predictionText),["town","county","model_name","agreement"]),...coerceModelRows(parseCsv(rollingPredictionText),["town","county","model_name","agreement"])];
    state.modelComparison=coerceModelRows(parseCsv(comparisonText),["model"]);
    state.rollingMetrics=coerceModelRows(parseCsv(rollingMetricsText),["model_name"]);
    state.rfPresenceImportance=coerceModelRows(parseCsv(presenceImportanceText),["predictor"]);
    state.rfCountImportance=coerceModelRows(parseCsv(countImportanceText),["predictor"]);
    state.rollingPresenceImportance=coerceModelRows(parseCsv(rollingPresenceImportanceText),["model","predictor","scoring"]);
    state.rollingCountImportance=coerceModelRows(parseCsv(rollingCountImportanceText),["model","predictor","scoring"]);
    state.rfMetadata=rfMetadata;state.rollingMetadata=rollingMetadata;
    renderSummary(); drawMap(); populateControls(); populateCorrelationControls(); renderSelectedTown(); renderMetrics(); renderCorrelation();renderPrediction();
    renderModelComparison();updateYearSpecificModelPanels();
    document.querySelector("#data-version").textContent = metadata?.data_version || "monthly observation export";
    document.querySelector("#generated-at").textContent = metadata?.generated_at_utc ? new Date(metadata.generated_at_utc).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}) : "—";
    document.querySelector("#loading").classList.add("is-hidden");
  } catch (error) {
    console.error(error);
    document.querySelector("#loading").innerHTML = `<div class="error-message"><strong>Dashboard data could not be loaded.</strong><br>${escapeHtml(error.message)}<br><br>Run this page through a local HTTP server rather than opening the HTML file directly.</div>`;
  }
}

initialize();
