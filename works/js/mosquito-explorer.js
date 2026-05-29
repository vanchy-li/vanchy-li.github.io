const csvPath = "data/mosquito_weekly.csv";

const eggColumn = "total_mean_eggs";
const dateColumn = "date";

let data = [];
let environmentalColumns = [];

d3.csv(csvPath)
  .then(rawData => {
    if (!rawData || rawData.length === 0) {
      throw new Error("CSV loaded but contains no rows.");
    }

    data = rawData.map(d => {
      const parsed = {};

      Object.keys(d).forEach(key => {
        if (key === dateColumn) {
          parsed[key] = new Date(d[key]);
        } else {
          parsed[key] = d[key] === "" ? null : +d[key];
        }
      });

      return parsed;
    });

    environmentalColumns = Object.keys(data[0]).filter(
      col => col !== dateColumn && col !== eggColumn
    );

    populateControls();
    updateSelectedVariablePlot();
    updateSixPanelPlots();
  })
  .catch(error => {
    console.error("Error loading CSV:", error);

    document.getElementById("correlation").textContent =
      "Error loading data. Please check whether data/mosquito_weekly.csv exists and whether the column names are correct.";
  });

function populateControls() {
  const dropdown = document.getElementById("env-variable");

  environmentalColumns.forEach(col => {
    const option = document.createElement("option");
    option.value = col;
    option.textContent = col;
    dropdown.appendChild(option);
  });

  dropdown.addEventListener("change", updateSelectedVariablePlot);

  const lagSlider = document.getElementById("lag-slider");

  lagSlider.addEventListener("input", () => {
    document.getElementById("lag-value").textContent = lagSlider.value;
    updateSelectedVariablePlot();
    updateSixPanelPlots();
  });

  document
    .getElementById("air-temp-choice")
    .addEventListener("change", updateSixPanelPlots);

  document
    .getElementById("moisture-choice")
    .addEventListener("change", updateSixPanelPlots);

  document
    .getElementById("lst-choice")
    .addEventListener("change", updateSixPanelPlots);
}

function applyLag(values, lag) {
  if (lag === 0) return values;

  return Array(lag)
    .fill(null)
    .concat(values.slice(0, values.length - lag));
}

function getValidPairs(x, y) {
  return x
    .map((xi, i) => [xi, y[i]])
    .filter(pair =>
      pair[0] !== null &&
      pair[1] !== null &&
      !isNaN(pair[0]) &&
      !isNaN(pair[1])
    );
}

function calculatePearson(x, y) {
  const validPairs = getValidPairs(x, y);

  if (validPairs.length < 3) return null;

  const xs = validPairs.map(p => p[0]);
  const ys = validPairs.map(p => p[1]);

  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  const numerator = xs.reduce((sum, xi, i) => {
    return sum + (xi - meanX) * (ys[i] - meanY);
  }, 0);

  const denominatorX = Math.sqrt(
    xs.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0)
  );

  const denominatorY = Math.sqrt(
    ys.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0)
  );

  if (denominatorX === 0 || denominatorY === 0) return null;

  return numerator / (denominatorX * denominatorY);
}

function rankArray(values) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array(values.length);

  let i = 0;

  while (i < sorted.length) {
    let j = i;

    while (
      j + 1 < sorted.length &&
      sorted[j + 1].value === sorted[i].value
    ) {
      j++;
    }

    const averageRank = (i + j + 2) / 2;

    for (let k = i; k <= j; k++) {
      ranks[sorted[k].index] = averageRank;
    }

    i = j + 1;
  }

  return ranks;
}

function calculateSpearman(x, y) {
  const validPairs = getValidPairs(x, y);

  if (validPairs.length < 3) return null;

  const xs = validPairs.map(p => p[0]);
  const ys = validPairs.map(p => p[1]);

  const rankX = rankArray(xs);
  const rankY = rankArray(ys);

  return calculatePearson(rankX, rankY);
}

function standardize(values) {
  const validValues = values.filter(v => v !== null && !isNaN(v));

  if (validValues.length < 2) {
    return values.map(() => null);
  }

  const mean =
    validValues.reduce((a, b) => a + b, 0) / validValues.length;

  const sd = Math.sqrt(
    validValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      validValues.length
  );

  if (sd === 0) {
    return values.map(() => null);
  }

  return values.map(v => {
    if (v === null || isNaN(v)) return null;
    return (v - mean) / sd;
  });
}

