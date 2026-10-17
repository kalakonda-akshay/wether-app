(function () {
  "use strict";

  /* ---------- API endpoints (Open-Meteo: free, no key, CORS enabled) ---------- */
  var GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
  var FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
  var TIMEOUT_MS = 10000;
  var STORE_KEY = "skyline.weather.v1";

  /* ---------- DOM references ---------- */
  var form = document.getElementById("search-form");
  var input = document.getElementById("city");
  var searchBtn = document.getElementById("search-btn");
  var fieldError = document.getElementById("field-error");
  var recentBox = document.getElementById("recent");
  var results = document.getElementById("results");
  var unitButtons = document.querySelectorAll(".units button");

  /* ---------- state ---------- */
  var unit = "C";
  var recent = [];
  var lastData = null;       // last successful { place, weather } so unit changes need no new request
  var activeController = null;

  /* ---------- weather codes (WMO) -> label + icon ---------- */
  function describe(code, isDay) {
    if (code === 0) return { label: "Clear sky", icon: isDay ? "sun" : "moon" };
    if (code === 1) return { label: "Mainly clear", icon: isDay ? "sun" : "moon" };
    if (code === 2) return { label: "Partly cloudy", icon: isDay ? "partly" : "partly-night" };
    if (code === 3) return { label: "Overcast", icon: "cloud" };
    if (code === 45 || code === 48) return { label: "Fog", icon: "fog" };
    if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "rain" };
    if (code >= 61 && code <= 67) return { label: "Rain", icon: "rain" };
    if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow" };
    if (code >= 80 && code <= 82) return { label: "Rain showers", icon: "rain" };
    if (code === 85 || code === 86) return { label: "Snow showers", icon: "snow" };
    if (code >= 95) return { label: "Thunderstorm", icon: "thunder" };
    return { label: "Unknown", icon: "cloud" };
  }

  /* ---------- inline SVG icons (no image requests, theme-aware via CSS classes) ---------- */
  var CLOUD = '<path class="i-cloud" d="M14 35h20a8 8 0 0 0 1-15.9A11 11 0 0 0 13.6 22 6.5 6.5 0 0 0 14 35z"/>';
  var SUN = '<circle class="i-sun" cx="24" cy="24" r="9"/>' +
    '<path class="i-ray" d="M37 24h5M33.2 33.2l3.5 3.5M24 37v5M14.8 33.2l-3.5 3.5M11 24H6M14.8 14.8l-3.5-3.5M24 11V6M33.2 14.8l3.5-3.5"/>';
  var MOON = '<path class="i-moon" d="M31 9a15 15 0 1 0 8 27 12 12 0 0 1-8-27z"/>';
  var ICONS = {
    "sun": SUN,
    "moon": MOON,
    "partly": '<circle class="i-sun" cx="17" cy="17" r="8"/><g transform="translate(6 8) scale(.85)">' + CLOUD + '</g>',
    "partly-night": '<g transform="translate(-4 -4) scale(.75)">' + MOON + '</g><g transform="translate(6 8) scale(.85)">' + CLOUD + '</g>',
    "cloud": '<g transform="translate(0 2)">' + CLOUD + '</g>',
    "fog": '<g transform="translate(0 -5)">' + CLOUD + '</g><path class="i-line" d="M10 36h28M15 42h18"/>',
    "rain": '<g transform="translate(0 -5)">' + CLOUD + '</g><path class="i-drop" d="M16 34l-2.5 7M24 34l-2.5 7M32 34l-2.5 7"/>',
    "snow": '<g transform="translate(0 -5)">' + CLOUD + '</g><circle class="i-snow" cx="16" cy="36" r="2.3"/><circle class="i-snow" cx="24" cy="41" r="2.3"/><circle class="i-snow" cx="32" cy="36" r="2.3"/>',
    "thunder": '<g transform="translate(0 -5)">' + CLOUD + '</g><polygon class="i-bolt" points="26,30 19,40 24,40 22,47 31,35 26,35"/>'
  };

  function iconEl(name, label) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("class", "icon");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    svg.innerHTML = ICONS[name] || ICONS.cloud; // static markup from the table above, never user input
    return svg;
  }

  /* ---------- small DOM helper ---------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- storage ---------- */
  function loadStore() {
    try {
      var data = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (data.unit === "C" || data.unit === "F") unit = data.unit;
      if (Array.isArray(data.recent)) recent = data.recent.filter(function (s) { return typeof s === "string"; }).slice(0, 5);
    } catch (e) { /* storage blocked or corrupt: carry on without it */ }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ unit: unit, recent: recent })); } catch (e) { /* ignore */ }
  }
  function remember(name) {
    recent = [name].concat(recent.filter(function (s) { return s.toLowerCase() !== name.toLowerCase(); })).slice(0, 5);
    saveStore();
    renderRecent();
  }

  /* ---------- validation ---------- */
  function validate(raw) {
    var value = raw.trim().replace(/\s+/g, " ");
    if (!value) return { ok: false, message: "Enter a city name." };
    if (value.length < 2) return { ok: false, message: "City name must be at least 2 characters." };
    if (value.length > 60) return { ok: false, message: "City name is too long (60 characters max)." };
    if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(value)) {
      return { ok: false, message: "Use letters only. Numbers and symbols are not allowed." };
    }
    return { ok: true, value: value };
  }
  function setFieldError(message) {
    fieldError.textContent = message || "";
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }

  /* ---------- network (async/await) ---------- */
  function AppError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  async function fetchJson(url, signal) {
    var response = await fetch(url, { signal: signal });
    if (!response.ok) throw AppError("http", "The weather service returned an error (" + response.status + ").");
    return response.json();
  }

  async function geocode(name, signal) {
    var url = GEO_URL + "?name=" + encodeURIComponent(name) + "&count=1&language=en&format=json";
    var data = await fetchJson(url, signal);
    if (!data.results || !data.results.length) {
      throw AppError("not-found", "No city found for “" + name + "”. Check the spelling or try a larger nearby city.");
    }
    return data.results[0];
  }

  async function getForecast(lat, lon, signal) {
    var url = FORECAST_URL +
      "?latitude=" + lat + "&longitude=" + lon +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=auto&forecast_days=5";
    return fetchJson(url, signal);
  }

  /* ---------- render helpers ---------- */
  function toUnit(c) { return Math.round(unit === "F" ? c * 9 / 5 + 32 : c); }
  function deg() { return "°" + unit; }

  function showSkeleton() {
    results.replaceChildren();
    results.appendChild(el("div", "skel skel-main"));
    var row = el("div", "skel-days");
    for (var i = 0; i < 5; i++) row.appendChild(el("div", "skel skel-day"));
    results.appendChild(row);
  }

  function showState(kind, title, text, retryName) {
    results.replaceChildren();
    var box = el("div", "state" + (kind === "error" ? " error" : ""));
    if (kind === "error") box.setAttribute("role", "alert");
    box.appendChild(el("h2", "", title));
    box.appendChild(el("p", "", text));
    if (retryName) {
      var btn = el("button", "btn-primary", "Try again");
      btn.type = "button";
      btn.addEventListener("click", function () { search(retryName); });
      box.appendChild(btn);
    }
    results.appendChild(box);
  }

  function render() {
    if (!lastData) return;
    var place = lastData.place, w = lastData.weather, cur = w.current;
    var info = describe(cur.weather_code, cur.is_day === 1);
    results.replaceChildren();

    /* current conditions */
    var card = el("article", "current");

    var head = el("div");
    var where = [place.name, place.admin1, place.country].filter(Boolean);
    // drop duplicates such as "Singapore, Singapore"
    where = where.filter(function (v, i) { return where.indexOf(v) === i; });
    head.appendChild(el("h2", "place", where.join(", ")));
    var t = cur.time.split("T");
    var dateObj = new Date(t[0] + "T00:00:00");
    head.appendChild(el("p", "when",
      dateObj.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + " · " + t[1] + " local time"));
    card.appendChild(head);

    var now = el("div", "now");
    now.appendChild(iconEl(info.icon, info.label));
    var tempWrap = el("div");
    var temp = el("div", "temp", String(toUnit(cur.temperature_2m)));
    temp.appendChild(el("small", "", deg()));
    tempWrap.appendChild(temp);
    tempWrap.appendChild(el("div", "cond", info.label));
    now.appendChild(tempWrap);
    card.appendChild(now);

    var facts = el("dl", "facts");
    [
      ["Feels like", toUnit(cur.apparent_temperature) + deg()],
      ["Humidity", cur.relative_humidity_2m + "%"],
      ["Wind", Math.round(cur.wind_speed_10m) + " km/h"]
    ].forEach(function (pair) {
      var f = el("div", "fact");
      f.appendChild(el("dt", "", pair[0]));
      f.appendChild(el("dd", "", pair[1]));
      facts.appendChild(f);
    });
    card.appendChild(facts);
    results.appendChild(card);

    /* 5-day forecast */
    results.appendChild(el("h3", "forecast-title", "5-day forecast"));
    var list = el("ul", "days");
    var d = w.daily;
    for (var i = 0; i < d.time.length; i++) {
      var di = describe(d.weather_code[i], true);
      var li = el("li", "day");
      var name = i === 0 ? "Today" : new Date(d.time[i] + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" });
      li.appendChild(el("span", "dname", name));
      li.appendChild(iconEl(di.icon, di.label));
      var range = el("span", "range", toUnit(d.temperature_2m_max[i]) + "° ");
      range.appendChild(el("span", "lo", toUnit(d.temperature_2m_min[i]) + "°"));
      li.appendChild(range);
      var pop = d.precipitation_probability_max ? d.precipitation_probability_max[i] : null;
      li.appendChild(el("span", "rain", pop === null || pop === undefined ? di.label : pop + "% rain"));
      li.title = di.label;
      list.appendChild(li);
    }
    results.appendChild(list);
  }

  function renderRecent() {
    recentBox.replaceChildren();
    recent.forEach(function (name) {
      var chip = el("button", "chip", name);
      chip.type = "button";
      chip.addEventListener("click", function () { input.value = name; search(name); });
      recentBox.appendChild(chip);
    });
  }

  function renderUnits() {
    unitButtons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.unit === unit)); });
  }

  /* ---------- the main flow ---------- */
  async function search(rawName) {
    var check = validate(rawName);
    if (!check.ok) { setFieldError(check.message); input.focus(); return; }
    setFieldError("");

    if (activeController) activeController.abort();           // cancel an older request still in flight
    var controller = new AbortController();
    activeController = controller;
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, TIMEOUT_MS);

    searchBtn.disabled = true;
    results.setAttribute("aria-busy", "true");
    showSkeleton();

    try {
      var place = await geocode(check.value, controller.signal);
      var weather = await getForecast(place.latitude, place.longitude, controller.signal);
      lastData = { place: place, weather: weather };
      render();
      remember(place.name);
      input.value = "";
    } catch (err) {
      if (err.name === "AbortError" && !timedOut) return;     // replaced by a newer search: stay quiet
      if (err.code === "not-found") {
        showState("error", "City not found", err.message);
      } else if (timedOut) {
        showState("error", "Request timed out", "The weather service took too long to answer. Check your connection and try again.", check.value);
      } else if (err.code === "http") {
        showState("error", "Weather service problem", err.message, check.value);
      } else {
        showState("error", "Could not load weather", "Check your internet connection and try again.", check.value);
      }
    } finally {
      clearTimeout(timer);
      if (activeController === controller) {
        activeController = null;
        searchBtn.disabled = false;
        results.setAttribute("aria-busy", "false");
      }
    }
  }

  /* ---------- events ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    search(input.value);
  });
  input.addEventListener("input", function () { if (fieldError.textContent) setFieldError(""); });

  unitButtons.forEach(function (b) {
    b.addEventListener("click", function () {
      unit = b.dataset.unit;
      saveStore();
      renderUnits();
      render();                                               // re-render from saved data, no new request
    });
  });

  /* ---------- start ---------- */
  loadStore();
  renderUnits();
  renderRecent();
  search(recent[0] || "London");
})();
