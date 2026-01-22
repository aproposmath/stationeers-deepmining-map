const AUTOLATHE_ICON_URL = "https://stationeers-wiki.com/images/8/85/StructureAutolathe_BuildState4.png"
const PLAYER_ICON_URL = "icon_transparent.webp"

function setCanvasSize(width, height) {
  const minDim = Math.min(calcWidth, calcHeight);
  canvasWidth = minDim;
  canvasHeight = minDim;
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

function getSettingsFromUI() {
  const transform = d3.zoomTransform(document.getElementById("canvasContainer"));
  const checkBoxes = colorFilter.selectAll("input[type=checkbox]").nodes();
  selectedRegions = [];
  for (const i in checkBoxes) {
    if (checkBoxes[i].checked)
      selectedRegions.push(+i);
  }
  const settings = {
    planet: currentPlanet,
    region: currentRegionType,
    terrain: document.getElementById('toggleTerrain').checked ? '1' : '0',
    spawn: document.getElementById('toggleSpawn').checked ? '1' : '0',
    zoom: transform.k.toFixed(2),
    selected: selectedRegions === null ? "" : selectedRegions.join('-'),
    rotate: northUp ? '1' : '0',
    ...coordinatesFromScreen(),
  };

  if (iconsData.length > 0) {
    settings.icons = encodeURIComponent(JSON.stringify(iconsData));
  }

  const query = new URLSearchParams(settings).toString();
  const url = window.location.origin + window.location.pathname + '?' + query;
  navigator.clipboard.writeText(url);
  // replace current url without reloading
  window.history.pushState({}, '', url);
  showToast("Link copied to clipboard!");
}

function applySettingsFromQuery(params) {
  const terrain = params.get('terrain');
  if (terrain !== null) {
    document.getElementById('toggleTerrain').checked = terrain === '1';
  }

  const spawn = params.get('spawn');
  if (spawn !== null) {
    document.getElementById('toggleSpawn').checked = spawn === '1';
  }
  const scale = parseFloat(params.get('zoom'));

  // get x/z map coordinates
  let x = parseFloat(params.get('x'));
  let z = parseFloat(params.get('z'));

  northUp = params.get("rotate") === '1';
  document.getElementById('toggleNorth').checked = northUp ? true : false;

  if (!isNaN(scale) && !isNaN(x) && !isNaN(z)) {
    if( northUp) {
      x = -x;
      z = -z;
    }

    const svgX = canvasWidth  * (x / mapWidth  + 0.5);
    const svgY = canvasHeight * (0.5 - z / mapHeight);

    getContentOffset();

    const cx = contentOffsetX + canvasWidth  / 2;
    const cy = contentOffsetY + canvasHeight / 2;

    // choose t so that (svg + offset) ends up at the screen center after scaling
    const tx = cx - (svgX + contentOffsetX) * scale;
    const ty = cy - (svgY + contentOffsetY) * scale;

    d3.select("#canvasContainer").call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
  selectedRegions = params.get('selected');
  if (selectedRegions === null)
    selectedRegions = [0];
  else
    selectedRegions = selectedRegions.split('-').map(s => parseInt(s));

  isEmbed = params.get('embed') === '1';
  if (isEmbed) {
    document.getElementById('fileButtons').style.display = 'none';
    document.getElementById('sidePane').style.display = 'none';
    const root = document.getElementById('root');
    root.style.margin = '0px';
    root.style.padding = '0px';
    root.style.boxShadow = 'none';
    document.body.style.background = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0px';
  }

  const icons = params.get('icons');
  if (icons !== null) {
    try {
      iconsData = JSON.parse(decodeURIComponent(icons));
    } catch (e) {
      console.error("Failed to parse icons from URL:", e);
      iconsData = [];
    }
  }
}

function updateIconPositions() {
  const transform = d3.zoomTransform(document.getElementById("canvasContainer"));
  const iconLayer = d3.select("#iconLayer");
  iconLayer.selectAll("img").each(function () {
    const img = d3.select(this);
    let dataX = +img.attr("data-x");
    let dataY = +img.attr("data-y");

    if (northUp) {
      dataX = - dataX;
      dataY = - dataY;
    }

    dataX = (dataX + 0.5) * canvasWidth;
    dataY = (dataY + 0.5) * canvasHeight;

    const screenX = transform.applyX(dataX) + contentOffsetX;
    const screenY = transform.applyY(dataY) + contentOffsetY;

    img.style("left", `${screenX}px`)
      .style("top", `${screenY}px`);

    const container = document.getElementById("canvasContainer");
    const containerRect = container.getBoundingClientRect();
    const isVisible = screenX >= 0 && screenX <= containerRect.width && screenY >= 0 && screenY <= containerRect.height;
    img.style("display", isVisible ? "block" : "none");
  });
}

function addIcons() {
  const iconLayer = d3.select("#iconLayer");
  iconLayer.selectAll("img").remove();

  for (const icon of iconsData) {
    let url = "";
    if (icon.type === "player") {
      url = PLAYER_ICON_URL;
    }
    else if (icon.type === "autolathe") {
      url = AUTOLATHE_ICON_URL;
    }

    const size = icon.size || 32;
    const img = iconLayer.append("img")
      .attr("src", url)
      .style("position", "absolute")
      .style("width", `${size}px`)
      .style("height", `${size}px`)
      .style("transform", "translate(-16px, -16px)")
      .attr("data-x", icon.position[0] / mapWidth)
      .attr("data-y", -icon.position[2] / mapHeight);
  }
  updateIconPositions();
}

function coordinatesFromScreen(screenX, screenY) {
    getContentOffset();
    const transform = d3.zoomTransform(document.getElementById("canvasContainer"));
    if(screenX === undefined || screenY === undefined) {
      // take the center of the canvas
      const container = document.getElementById("canvasContainer");
      const containerRect = container.getBoundingClientRect();
      screenX = containerRect.width / 2;
      screenY = containerRect.height / 2;
    }
    const canvasX = screenX - contentOffsetX * transform.k;
    const canvasY = screenY - contentOffsetY * transform.k;
    const svgX = (canvasX - transform.x) / transform.k;
    const svgY = (canvasY - transform.y) / transform.k;

    let x = Math.round((svgX / canvasWidth - 0.5) * mapWidth);
    let y = Math.round((0.5 - svgY / canvasHeight) * mapHeight);
    if (northUp) {
      x = -x;
      y = -y;
    }
    return {x: x, z: y};
}


const svg = d3.select("#svg");
const tooltip = d3.select("#tooltip");

const colorFilter = d3.select("#colorFilter");

let isEmbed = false;
let allData = {};
let iconsData = [];
const params = new URLSearchParams(window.location.search);
let canvasWidth = -1;
let canvasHeight = -1;

let calcWidth = 800;
let calcHeight = 800;
{
  const sidebarSpace = 260 * 2;
  const paddingGapSpace = 16 * 3;
  calcWidth = Math.max(400, window.innerWidth - sidebarSpace - paddingGapSpace);
  calcHeight = Math.max(400, window.innerHeight - 32);
}

setCanvasSize(parseInt(params.get('width') || calcWidth), parseInt(params.get('height') || calcHeight));
let currentPlanet = params.get('planet') || 'lunar';
let currentRegionType = params.get('region') || 'mining';
let selectedRegions = [0];
let northUp = true;
let mapWidth = 4000;
let mapHeight = 4000;

let updateRender = () => { };
let render = () => { };
let contentOffsetX = 0;
let contentOffsetY = 0;

function getContentOffset() {
  const container = document.getElementById("canvasContainer");
  const containerRect = container.getBoundingClientRect();
  contentOffsetX = (containerRect.width - canvasWidth) / 2;
  contentOffsetY = (containerRect.height - canvasHeight) / 2;
}

let zoomTransform = d3.zoomIdentity;

function updateTransform() {
  const x = contentOffsetX * zoomTransform.k;
  const y = contentOffsetY * zoomTransform.k;
  for (var group of ["mining", "names", "poi", "spawn", "imageGroup"]) {
    svg.select("." + group).attr("transform", `translate(${x}, ${y}) ${zoomTransform}`);
  }
  updateIconPositions();
  const container = document.getElementById("canvasContainer");
  const containerRect = container.getBoundingClientRect();
  const compass = svg.select(".compass");
  compass.raise();
  compass.attr("transform", `translate(${containerRect.width - 30}, ${containerRect.height - 40})`);
}

const zoom = d3.zoom()
  .scaleExtent([0.5, 100])
  .on("zoom", (event) => {
    const t = event.transform;
    zoomTransform = event.transform;
    updateTransform();
  });
applySettingsFromQuery(params);

d3.select("#canvasContainer").call(zoom);

loadMap(currentPlanet, currentRegionType, false);

async function loadData(planet) {

  const raw = await d3.json(`data/${planet}.json`);
  const data = {};

  for (const key in raw) {
    if (['mining', 'names', 'poi'].includes(key)) {
      data[key] = topojson.feature(raw[key], raw[key].objects.data);
    }
    else {
      data[key] = raw[key];
    }
  }
  if (northUp) {
    for (const key of ['mining', 'names', 'poi']) {
      data[key].features.forEach(f => {
        f.geometry.coordinates = f.geometry.coordinates.map(polygon => {
          return polygon.map(([x, y]) => ([-x, -y]));
        });
      });
    }
  }

  return data;
}

async function loadMap(planet, regionType) {
  currentPlanet = planet;
  currentRegionType = regionType;

  for (var group of ["mining", "names", "poi", "spawn"]) {
    svg.select("." + group).remove();
  }

  allData = await loadData(planet);
  const geojson = allData.mining;

  function getSelectedColors() {
    const checked = colorFilter.selectAll("input[type=checkbox]:checked").nodes();
    const values = checked.map(input => input.value);
    if (values.includes("all")) return true;
    return new Set(values);
  }


  const projection = d3.geoIdentity().reflectY(true).fitSize([canvasWidth, canvasHeight], geojson);
  const path = d3.geoPath().projection(projection);
  svg.selectAll("g").remove();
  
  getContentOffset();
  
  const g = svg.append("g").attr("class", "imageGroup");
  const currentTransform = d3.zoomTransform(document.getElementById("canvasContainer"));
  g.attr("transform", `translate(${contentOffsetX}, ${contentOffsetY}) ${currentTransform}`)
  const imgTransform = northUp ? `rotate(180, ${canvasWidth / 2}, ${canvasHeight / 2})` : "";
  const invertFilter = northUp ? "invert(1)" : "none";
  const terrainImage = g.append("image")
    .attr("class", "terrainImage")
    .attr("href", `data/${planet}_terrain.webp`)
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", canvasWidth)
    .attr("height", canvasHeight)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("opacity", 1.0)
    .attr("transform", imgTransform)
    .style("filter", invertFilter);
  ;

  const hideTooltip = () => {tooltip.style("opacity", 0.0)};
  svg.on("mouseleave", hideTooltip)

  svg.on("mousemove", function (event) {
    const [mouseX, mouseY] = d3.pointer(event);
    const {x, z} = coordinatesFromScreen(mouseX, mouseY);

    if (x < -mapWidth / 2 || x > mapWidth / 2 || z < -mapHeight / 2 || z > mapHeight / 2) {
      hideTooltip();
      return;
    }

    tooltip
      .style("opacity", 1)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY + 20) + "px")
      .html(`
          <strong>X:</strong> ${x} <br/>
          <strong>Z:</strong> ${z} <br/>`);
  });

  function addCompass() {
    svg.selectAll(".compass").remove();
    const size = 60;
    const w2 = 10;

    const compass = svg.append("g")
      .attr("class", "compass")

    const arrow = compass.append("g")
      .attr("class", "compass-arrow")

    const x0 = -w2;
    const x1 = w2;
    let y0 = 0;
    let y1 = -size;
    let textPos = 20;

    if (northUp) {
      y0 = -size;
      y1 = 0;
      textPos = - size - 10;
    }

    arrow.append("path")
      .attr("d", d3.line()([[0, y0], [x0, y1], [x1, y1], [0, y0]]))
      .attr("fill", "red");

    compass.append("text")
      .attr("y", textPos)
      .attr("text-anchor", "middle")
      .text("N")
      .style("font-size", "20px")
      .style("fill", "red")
      .style("stroke", "black")
      .style("stroke-width", "2px")
      .style("paint-order", "stroke")
  }

  function renderRegions(regionType, opacity, selectedColors) {
    addCompass();
    svg.select("." + regionType).remove();
    const g = svg.append("g").attr("class", regionType);
    const currentTransform = d3.zoomTransform(document.getElementById("canvasContainer"));
    g.attr("transform", `translate(${contentOffsetX}, ${contentOffsetY}) ${currentTransform}`);
    const data = allData[regionType];

    const allFeatures = data.features;

    const isVisible = (d) => {
      if (selectedColors === undefined) return true;
      if (selectedColors === true) return true;
      const col = d.properties.color_hex;
      if (col === undefined) return true;
      return selectedColors.has(col);
    };

    const regions = g.selectAll("path")
      .data(allFeatures)
      .enter()
      .append("path")
      .attr("d", path)
      .style("opacity", opacity)
      .attr("fill", d => {
        const c = d.properties.color_hex || "transparent";
        return isVisible(d) ? c : "transparent";
      })
      .style("mix-blend-mode", "multiply")
      ;
    g.selectAll("text")
      .data(allFeatures)
      .enter()
      .append("text")
      .style("font-size", "14px")
      .style("fill", "white")
      .style("stroke", "black")
      .style("stroke-width", "2px")
      .style("paint-order", "stroke")
      .attr("transform", d => {
        const centroid = path.centroid(d);
        return `translate(${centroid[0]}, ${centroid[1]})`;
      })
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .each(function (d) {
        if (isVisible(d) === false) return;
        const textEl = d3.select(this);
        const lines = d.properties.name?.split(" ") || [];
        const lineHeightEm = 1.2;
        const offset = -((lines.length - 1) / 2) * lineHeightEm;

        lines.forEach((line, i) => {
          textEl.append("tspan")
            .attr("x", 0)
            .attr("dy", (i === 0 ? offset : lineHeightEm) + "em")
            .text(line);
        });
      });

  }

  render = () => {
    const showTerrain = document.getElementById("toggleTerrain").checked;
    const showSpawn = document.getElementById("toggleSpawn").checked;

    svg.select(".terrainImage").attr("visibility", showTerrain ? "visible" : "hidden");

    zoom.on("start", hideTooltip)

    const regionType = currentRegionType;
    svg.select(".mining").remove();
    svg.select(".names").remove();
    svg.select(".poi").remove();
    svg.select(".spawn").remove();
    const opacity = showTerrain || showSpawn ? 0.7 : 1.0;

    const selectedColors = getSelectedColors();
    renderRegions(regionType, opacity, selectedColors);

    const spawn = svg.append("g").attr("class", "spawn");
    spawn.attr("visibility", showSpawn ? "visible" : "hidden");
    const currentTransform = d3.zoomTransform(document.getElementById("canvasContainer"));
    spawn.attr("transform", `translate(${contentOffsetX}, ${contentOffsetY}) ${currentTransform}`);

    Object.entries(allData.start_locations).forEach(([name, coords]) => {
      let px = coords[0] / mapWidth + 0.5;
      let py = 1.0 - (coords[1] / mapHeight + 0.5);
      if (northUp) {
        px = 1 - px;
        py = 1 - py;
      }
      const [x, y] = [canvasWidth * px, canvasHeight * py]

      spawn.append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", 5)
        .attr("fill", "red")
        .attr("stroke", "black")
        .attr("stroke-width", 1);

      spawn.append("text")
        .attr("x", x + 7)
        .attr("y", y - 7)
        .text(name)
        .style("font-size", "14px")
        .style("fill", "white")
        .style("stroke", "black")
        .style("stroke-width", "2px")
        .style("paint-order", "stroke")
    });

    svg.select(".icons").raise();
    updateTransform();
  }

  clampValue = (color, minV, maxV) => {
    const hsv = d3.hsv(color);
    hsv.v = Math.max(minV, Math.min(maxV, hsv.v));
    return hsv.formatHex();      // back to #rrggbb
  }

  updateRender = () => {
    colorFilter.selectAll("*").remove();
    const data = allData[currentRegionType].features;

    const uniqueColors = Array.from(new Set(data.map(f => f.properties.color_hex)))
      .filter(c => c);

    const color2Name = {};

    data.forEach(f => {
      if (f.properties.color_hex)
        color2Name[f.properties.color_hex] = f.properties.name;
    });

    colorFilter.append("label")
      .html(`<input type="checkbox" value="all"> All`)
      .style("margin-right", "10px")
      .style("display", "block")
      ;

    uniqueColors.forEach(color => {
      colorFilter.append("label")
        .html(`<input type="checkbox" value="${color}"> <span>${color2Name[color]}</span>`)
        .style("background-color", clampValue(color, 0.0, 0.7))
        .style("display", "block")
        .style("margin-right", "10px");
    });
    for (const i in colorFilter.selectAll("input[type=checkbox]").nodes())
      if (selectedRegions.includes(parseInt(i)))
        colorFilter.selectAll("input[type=checkbox]").nodes()[i].checked = true;

    colorFilter.selectAll("input[type=checkbox]").on("change", function () {
      if (this.value === "all") {
        if (this.checked) {
          colorFilter.selectAll("input[type=checkbox]").property("checked", false);
          this.checked = true;
        }
      } else {
        if (this.checked) {
          colorFilter.select("input[value=all]").property("checked", false);
        }
        if (colorFilter.selectAll("input[type=checkbox]:checked").nodes().length === 0) {
          colorFilter.select("input[value=all]").property("checked", true);
        }
      }
      render();
    });

    render();
  }

  updateRender();
  addIcons()
}

