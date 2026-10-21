(() => {
  "use strict";

  /* ─── Helpers ─── */
  const $ = (id) => document.getElementById(id);
  const apiRoot = () => {
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    const isLocalPreview = ["localhost", "127.0.0.1", ""].includes(location.hostname);
    const saved = localStorage.getItem("kopinova-esp32-url") || "";
    return (isHttp && !isLocalPreview ? location.origin : saved).replace(/\/$/, "");
  };


  /* ─── Theme and accent controls ─── */
  const appearance = {
    mode: localStorage.getItem("kopinova-theme-mode") || "dark",
    accent: localStorage.getItem("kopinova-theme-accent") || "#d4a853",
  };

  function applyAppearance() {
    const root = document.documentElement;
    root.dataset.theme = appearance.mode;
    root.style.colorScheme = appearance.mode;
    root.style.setProperty("--accent", appearance.accent);
    const hex = appearance.accent.replace("#", "");
    const value = Number.parseInt(hex, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, .12)`);
    root.style.setProperty("--accent-medium", `rgba(${r}, ${g}, ${b}, .25)`);
    root.style.setProperty("--shadow-glow", `0 0 40px rgba(${r}, ${g}, ${b}, .10)`);

    const lightMode = appearance.mode === "light";
    $("themeModeIcon").textContent = lightMode ? "☾" : "☼";
    $("themeModeLabel").textContent = lightMode ? "Gelap" : "Terang";
    $("themeModeToggle").setAttribute("aria-pressed", String(lightMode));
    document.querySelectorAll(".accent-swatch").forEach((button) => {
      const selected = button.dataset.accent.toLowerCase() === appearance.accent.toLowerCase();
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("customAccent").value = appearance.accent;
    const isPreset = [...document.querySelectorAll(".accent-swatch")]
      .some((button) => button.dataset.accent.toLowerCase() === appearance.accent.toLowerCase());
    $("customAccent").parentElement.classList.toggle("selected", !isPreset);
  }

  function setupAppearance() {
    $("themeModeToggle").addEventListener("click", () => {
      appearance.mode = appearance.mode === "dark" ? "light" : "dark";
      localStorage.setItem("kopinova-theme-mode", appearance.mode);
      applyAppearance();
    });
    document.querySelectorAll(".accent-swatch").forEach((button) => {
      button.addEventListener("click", () => {
        appearance.accent = button.dataset.accent;
        localStorage.setItem("kopinova-theme-accent", appearance.accent);
        applyAppearance();
      });
    });
    $("customAccent").addEventListener("input", (event) => {
      appearance.accent = event.target.value;
      localStorage.setItem("kopinova-theme-accent", appearance.accent);
      applyAppearance();
    });
    applyAppearance();
  }
  const state = {
    connected: false,
    timer: null,
    history: [],
    weightKg: null,
    simulation: false,
    conveyor: false,
    /* Chart data buffers — store last 60 readings */
    chartData: { temp: [], hum: [], ldr: [] },
    chartMax: 60,
  };

  function msg(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  /* ─── Connection State ─── */
  function setConnection(connected, detail = "") {
    state.connected = connected;

    $("connectionDot").classList.toggle("online", connected);
    $("sidebarDot").classList.toggle("online", connected);
    msg("connectionLabel", connected ? "Terhubung" : "Offline");
    msg("sideConnection", connected ? "ESP32 terhubung" : "Belum terhubung");

    const badge = $("demoLabel");
    badge.textContent = !connected ? "Menunggu ESP32" : (state.simulation ? "SIMULASI" : "LIVE");
    badge.classList.toggle("live", connected && !state.simulation);
    badge.classList.toggle("simulation", connected && state.simulation);

    ["startBatch", "finishBatch", "conveyorToggle"].forEach(
      (id) => ($(id).disabled = !connected || (id === "conveyorToggle" && state.simulation))
    );

    if (detail) msg("connectMessage", detail);
  }

  /* ─── Sensor Display ─── */
  function showStatus(data) {
    state.simulation = Boolean(data.simulation);
    setConnection(true, "Data diterima dari ESP32.");

    // Temperature
    const tempVal = Number.isFinite(data.temperature) ? Number(data.temperature).toFixed(1) : "—";
    msg("temperature", tempVal);
    msg("temperatureNote", state.simulation ? "Nilai simulasi · bukan sensor nyata" : (data.temperatureValid === false ? "Pembacaan DHT belum tersedia" : "Pemantauan dari sensor DHT"));
    if (Number.isFinite(data.temperature)) {
      $("tempBar").style.width = Math.min(100, (data.temperature / 60) * 100) + "%";
    }

    // Humidity
    const humVal = Number.isFinite(data.humidity) ? Math.round(data.humidity) : "—";
    msg("humidity", humVal);
    msg("humidityNote", state.simulation ? "Nilai simulasi · bukan sensor nyata" : (data.humidityValid === false ? "Pembacaan DHT belum tersedia" : "Pemantauan dari sensor DHT"));
    if (Number.isFinite(data.humidity)) {
      $("humBar").style.width = data.humidity + "%";
    }

    // Light (LDR)
    const ldrVal = Number.isFinite(data.ldr) ? Math.round(data.ldr) : "—";
    msg("lightValue", ldrVal);
    msg("lightNote", state.simulation ? "Simulasi · " + (data.dark ? "gelap" : "terang") : (data.dark ? "Kondisi gelap terdeteksi" : "Kondisi terang terdeteksi"));
    $("lightNote").className = "metric-foot " + (data.dark ? "warning" : "");
    if (Number.isFinite(data.ldr)) {
      $("lightBar").style.width = Math.min(100, (data.ldr / 4095) * 100) + "%";
    }

    // Weight
    const calibrated = Boolean(data.scaleCalibrated);
    state.weightKg = calibrated && Number.isFinite(data.weightKg) ? Number(data.weightKg) : null;
    msg("weightValue", state.weightKg === null ? "—" : state.weightKg.toFixed(3));
    msg("weightNote", state.simulation ? "Berat simulasi · bukan load cell" : (calibrated ? "Load cell terkalibrasi" : "Load cell belum dikalibrasi"));
    if (state.weightKg !== null) {
      $("weightBar").style.width = Math.min(100, (state.weightKg / 5) * 100) + "%";
    }

    // Heater
    msg("heaterDetail", state.simulation ? "Simulasi · heater fisik nonaktif" : (data.heater ? "Otomatis · aktif" : "Otomatis · standby"));
    msg("heaterState", data.heater ? "Aktif" : "Standby");
    $("heaterState").className = "state-pill " + (data.heater ? "heating" : "");

    // Conveyor
    state.conveyor = Boolean(data.conveyor);
    $("conveyorToggle").setAttribute("aria-checked", String(state.conveyor));
    msg("conveyorDetail", state.simulation ? "Simulasi · konveyor fisik nonaktif" : (state.conveyor ? "Motor sedang berjalan" : "Kontrol manual tersedia"));

    // Color sensor
    msg("redValue", Number.isFinite(data.color?.r) ? Math.round(data.color.r) : "—");
    msg("greenValue", Number.isFinite(data.color?.g) ? Math.round(data.color.g) : "—");
    msg("blueValue", Number.isFinite(data.color?.b) ? Math.round(data.color.b) : "—");
    if (data.color?.hex) $("colorPreview").style.background = data.color.hex;
    msg("colorStatus", data.color?.status || "Data warna terbaca; kalibrasi diperlukan untuk estimasi kesiapan.");

    // Batch weights
    if (Number.isFinite(data.startWeightKg)) msg("startWeight", Number(data.startWeightKg).toFixed(3));
    if (Number.isFinite(data.endWeightKg)) msg("endWeight", Number(data.endWeightKg).toFixed(3));
    if (Number.isFinite(data.weightLossPct)) msg("weightLoss", Number(data.weightLossPct).toFixed(1) + "%");
    else msg("weightLoss", "—");

    // Timestamp
    const stamp = new Date();
    msg("lastUpdated", "Diperbarui " + stamp.toLocaleTimeString("id-ID"));

    // Chart data values display
    msg("chartTempValue", tempVal !== "—" ? tempVal + "°C" : "—");
    msg("chartHumValue", humVal !== "—" ? humVal + "%" : "—");
    msg("chartLdrValue", ldrVal !== "—" ? ldrVal : "—");

    // Push to chart buffers
    pushChartData(data);

    // History table
    addHistory(data, stamp);

    // Redraw charts
    drawAllCharts();
  }

  /* ─── Chart Data Buffer ─── */
  function pushChartData(data) {
    const now = new Date();
    const label = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    if (Number.isFinite(data.temperature)) {
      state.chartData.temp.push({ t: label, v: data.temperature });
      if (state.chartData.temp.length > state.chartMax) state.chartData.temp.shift();
    }
    if (Number.isFinite(data.humidity)) {
      state.chartData.hum.push({ t: label, v: data.humidity });
      if (state.chartData.hum.length > state.chartMax) state.chartData.hum.shift();
    }
    if (Number.isFinite(data.ldr)) {
      state.chartData.ldr.push({ t: label, v: data.ldr });
      if (state.chartData.ldr.length > state.chartMax) state.chartData.ldr.shift();
    }
  }

  /* ─── Canvas Chart Renderer ─── */
  function drawChart(canvasId, dataArray, color, unit, minY, maxY) {
    const canvas = $(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padTop = 12;
    const padBot = 24;
    const padLeft = 38;
    const padRight = 12;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBot;

    // Clear
    ctx.clearRect(0, 0, w, h);

    if (dataArray.length < 2) {
      ctx.fillStyle = "#5e7068";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Menunggu data sensor...", w / 2, h / 2);
      return;
    }

    // Auto-range with padding
    let dMin = minY, dMax = maxY;
    if (dMin === undefined || dMax === undefined) {
      const vals = dataArray.map((d) => d.v);
      dMin = Math.min(...vals);
      dMax = Math.max(...vals);
      const range = dMax - dMin || 1;
      dMin -= range * 0.1;
      dMax += range * 0.1;
    }

    const toX = (i) => padLeft + (i / (dataArray.length - 1)) * chartW;
    const toY = (v) => padTop + chartH - ((v - dMin) / (dMax - dMin)) * chartH;

    // Grid lines
    ctx.strokeStyle = "#1d2823";
    ctx.lineWidth = 1;
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = padTop + (i / gridSteps) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();

      // Y-axis labels
      const val = dMax - (i / gridSteps) * (dMax - dMin);
      ctx.fillStyle = "#5e7068";
      ctx.font = "9px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(val > 100 ? 0 : 1), padLeft - 6, y + 3);
    }

    // X-axis labels (show a few)
    ctx.fillStyle = "#5e7068";
    ctx.font = "8px Inter, sans-serif";
    ctx.textAlign = "center";
    const labelCount = Math.min(6, dataArray.length);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor((i / (labelCount - 1)) * (dataArray.length - 1));
      const x = toX(idx);
      ctx.fillText(dataArray[idx].t, x, h - 4);
    }

    // Gradient fill under the line
    const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    gradient.addColorStop(0, color + "30");
    gradient.addColorStop(1, color + "00");

    ctx.beginPath();
    ctx.moveTo(toX(0), padTop + chartH);
    for (let i = 0; i < dataArray.length; i++) {
      ctx.lineTo(toX(i), toY(dataArray[i].v));
    }
    ctx.lineTo(toX(dataArray.length - 1), padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Main line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(dataArray[0].v));
    for (let i = 1; i < dataArray.length; i++) {
      // Smooth curve using bezier
      const prevX = toX(i - 1);
      const prevY = toY(dataArray[i - 1].v);
      const currX = toX(i);
      const currY = toY(dataArray[i].v);
      const cpX = (prevX + currX) / 2;
      ctx.bezierCurveTo(cpX, prevY, cpX, currY, currX, currY);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Glow effect on line
    ctx.strokeStyle = color + "40";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Latest point dot
    const lastIdx = dataArray.length - 1;
    const lastX = toX(lastIdx);
    const lastY = toY(dataArray[lastIdx].v);

    // Outer glow
    ctx.beginPath();
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
    ctx.fillStyle = color + "25";
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  function drawAllCharts() {
    const styles = getComputedStyle(document.documentElement);
    drawChart("chartTemp", state.chartData.temp, styles.getPropertyValue("--chart-temp").trim() || "#e0655a", "°C", 15, 55);
    drawChart("chartHum", state.chartData.hum, styles.getPropertyValue("--chart-hum").trim() || "#5aade0", "%", 0, 100);
    drawChart("chartLdr", state.chartData.ldr, styles.getPropertyValue("--chart-ldr").trim() || "#d4a853", "ADC");
  }

  /* ─── History Table ─── */
  function addHistory(data, stamp) {
    state.history.unshift({
      time: stamp.toLocaleTimeString("id-ID"),
      temp: data.temperature,
      hum: data.humidity,
      ldr: data.ldr,
    });
    state.history = state.history.slice(0, 8);

    $("readingHistory").innerHTML = state.history
      .map(
        (row) =>
          `<div class="reading-row">
            <time>${row.time}</time>
            <b>${Number.isFinite(row.temp) ? Number(row.temp).toFixed(1) + "°" : "—"}</b>
            <b>${Number.isFinite(row.hum) ? Math.round(row.hum) + "%" : "—"}</b>
            <b>${Number.isFinite(row.ldr) ? Math.round(row.ldr) : "—"}</b>
          </div>`
      )
      .join("");
  }

  /* ─── API Communication ─── */
  async function connect() {
    const root = apiRoot();
    if (!root) {
      msg("connectMessage", "Masukkan alamat IP ESP32, contoh http://192.168.1.123");
      return;
    }
    localStorage.setItem("kopinova-esp32-url", root);
    msg("connectMessage", "Mencoba menghubungkan...");

    try {
      const res = await fetch(`${root}/api/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      showStatus(data);
      clearInterval(state.timer);
      state.timer = setInterval(poll, 2500);
    } catch (error) {
      setConnection(false, `Tidak dapat terhubung: ${error.message}. Periksa IP, Wi-Fi, dan CORS.`);
    }
  }

  async function poll() {
    try {
      const res = await fetch(`${apiRoot()}/api/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showStatus(await res.json());
    } catch (error) {
      setConnection(false, `Koneksi terputus: ${error.message}`);
      clearInterval(state.timer);
    }
  }

  async function sendAction(path, body) {
    try {
      const res = await fetch(`${apiRoot()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.message) msg("batchMessage", data.message);
      await poll();
    } catch (error) {
      msg("batchMessage", `Perintah gagal: ${error.message}`);
    }
  }

  /* ─── Chart Filter Controls ─── */
  function setupChartFilters() {
    const buttons = document.querySelectorAll(".chip-btn[data-chart]");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        // Toggle active
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const filter = btn.dataset.chart;
        const tempCard = $("chartTempCard");
        const humCard = $("chartHumCard");
        const ldrCard = $("chartLdrCard");

        if (filter === "all") {
          tempCard.classList.remove("hidden");
          humCard.classList.remove("hidden");
          ldrCard.classList.remove("hidden");
        } else if (filter === "temp") {
          tempCard.classList.remove("hidden");
          humCard.classList.add("hidden");
          ldrCard.classList.add("hidden");
        } else if (filter === "hum") {
          tempCard.classList.add("hidden");
          humCard.classList.remove("hidden");
          ldrCard.classList.add("hidden");
        } else if (filter === "ldr") {
          tempCard.classList.add("hidden");
          humCard.classList.add("hidden");
          ldrCard.classList.remove("hidden");
        }

        // Redraw visible charts
        setTimeout(drawAllCharts, 50);
      });
    });
  }

  /* ─── Sidebar Mobile ─── */
  function setupSidebar() {
    const sidebar = $("sidebar");
    const overlay = $("sidebarOverlay");
    const toggle = $("menuToggle");

    function openSidebar() {
      sidebar.classList.add("open");
      overlay.classList.add("visible");
    }
    function closeSidebar() {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
    }

    toggle.addEventListener("click", () => {
      sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
    });
    overlay.addEventListener("click", closeSidebar);

    document.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", () => {
        closeSidebar();
        // Update active state
        document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
      });
    });
  }

  /* ─── Bind Events ─── */
  function bind() {

    $("startBatch").addEventListener("click", () => sendAction("/api/batch/start", ""));
    $("finishBatch").addEventListener("click", () => sendAction("/api/batch/finish", ""));
    $("conveyorToggle").addEventListener("click", () =>
      sendAction("/api/conveyor", `on=${state.conveyor ? 0 : 1}`)
    );

    setupSidebar();
    setupAppearance();
    setupChartFilters();
  }

  /* ─── Window resize: redraw charts ─── */
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(drawAllCharts, 150);
  });

  /* ─── Init ─── */
  document.addEventListener("DOMContentLoaded", () => {
    bind();
    setConnection(false);
    drawAllCharts();
    const isLocalPreview = ["localhost", "127.0.0.1", ""].includes(location.hostname);
    if (!isLocalPreview && (location.protocol === "http:" || location.protocol === "https:")) connect();
  });
})();




