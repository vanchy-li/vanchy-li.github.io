(function () {
  "use strict";

  var channels = ["red", "green", "blue"];
  var threshold = -0.373;

  function updateFormula() {
    var values = channels.map(function (name) {
      var value = Number(document.getElementById(name).value) / 100;
      document.getElementById(name + "-value").textContent = value.toFixed(2);
      return value;
    });
    var value = Math.max.apply(null, values);
    var minimum = Math.min.apply(null, values);
    var saturation = value === 0 ? 0 : (value - minimum) / value;
    var denominator = value + saturation;
    var vbi = denominator === 0 ? 0 : (value - saturation) / denominator;
    var built = vbi >= threshold;

    document.getElementById("value-result").textContent = value.toFixed(3);
    document.getElementById("saturation-result").textContent = saturation.toFixed(3);
    document.getElementById("vbi-result").textContent = vbi.toFixed(3);
    document.getElementById("swatch").style.background = "rgb(" +
      values.map(function (number) { return Math.round(number * 255); }).join(",") + ")";

    var classification = document.getElementById("classification");
    classification.classList.toggle("built", built);
    classification.querySelector("b").textContent =
      built ? "Mapped built-up" : "Mapped non-built-up";
  }

  channels.forEach(function (name) {
    document.getElementById(name).addEventListener("input", updateFormula);
  });

  var imageData = JSON.parse(document.getElementById("atlas-images").textContent);
  var views = {
    original: {
      alt: "Sentinel-2 image of Córdoba with validation sample locations",
      kicker: "SENTINEL-2 · 24 JANUARY 2024",
      title: "The Córdoba study landscape",
      description: "The 601 km² study area combines a dense reflective urban core, suburban vegetation, the Suquía River, cropland, and fallow fields. The points show the 615 pixels used for validation."
    },
    indices: {
      alt: "Continuous NDBI, BU and VBI maps of Córdoba",
      kicker: "CONTINUOUS VALUES · −1 TO +1",
      title: "Three ways of seeing built-up land",
      description: "NDBI is relatively homogeneous, BU more clearly separates vegetation, and VBI produces strong contrast for reflective urban surfaces while deemphasizing water and vegetation."
    },
    thresholds: {
      alt: "Binary built-up maps for NDBI, BU and VBI",
      kicker: "BINARY CLASSIFICATION · PUBLISHED THRESHOLDS",
      title: "The threshold changes the map",
      description: "White pixels are mapped built-up and black pixels are mapped non-built-up. NDBI and BU include more surrounding bare land, while VBI concentrates more strongly on the urban fabric."
    }
  };

  document.querySelectorAll(".atlas-tabs button").forEach(function (button) {
    button.addEventListener("click", function () {
      var key = button.getAttribute("data-view");
      var selected = views[key];
      document.querySelectorAll(".atlas-tabs button").forEach(function (item) {
        item.setAttribute("aria-selected", String(item === button));
      });
      var image = document.getElementById("atlas-image");
      image.src = "data:image/jpeg;base64," + imageData[key];
      image.alt = selected.alt;
      document.getElementById("atlas-kicker").textContent = selected.kicker;
      document.getElementById("atlas-title").textContent = selected.title;
      document.getElementById("atlas-description").textContent = selected.description;
      document.getElementById("atlas-legend").hidden = key !== "thresholds";
    });
  });

  updateFormula();
}());