d3.selectAll("#planetButtons button").on("click", function () {
  const planet = d3.select(this).attr("data-file");
  d3.select("#canvasContainer").call(zoom.transform, d3.zoomIdentity);
  selectedRegions = [0];
  loadMap(planet, currentRegionType);
  if (window.location.search.length > 0)
    window.history.pushState({}, '', window.location.origin + window.location.pathname);
});

d3.selectAll("#regionTypeButtons button").on("click", function () {
  selectedRegions = [0];
  currentRegionType = d3.select(this).attr("data-region");
  updateRender();
});
d3.select("#toggleTerrain").on("change", () => {render();});
d3.select("#toggleSpawn").on("change", () => {render();});
d3.select("#toggleNorth").on("change", () => {
  northUp = d3.select("#toggleNorth").property("checked");
  loadMap(currentPlanet, currentRegionType);
  if (window.location.search.length > 0)
    window.history.pushState({}, '', window.location.origin + window.location.pathname);
});

d3.select("#share").on("click", () => {
  getSettingsFromUI();
});

window.addEventListener("resize", () => {
  const container = document.getElementById("canvasContainer");
  const containerRect = container.getBoundingClientRect();
  setCanvasSize(containerRect.width, containerRect.height);
  getContentOffset();
  updateTransform();
  render();
})