function updateSelectedVariablePlot() {
  const selectedVariable = document.getElementById("env-variable").value;
  const lag = +document.getElementById("lag-slider").value;

  if (!selectedVariable) return;

  const dates = data.map(d => d[dateColumn]);
  const eggs = data.map(d => d[eggColumn]);

  const envRaw = data.map(d => d[selectedVariable]);
  const envLagged = applyLag(envRaw, lag);

  const pearson = calculatePearson(eggs, envLagged);
  const spearman = calculateSpearman(eggs, envLagged);

  const pearsonText =
    pearson === null
      ? "Pearson: not enough valid data"
      : `Pearson: ${pearson.toFixed(3)}`;

  const spearmanText =
    spearman === null
      ? "Spearman: not enough valid data"
      : `Spearman: ${spearman.toFixed(3)}`;

  document.getElementById("correlation").textContent =
    `${pearsonText} | ${spearmanText} at ${lag}-week lag`;

  const eggTrace = {
    x: dates,
    y: eggs,
    type: "scatter",
    mode: "lines+markers",
    name: "Mosquito eggs",
    yaxis: "y1"
  };

  const envTrace = {
    x: dates,
    y: envLagged,
    type: "scatter",
    mode: "lines+markers",
    name: `${selectedVariable}, lagged ${lag} week(s)`,
    yaxis: "y2"
  };

  const layout = {
    title: `Mosquito eggs vs. ${selectedVariable}`,
    xaxis: {
      title: "Date"
    },
    yaxis: {
      title: "Mean egg count",
      side: "left"
    },
    yaxis2: {
      title: selectedVariable,
      overlaying: "y",
      side: "right"
    },
    hovermode: "x unified",
    legend: {
      orientation: "h"
    },
    margin: {
      t: 60,
      r: 70,
      b: 60,
      l: 70
    }
  };

  Plotly.newPlot("plot", [eggTrace, envTrace], layout, {
    responsive: true
  });
}

function makeMiniPanel(panelId, title, variableName, lag) {
  const dates = data.map(d => d[dateColumn]);
  const eggs = data.map(d => d[eggColumn]);

  const envRaw = data.map(d => d[variableName]);
  const envLagged = applyLag(envRaw, lag);

  const eggsStandardized = standardize(eggs);
  const envStandardized = standardize(envLagged);

  const pearson = calculatePearson(eggs, envLagged);
  const spearman = calculateSpearman(eggs, envLagged);

  const pearsonLabel =
    pearson === null ? "NA" : pearson.toFixed(2);

  const spearmanLabel =
    spearman === null ? "NA" : spearman.toFixed(2);

  const eggTrace = {
    x: dates,
    y: eggsStandardized,
    type: "scatter",
    mode: "lines",
    name: "Eggs",
    line: {
      width: 2
    }
  };

  const envTrace = {
    x: dates,
    y: envStandardized,
    type: "scatter",
    mode: "lines",
    name: variableName,
    line: {
      width: 2
    }
  };

  const layout = {
    title: {
      text: `${title}<br><sup>${variableName}; r=${pearsonLabel}, ρ=${spearmanLabel}</sup>`,
      font: {
        size: 14
      }
    },
    xaxis: {
      title: "",
      showgrid: true
    },
    yaxis: {
      title: "Standardized",
      showgrid: true
    },
    hovermode: "x unified",
    legend: {
      orientation: "h",
      font: {
        size: 10
      }
    },
    margin: {
      t: 55,
      r: 20,
      b: 40,
      l: 45
    }
  };

  Plotly.newPlot(panelId, [eggTrace, envTrace], layout, {
    responsive: true,
    displayModeBar: false
  });
}

function updateSixPanelPlots() {
  const lag = +document.getElementById("lag-slider").value;

  const airTempVariable =
    document.getElementById("air-temp-choice").value;

  const moistureVariable =
    document.getElementById("moisture-choice").value;

  const lstVariable =
    document.getElementById("lst-choice").value;

  makeMiniPanel(
    "panel-air-temp",
    "Air temperature",
    airTempVariable,
    lag
  );

  makeMiniPanel(
    "panel-precipitation",
    "Precipitation",
    "precipitation",
    lag
  );

  makeMiniPanel(
    "panel-moisture",
    "Moisture",
    moistureVariable,
    lag
  );

  makeMiniPanel(
    "panel-lst",
    "Land surface temperature",
    lstVariable,
    lag
  );

  makeMiniPanel(
    "panel-soil-moisture",
    "Soil moisture",
    "soil_moisture_surface",
    lag
  );

  makeMiniPanel(
    "panel-ndvi",
    "NDVI",
    "ndvi",
    lag
  );
}