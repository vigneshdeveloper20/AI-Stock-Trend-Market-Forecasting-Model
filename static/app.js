/* =========================================================
   STOCK TREND AI — QUANTITATIVE ANALYTICS TERMINAL
   Koyfin / TradingView density, tabular metrics & multi-model evaluation
   ========================================================= */

let activeData = null;
let currentRange = "3M"; // Default to 3M so forecast occupies >20% of chart
let showSma20 = true;
let showSma50 = true;
let showLinReg = false;
let showBb = true;

// Chart Instances
let mainChart = null;
let forecastDeepChart = null;
let evalChart = null;
let distChart = null;
let drawdownChart = null;
let rsiChart = null;
let macdChart = null;

/* =========================================================
   Left-to-Right Progressive Line Sweep Plugin
   Renders smooth sweep from left to right on load / reload
   ========================================================= */

const leftToRightRevealPlugin = {
  id: 'leftToRightReveal',
  beforeInit(chart) {
    chart._revealProgress = 0;
    chart._revealStartTime = null;
    chart._isRevealing = true;
  },
  beforeDraw(chart) {
    if (!chart._isRevealing) return;
    if (!chart.chartArea) return;

    if (!chart._revealStartTime) {
      chart._revealStartTime = performance.now();
    }
    const elapsed = performance.now() - chart._revealStartTime;
    const duration = 1200; // 1.2 seconds smooth cinematic sweep
    const rawProgress = Math.min(1, elapsed / duration);
    
    // Ease-out cubic: 1 - (1 - t)^3
    const progress = 1 - Math.pow(1 - rawProgress, 3);
    chart._revealProgress = progress;

    const ctx = chart.ctx;
    const { left, top, width, height } = chart.chartArea;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width * progress, height);
    ctx.clip();
  },
  afterDraw(chart) {
    if (!chart._isRevealing) return;
    if (!chart.chartArea) return;

    const ctx = chart.ctx;
    const { left, top, width, height } = chart.chartArea;
    const currentX = left + (width * chart._revealProgress);

    if (chart._revealProgress < 1.0) {
      ctx.restore(); // Exit clip to draw leading sweep tracer
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(currentX, top);
      ctx.lineTo(currentX, top + height);
      ctx.strokeStyle = "rgba(74, 125, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.restore();

      requestAnimationFrame(() => {
        chart.draw();
      });
    } else {
      ctx.restore();
      chart._isRevealing = false;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadSampleDataset();
});

function setupEventListeners() {
  const fileInput = document.getElementById("csvFileInput");
  const btnUpload = document.getElementById("btnUploadCsv");
  const btnSample = document.getElementById("btnLoadSample");
  const btnExport = document.getElementById("btnExport");

  if (btnUpload && fileInput) {
    btnUpload.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
      }
    });
  }

  // Sample dataset buttons
  document.querySelectorAll(".btn-sample").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-sample").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const ticker = btn.getAttribute("data-ticker") || "AAPL";
      loadSampleDataset(ticker);
    });
  });

  if (btnExport) {
    btnExport.addEventListener("click", () => exportCsvData());
  }

  // Tabs
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.style.display = "none");

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.style.display = "block";

      // Trigger chart sweep & resize on tab reveal
      setTimeout(() => {
        if (targetId === "tab-overview" && mainChart) {
          mainChart._isRevealing = true;
          mainChart._revealStartTime = null;
          mainChart.resize();
          mainChart.draw();
        }
        if (targetId === "tab-forecasting" && forecastDeepChart) {
          forecastDeepChart._isRevealing = true;
          forecastDeepChart._revealStartTime = null;
          forecastDeepChart.resize();
          forecastDeepChart.draw();
        }
        if (targetId === "tab-validation" && evalChart) {
          evalChart._isRevealing = true;
          evalChart._revealStartTime = null;
          evalChart.resize();
          evalChart.draw();
        }
        if (targetId === "tab-distribution") {
          if (distChart) distChart.resize();
          if (drawdownChart) {
            drawdownChart._isRevealing = true;
            drawdownChart._revealStartTime = null;
            drawdownChart.resize();
            drawdownChart.draw();
          }
        }
        if (targetId === "tab-technicals") {
          if (rsiChart) {
            rsiChart._isRevealing = true;
            rsiChart._revealStartTime = null;
            rsiChart.resize();
            rsiChart.draw();
          }
          if (macdChart) {
            macdChart._isRevealing = true;
            macdChart._revealStartTime = null;
            macdChart.resize();
            macdChart.draw();
          }
        }
      }, 50);
    });
  });

  // Range Toggles
  document.querySelectorAll(".btn-range").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-range").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentRange = btn.getAttribute("data-range");
      renderMainChart();
    });
  });

  // Indicator Toggles
  const tSma20 = document.getElementById("toggleSma20");
  const tSma50 = document.getElementById("toggleSma50");
  const tLinReg = document.getElementById("toggleLinReg");
  const tBb = document.getElementById("toggleBb");

  if (tSma20) {
    tSma20.addEventListener("click", () => {
      showSma20 = !showSma20;
      tSma20.classList.toggle("active", showSma20);
      renderMainChart();
    });
  }
  if (tSma50) {
    tSma50.addEventListener("click", () => {
      showSma50 = !showSma50;
      tSma50.classList.toggle("active", showSma50);
      renderMainChart();
    });
  }
  if (tLinReg) {
    tLinReg.addEventListener("click", () => {
      showLinReg = !showLinReg;
      tLinReg.classList.toggle("active", showLinReg);
      renderMainChart();
    });
  }
  if (tBb) {
    tBb.addEventListener("click", () => {
      showBb = !showBb;
      tBb.classList.toggle("active", showBb);
      renderMainChart();
    });
  }
}

function showAlert(msg) {
  const box = document.getElementById("alertBox");
  if (box) {
    box.textContent = msg;
    box.style.display = "block";
  }
}

function clearAlert() {
  const box = document.getElementById("alertBox");
  if (box) box.style.display = "none";
}

async function loadSampleDataset(ticker = "AAPL") {
  clearAlert();
  try {
    const res = await fetch(`/api/sample?ticker=${encodeURIComponent(ticker)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Unable to load sample.");
    activeData = json.dataset;
    renderTerminal();
  } catch (err) {
    showAlert(err.message);
  }
}

async function uploadFile(file) {
  clearAlert();
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to process uploaded CSV.");
    document.querySelectorAll(".btn-sample").forEach(b => b.classList.remove("active"));
    activeData = json.dataset;
    renderTerminal();
  } catch (err) {
    showAlert(err.message);
  }
}

function formatPrice(val, includeCents = true) {
  if (val === null || val === undefined || isNaN(val)) return "$0.00";
  const num = Number(val);
  return "$" + num.toLocaleString("en-US", {
    minimumFractionDigits: includeCents ? 2 : 0,
    maximumFractionDigits: includeCents ? 2 : 0
  });
}

function formatNum(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return "0.00";
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function renderTerminal() {
  if (!activeData) return;

  const s = activeData.summary;
  const m = activeData.ml_results;
  const lr = activeData.linear_regression;
  const dist = activeData.distribution_analytics;
  const kl = activeData.key_levels;

  // Header Metas
  setText("hdrTicker", activeData.dataset_name);
  setText("hdrRange", `${s.date_range} (${s.total_records} bars)`);

  // Metric Strip
  setText("stripDate", s.last_date);
  setText("stripLastClose", formatPrice(s.last_close));
  
  const d1P = s.d1_forecast;
  setText("strip1DForecast", formatPrice(d1P.price));
  const d1El = document.getElementById("strip1DDelta");
  if (d1El) {
    d1El.className = `metric-val-sub mono ${d1P.pct >= 0 ? "val-pos" : "val-neg"}`;
    d1El.textContent = `${d1P.pct >= 0 ? "+" : ""}${d1P.pct.toFixed(2)}% Expected (1D)`;
  }

  const sigEl = document.getElementById("stripSignal");
  if (sigEl) {
    sigEl.className = `metric-val-hero val-${s.signal_tone}`;
    sigEl.textContent = s.composite_signal;
  }
  setText("stripScore", `Score: ${s.composite_score} / 100`);

  const rsiVal = activeData.series.rsi[activeData.series.rsi.length - 1];
  setText("stripRsi", rsiVal.toFixed(1));
  const rsiStateEl = document.getElementById("stripRsiState");
  if (rsiStateEl) {
    if (rsiVal > 70) {
      rsiStateEl.className = "metric-val-sub val-neg";
      rsiStateEl.textContent = "Caution (Overbought)";
    } else if (rsiVal < 30) {
      rsiStateEl.className = "metric-val-sub val-pos";
      rsiStateEl.textContent = "Oversold Rebound";
    } else {
      rsiStateEl.className = "metric-val-sub val-neu";
      rsiStateEl.textContent = "Neutral Channel";
    }
  }

  setText("stripLinSlope", `${lr.slope >= 0 ? "+" : ""}${formatNum(lr.slope, 3)} /d`);
  setText("stripVol", `Ann. Vol: ${s.risk_profile.annual_volatility}% | ATR: ${formatPrice(s.risk_profile.atr_14)}`);

  // TAB 1: OVERVIEW PANELS
  renderSignalTable(s.signals_table, s.composite_score);
  renderForecastHorizonTable(s.last_close, m.future_forecast);
  renderFibonacciTable(kl.fibonacci, s.last_close, kl.high_52w, kl.low_52w);
  renderPivotsTable(kl.pivots);
  setText("riskAtrVal", `${formatPrice(s.risk_profile.atr_14)} (${s.risk_profile.atr_pct}%)`);
  setText("riskUpperBuff", formatPrice(s.risk_profile.volatility_channel_upper));
  setText("riskLowerBuff", formatPrice(s.risk_profile.volatility_channel_lower));
  setText("risk52wPos", `${kl.position_52w_pct}%`);

  // TAB 2: FORECASTING & LINEAR REGRESSION
  setText("linRegR2Badge", `R2: ${lr.r2.toFixed(4)}`);
  setText("linSlopeVal", `${lr.slope >= 0 ? "+" : ""}${formatNum(lr.slope, 4)} / bar`);
  setText("linInterceptVal", formatPrice(lr.intercept));
  setText("linStdErrVal", `±${formatPrice(lr.std_err)}`);
  setText("linAnnualTrendVal", `${lr.annualized_trend_pct >= 0 ? "+" : ""}${lr.annualized_trend_pct.toFixed(2)}% / yr`);
  const trendDirEl = document.getElementById("linTrendDirVal");
  if (trendDirEl) {
    trendDirEl.className = `mono ${lr.slope >= 0 ? "val-pos" : "val-neg"}`;
    trendDirEl.textContent = lr.trend_direction;
  }
  renderMultiModelHorizonTable(s.last_close, m.future_forecast, lr.future_linear_30d);
  const mc = m.future_forecast.monte_carlo_60d;
  setText("mcP10Val", formatPrice(mc.p10));
  setText("mcP25Val", formatPrice(mc.p25));
  setText("mcP50Val", formatPrice(mc.p50));
  setText("mcP75Val", formatPrice(mc.p75));
  setText("mcP90Val", formatPrice(mc.p90));

  // TAB 3: MODEL VALIDATION & BACKTEST
  renderValidationTab(m);

  // TAB 4: DISTRIBUTION & RISK
  renderDistributionTab(dist);

  // TAB 5: TECHNICALS (RSI / MACD)
  setText("technicalsRsiVal", `RSI: ${rsiVal.toFixed(1)}`);

  // TAB 6: DATA TABLE
  renderDataTable(activeData.preview_rows);

  // Render Charts
  renderMainChart();
  renderForecastDeepChart();
  renderEvaluationChart();
  renderDistributionChart(dist.histogram);
  renderDrawdownChart(activeData.series.dates, activeData.series.drawdowns);
  renderTechnicalsCharts();
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

// ---------------------------------------------------------
// Tab Tables Renderers
// ---------------------------------------------------------

function renderSignalTable(signals, compositeScore) {
  const tbody = document.getElementById("signalTableBody");
  const badge = document.getElementById("signalMatrixBadge");
  if (badge) badge.textContent = `Composite: ${compositeScore}`;
  if (!tbody) return;

  let html = "";
  signals.forEach(item => {
    let stateClass = "val-neu";
    if (item.weight > 0) stateClass = "val-pos";
    if (item.weight < 0) stateClass = "val-neg";

    html += `
      <tr>
        <td style="font-weight: 500;">${item.name}</td>
        <td class="mono">${item.value}</td>
        <td class="${stateClass}">${item.state}</td>
        <td class="mono text-right ${stateClass}">${item.weight > 0 ? "+" : ""}${item.weight}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderForecastHorizonTable(lastClose, future) {
  const tbody = document.getElementById("forecastTableBody");
  if (!tbody) return;

  const horizons = [
    { label: "1D Forecast", price: future.d1_price, date: future.dates[0], ub: future.upper_bound[0], lb: future.lower_bound[0] },
    { label: "5D Forecast", price: future.d5_price, date: future.dates[Math.min(4, future.dates.length - 1)], ub: future.upper_bound[Math.min(4, future.dates.length - 1)], lb: future.lower_bound[Math.min(4, future.dates.length - 1)] },
    { label: "10D Forecast", price: future.d10_price, date: future.dates[Math.min(9, future.dates.length - 1)], ub: future.upper_bound[Math.min(9, future.dates.length - 1)], lb: future.lower_bound[Math.min(9, future.dates.length - 1)] },
    { label: "30D Forecast", price: future.d30_price, date: future.dates[future.dates.length - 1], ub: future.upper_bound[future.dates.length - 1], lb: future.lower_bound[future.dates.length - 1] }
  ];

  let html = "";
  horizons.forEach(h => {
    const deltaPct = ((h.price - lastClose) / lastClose) * 100;
    const tone = deltaPct >= 0 ? "val-pos" : "val-neg";
    html += `
      <tr>
        <td><strong>${h.label}</strong> <span class="mono text-tertiary" style="font-size:10px;">(${h.date})</span></td>
        <td class="mono">${formatPrice(h.price)}</td>
        <td class="mono ${tone}">${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%</td>
        <td class="mono text-right text-secondary">${formatPrice(h.lb)} - ${formatPrice(h.ub)}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderFibonacciTable(fib, lastClose, h52, l52) {
  const tbody = document.getElementById("fibTableBody");
  setText("fib52Range", `${formatPrice(l52)} - ${formatPrice(h52)}`);
  if (!tbody) return;

  const levels = [
    { ratio: "0.0% (52W High)", price: fib.level_0_high },
    { ratio: "23.6% Retracement", price: fib.level_236 },
    { ratio: "38.2% Retracement", price: fib.level_382 },
    { ratio: "50.0% Midpoint", price: fib.level_500 },
    { ratio: "61.8% Golden Ratio", price: fib.level_618 },
    { ratio: "78.6% Retracement", price: fib.level_786 },
    { ratio: "100.0% (52W Low)", price: fib.level_100_low }
  ];

  let html = "";
  levels.forEach(lv => {
    const dist = ((lastClose - lv.price) / lv.price) * 100;
    const tone = dist >= 0 ? "val-pos" : "val-neg";
    html += `
      <tr>
        <td>${lv.ratio}</td>
        <td class="mono">${formatPrice(lv.price)}</td>
        <td class="mono text-right ${tone}">${dist >= 0 ? "+" : ""}${dist.toFixed(2)}%</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderPivotsTable(p) {
  const tbody = document.getElementById("pivotsTableBody");
  if (!tbody) return;

  const rows = [
    { level: "R3 (Resistance 3)", price: p.r3, type: "Extreme Overbought Level" },
    { level: "R2 (Resistance 2)", price: p.r2, type: "Secondary Target" },
    { level: "R1 (Resistance 1)", price: p.r1, type: "Immediate Ceiling" },
    { level: "PP (Central Pivot)", price: p.pivot, type: "Baseline Mean Equilibrium" },
    { level: "S1 (Support 1)", price: p.s1, type: "Immediate Floor" },
    { level: "S2 (Support 2)", price: p.s2, type: "Secondary Cushion" },
    { level: "S3 (Support 3)", price: p.s3, type: "Extreme Oversold Level" }
  ];

  let html = "";
  rows.forEach(r => {
    html += `
      <tr>
        <td><strong>${r.level}</strong></td>
        <td class="mono">${formatPrice(r.price)}</td>
        <td class="text-right text-secondary">${r.type}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderMultiModelHorizonTable(lastClose, future, futureLin30) {
  const tbody = document.getElementById("multiModelHorizonTableBody");
  if (!tbody) return;

  const horizons = [
    { label: "1 Trading Day", rf: future.d1_price, lr: futureLin30[0] },
    { label: "5 Trading Days", rf: future.d5_price, lr: futureLin30[4] },
    { label: "10 Trading Days", rf: future.d10_price, lr: futureLin30[9] },
    { label: "30 Trading Days", rf: future.d30_price, lr: futureLin30[29] }
  ];

  let html = "";
  horizons.forEach(h => {
    const rfPct = ((h.rf - lastClose) / lastClose) * 100;
    const lrPct = ((h.lr - lastClose) / lastClose) * 100;
    const diff = h.rf - h.lr;
    html += `
      <tr>
        <td><strong>${h.label}</strong></td>
        <td class="mono">${formatPrice(h.rf)} <span class="${rfPct >= 0 ? "val-pos" : "val-neg"}" style="font-size:11px;">(${rfPct >= 0 ? "+" : ""}${rfPct.toFixed(2)}%)</span></td>
        <td class="mono">${formatPrice(h.lr)} <span class="${lrPct >= 0 ? "val-pos" : "val-neg"}" style="font-size:11px;">(${lrPct >= 0 ? "+" : ""}${lrPct.toFixed(2)}%)</span></td>
        <td class="mono text-right text-secondary">${diff >= 0 ? "+" : ""}${formatPrice(diff)}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderValidationTab(ml) {
  const evalInfo = ml.test_split_info;
  setText("evalTrainRange", `${evalInfo.train_start} to ${evalInfo.train_end} (${evalInfo.train_samples} samples)`);
  setText("evalTestRange", `${evalInfo.test_start} to ${evalInfo.test_end} (${evalInfo.test_samples} samples)`);

  const tbody = document.getElementById("evalMultiModelTableBody");
  if (!tbody) return;

  let html = "";
  ml.model_comparison_matrix.forEach(row => {
    const isBase = row.model_name.includes("Persistence");
    html += `
      <tr>
        <td><strong>${row.model_name}</strong></td>
        <td class="text-secondary">${row.type}</td>
        <td class="mono text-right">${formatPrice(row.mae)}</td>
        <td class="mono text-right">${formatPrice(row.rmse)}</td>
        <td class="mono text-right">${row.mape.toFixed(2)}%</td>
        <td class="mono text-right ${row.directional_acc >= 50 ? "val-pos" : "val-neg"}">${row.directional_acc.toFixed(1)}%</td>
        <td class="mono text-right">${row.r2.toFixed(3)}</td>
        <td class="mono text-right ${isBase ? "text-secondary" : (row.beats_baseline ? "val-pos" : "val-neg")}">
          ${isBase ? "Benchmark" : `${row.beats_baseline ? "-" : "+"}${formatPrice(Math.abs(row.delta_vs_baseline))}`}
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderDistributionTab(dist) {
  setText("distMeanRet", `${dist.mean_daily_return_pct >= 0 ? "+" : ""}${dist.mean_daily_return_pct.toFixed(3)}%`);
  setText("distMedianRet", `${dist.median_daily_return_pct >= 0 ? "+" : ""}${dist.median_daily_return_pct.toFixed(3)}%`);
  setText("distStdRet", `${dist.daily_std_pct.toFixed(3)}%`);
  setText("distAnnVol", `${dist.annualized_volatility_pct.toFixed(2)}%`);
  setText("distSkew", `${dist.skewness.toFixed(3)} (${dist.skewness >= 0 ? "Right-skewed" : "Left-skewed"})`);
  setText("distKurt", `${dist.excess_kurtosis.toFixed(3)} (${dist.excess_kurtosis > 0 ? "Leptokurtic / Fat Tails" : "Platykurtic"})`);
  setText("distWinRate", `${dist.win_rate_pct}% (${dist.pos_days_count} / ${dist.pos_days_count + dist.neg_days_count})`);

  setText("riskVar95", `-${dist.var_95_pct.toFixed(2)}% (1-day, 95% CI)`);
  setText("riskVar99", `-${dist.var_99_pct.toFixed(2)}% (1-day, 99% CI)`);
  setText("riskCvar95", `-${dist.cvar_95_pct.toFixed(2)}% (Expected Shortfall)`);
  setText("distMaxGain", `+${dist.max_gain_pct.toFixed(2)}%`);
  setText("distMaxLoss", `${dist.max_loss_pct.toFixed(2)}%`);
  setText("distMaxDd", `${dist.max_drawdown_pct.toFixed(2)}%`);
  setText("distMaxDdDate", dist.max_drawdown_date);
}

function renderDataTable(rows) {
  const tbody = document.getElementById("dataTableBody");
  if (!tbody) return;

  let html = "";
  rows.forEach(r => {
    html += `
      <tr>
        <td class="mono">${r.date}</td>
        <td class="mono text-right">${formatPrice(r.open)}</td>
        <td class="mono text-right">${formatPrice(r.high)}</td>
        <td class="mono text-right">${formatPrice(r.low)}</td>
        <td class="mono text-right font-weight-bold text-light">${formatPrice(r.close)}</td>
        <td class="mono text-right text-secondary">${Number(r.volume).toLocaleString()}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function exportCsvData() {
  if (!activeData) return;
  const s = activeData.series;
  let csv = "Date,Open,High,Low,Close,Volume,SMA20,SMA50,RSI,MACD\n";
  for (let i = 0; i < s.dates.length; i++) {
    csv += `${s.dates[i]},${s.open[i]},${s.high[i]},${s.low[i]},${s.close[i]},${s.volume[i]},${s.sma20[i] || ""},${s.sma50[i] || ""},${s.rsi[i] || ""},${s.macd[i] || ""}\n`;
  }
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${activeData.dataset_name}_processed_analytics.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------
// Chart.js Visualizations with Progressive Left-to-Right Animation
// ---------------------------------------------------------

function renderMainChart() {
  const canvas = document.getElementById("mainChartCanvas");
  if (!canvas || !activeData) return;

  const s = activeData.series;
  const future = activeData.ml_results.future_forecast;
  const lr = activeData.linear_regression;

  // Slicing
  let sliceCount = 65; // ~3 Months (default)
  if (currentRange === "6M") sliceCount = 130;
  if (currentRange === "1Y") sliceCount = 252;
  if (currentRange === "MAX") sliceCount = s.dates.length;

  const startIdx = Math.max(0, s.dates.length - sliceCount);

  const histDates = s.dates.slice(startIdx);
  const histCloses = s.close.slice(startIdx);
  const histSma20 = s.sma20.slice(startIdx);
  const histSma50 = s.sma50.slice(startIdx);
  const histLinFit = lr.linear_fit.slice(startIdx);
  const histBbU = s.bb_upper.slice(startIdx);
  const histBbL = s.bb_lower.slice(startIdx);
  const histVols = s.volume.slice(startIdx);

  const allDates = [...histDates, ...future.dates];

  const closeSeries = [...histCloses, ...future.dates.map(() => null)];
  const sma20Series = [...histSma20, ...future.dates.map(() => null)];
  const sma50Series = [...histSma50, ...future.dates.map(() => null)];
  const linSeries = [...histLinFit, ...future.dates.map(() => null)];
  const bbUSeries = [...histBbU, ...future.dates.map(() => null)];
  const bbLSeries = [...histBbL, ...future.dates.map(() => null)];
  const volSeries = [...histVols, ...future.dates.map(() => null)];

  const lastClose = histCloses[histCloses.length - 1];
  const forecastSeries = new Array(histDates.length - 1).fill(null);
  forecastSeries.push(lastClose);
  forecastSeries.push(...future.rf_prices);

  const upperSeries = new Array(histDates.length - 1).fill(null);
  upperSeries.push(lastClose);
  upperSeries.push(...future.upper_bound);

  const lowerSeries = new Array(histDates.length - 1).fill(null);
  lowerSeries.push(lastClose);
  lowerSeries.push(...future.lower_bound);

  const datasets = [
    {
      label: "Close Price",
      data: closeSeries,
      borderColor: "#9BA1A8",
      backgroundColor: "transparent",
      borderWidth: 1.8,
      pointRadius: 0,
      tension: 0.05,
      yAxisID: "y"
    },
    {
      label: "RF Forecast (10D)",
      data: forecastSeries,
      borderColor: "#4A7DFF",
      borderDash: [5, 4],
      backgroundColor: "transparent",
      borderWidth: 2.2,
      pointRadius: 2,
      pointBackgroundColor: "#4A7DFF",
      tension: 0.1,
      yAxisID: "y"
    },
    {
      label: "95% Upper Bound",
      data: upperSeries,
      borderColor: "rgba(74, 125, 255, 0.3)",
      backgroundColor: "rgba(74, 125, 255, 0.12)",
      borderDash: [2, 2],
      borderWidth: 1,
      pointRadius: 0,
      fill: "+1",
      yAxisID: "y"
    },
    {
      label: "95% Lower Bound",
      data: lowerSeries,
      borderColor: "rgba(74, 125, 255, 0.3)",
      backgroundColor: "transparent",
      borderDash: [2, 2],
      borderWidth: 1,
      pointRadius: 0,
      yAxisID: "y"
    },
    {
      type: "bar",
      label: "Volume",
      data: volSeries,
      backgroundColor: "rgba(155, 161, 168, 0.16)",
      borderWidth: 0,
      yAxisID: "yVolume",
      barPercentage: 0.8
    }
  ];

  if (showSma20) {
    datasets.push({
      label: "SMA 20",
      data: sma20Series,
      borderColor: "#C99A2E",
      borderWidth: 1.2,
      pointRadius: 0,
      fill: false,
      yAxisID: "y"
    });
  }

  if (showSma50) {
    datasets.push({
      label: "SMA 50",
      data: sma50Series,
      borderColor: "#7A6CC4",
      borderWidth: 1.2,
      pointRadius: 0,
      fill: false,
      yAxisID: "y"
    });
  }

  if (showLinReg) {
    datasets.push({
      label: "Linear Trend",
      data: linSeries,
      borderColor: "#2E9E6B",
      borderWidth: 1.4,
      pointRadius: 0,
      fill: false,
      yAxisID: "y"
    });
  }

  if (showBb) {
    datasets.push({
      label: "Bollinger Upper",
      data: bbUSeries,
      borderColor: "rgba(255, 255, 255, 0.12)",
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
      yAxisID: "y"
    });
    datasets.push({
      label: "Bollinger Lower",
      data: bbLSeries,
      borderColor: "rgba(255, 255, 255, 0.12)",
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
      yAxisID: "y"
    });
  }

  if (mainChart) mainChart.destroy();

  mainChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: allDates,
      datasets: datasets
    },
    plugins: [leftToRightRevealPlugin],
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#141619",
          titleColor: "#E6E8EA",
          bodyColor: "#9BA1A8",
          borderColor: "#23262B",
          borderWidth: 1,
          padding: 8,
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          titleFont: { family: "'Inter', sans-serif", size: 11 },
          callbacks: {
            label: (ctx) => {
              if (ctx.raw === null || ctx.raw === undefined) return null;
              if (ctx.dataset.label === "Volume") return `Volume: ${Number(ctx.raw).toLocaleString()}`;
              return `${ctx.dataset.label}: ${formatPrice(ctx.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#6B7178", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } }
        },
        y: {
          position: "right",
          grid: { color: "#1C1F24", drawBorder: false },
          ticks: {
            color: "#6B7178",
            callback: (v) => {
              if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
              if (Math.abs(v) >= 10000) return `$${(v / 1000).toFixed(0)}k`;
              if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
              return `$${v}`;
            },
            font: { family: "'JetBrains Mono', monospace", size: 10 }
          }
        },
        yVolume: {
          display: false,
          position: "left",
          min: 0,
          max: Math.max(...histVols) * 4.5
        }
      }
    }
  });
}

function renderForecastDeepChart() {
  const canvas = document.getElementById("forecastDeepChartCanvas");
  if (!canvas || !activeData) return;

  const s = activeData.series;
  const lr = activeData.linear_regression;
  const future = activeData.ml_results.future_forecast;

  const startIdx = Math.max(0, s.dates.length - 120);
  const histDates = s.dates.slice(startIdx);
  const histCloses = s.close.slice(startIdx);
  const histLin = lr.linear_fit.slice(startIdx);
  const histUpper1 = lr.channel_upper_1.slice(startIdx);
  const histLower1 = lr.channel_lower_1.slice(startIdx);

  const allDates = [...histDates, ...future.dates];

  const closeSeries = [...histCloses, ...future.dates.map(() => null)];
  const linSeries = [...histLin, ...lr.future_linear_30d];

  const lastClose = histCloses[histCloses.length - 1];
  const rfSeries = new Array(histDates.length - 1).fill(null);
  rfSeries.push(lastClose);
  rfSeries.push(...future.rf_prices);

  const lrFutureSeries = new Array(histDates.length - 1).fill(null);
  lrFutureSeries.push(lastClose);
  lrFutureSeries.push(...future.lr_prices);

  if (forecastDeepChart) forecastDeepChart.destroy();

  forecastDeepChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: allDates,
      datasets: [
        {
          label: "Historical Close",
          data: closeSeries,
          borderColor: "#9BA1A8",
          borderWidth: 1.6,
          pointRadius: 0,
          fill: false
        },
        {
          label: "OLS Linear Regression Line",
          data: linSeries,
          borderColor: "#2E9E6B",
          borderWidth: 1.6,
          pointRadius: 0,
          fill: false
        },
        {
          label: "Random Forest 30D Forecast",
          data: rfSeries,
          borderColor: "#4A7DFF",
          borderDash: [5, 4],
          borderWidth: 2,
          pointRadius: 1,
          fill: false
        },
        {
          label: "Linear Model Forward 30D",
          data: lrFutureSeries,
          borderColor: "#C99A2E",
          borderDash: [3, 3],
          borderWidth: 1.6,
          pointRadius: 1,
          fill: false
        }
      ]
    },
    plugins: [leftToRightRevealPlugin],
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { color: "#9BA1A8", font: { family: "'Inter', sans-serif", size: 11 }, boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: "#141619",
          borderColor: "#23262B",
          borderWidth: 1,
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          callbacks: {
            label: (ctx) => {
              if (ctx.raw === null || ctx.raw === undefined) return null;
              return `${ctx.dataset.label}: ${formatPrice(ctx.raw)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#6B7178", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
        y: {
          position: "right",
          grid: { color: "#1C1F24" },
          ticks: {
            color: "#6B7178",
            callback: (v) => {
              if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
              if (Math.abs(v) >= 10000) return `$${(v / 1000).toFixed(0)}k`;
              if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
              return `$${v}`;
            },
            font: { family: "'JetBrains Mono', monospace", size: 10 }
          }
        }
      }
    }
  });
}

function renderEvaluationChart() {
  const canvas = document.getElementById("evalChartCanvas");
  if (!canvas || !activeData) return;

  const ml = activeData.ml_results;

  if (evalChart) evalChart.destroy();

  evalChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: ml.test_dates,
      datasets: [
        {
          label: "Actual Realized Close",
          data: ml.test_actual,
          borderColor: "#E6E8EA",
          borderWidth: 1.8,
          pointRadius: 0,
          fill: false
        },
        {
          label: "Random Forest Regressor",
          data: ml.test_predicted_rf,
          borderColor: "#4A7DFF",
          borderDash: [4, 4],
          borderWidth: 1.6,
          pointRadius: 0,
          fill: false
        },
        {
          label: "Linear Regression Model",
          data: ml.test_predicted_lr,
          borderColor: "#2E9E6B",
          borderDash: [3, 3],
          borderWidth: 1.4,
          pointRadius: 0,
          fill: false
        },
        {
          label: "EMA Momentum Drift",
          data: ml.test_predicted_ema,
          borderColor: "#7A6CC4",
          borderDash: [2, 2],
          borderWidth: 1.2,
          pointRadius: 0,
          fill: false
        },
        {
          label: "Naive Persistence Baseline",
          data: ml.test_baseline,
          borderColor: "#C99A2E",
          borderDash: [1, 2],
          borderWidth: 1,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    plugins: [leftToRightRevealPlugin],
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { color: "#9BA1A8", font: { family: "'Inter', sans-serif", size: 11 }, boxWidth: 12 }
        },
        tooltip: {
          backgroundColor: "#141619",
          borderColor: "#23262B",
          borderWidth: 1,
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          callbacks: {
            label: (ctx) => {
              if (ctx.raw === null || ctx.raw === undefined) return null;
              return `${ctx.dataset.label}: ${formatPrice(ctx.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#6B7178", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } }
        },
        y: {
          position: "right",
          grid: { color: "#1C1F24" },
          ticks: {
            color: "#6B7178",
            callback: (v) => {
              if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
              if (Math.abs(v) >= 10000) return `$${(v / 1000).toFixed(0)}k`;
              if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
              return `$${v}`;
            },
            font: { family: "'JetBrains Mono', monospace", size: 10 }
          }
        }
      }
    }
  });
}

function renderDistributionChart(hist) {
  const canvas = document.getElementById("distChartCanvas");
  if (!canvas || !hist) return;

  if (distChart) distChart.destroy();

  const labels = hist.bin_centers_pct.map(v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

  distChart = new Chart(canvas, {
    data: {
      labels: labels,
      datasets: [
        {
          type: "bar",
          label: "Empirical Frequencies",
          data: hist.frequencies,
          backgroundColor: "rgba(74, 125, 255, 0.4)",
          borderColor: "#4A7DFF",
          borderWidth: 1,
          barPercentage: 0.95
        },
        {
          type: "line",
          label: "Theoretical Normal Fit",
          data: hist.normal_fitted,
          borderColor: "#C99A2E",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { color: "#9BA1A8", font: { family: "'Inter', sans-serif", size: 11 }, boxWidth: 12 }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#6B7178", maxTicksLimit: 10, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
        y: { position: "right", grid: { color: "#1C1F24" }, ticks: { color: "#6B7178", font: { family: "'JetBrains Mono', monospace", size: 10 } } }
      }
    }
  });
}

function renderDrawdownChart(dates, drawdowns) {
  const canvas = document.getElementById("drawdownChartCanvas");
  if (!canvas || !drawdowns) return;

  if (drawdownChart) drawdownChart.destroy();

  drawdownChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: "Drawdown % from All-Time High",
          data: drawdowns,
          borderColor: "#D64545",
          backgroundColor: "rgba(214, 69, 69, 0.15)",
          borderWidth: 1.4,
          pointRadius: 0,
          fill: true,
          tension: 0.05
        }
      ]
    },
    plugins: [leftToRightRevealPlugin],
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Drawdown: ${Number(ctx.raw).toFixed(2)}%`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#6B7178", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
        y: {
          max: 0,
          position: "right",
          grid: { color: "#1C1F24" },
          ticks: { color: "#6B7178", callback: (v) => `${v}%`, font: { family: "'JetBrains Mono', monospace", size: 10 } }
        }
      }
    }
  });
}

function renderTechnicalsCharts() {
  const rsiCanvas = document.getElementById("rsiChartCanvas");
  const macdCanvas = document.getElementById("macdChartCanvas");
  if (!rsiCanvas || !macdCanvas || !activeData) return;

  const s = activeData.series;

  // RSI Chart
  if (rsiChart) rsiChart.destroy();
  rsiChart = new Chart(rsiCanvas, {
    type: "line",
    data: {
      labels: s.dates,
      datasets: [
        {
          label: "14D RSI",
          data: s.rsi,
          borderColor: "#7A6CC4",
          borderWidth: 1.6,
          pointRadius: 0,
          fill: false
        },
        {
          label: "Overbought (70)",
          data: s.dates.map(() => 70),
          borderColor: "rgba(214, 69, 69, 0.4)",
          borderDash: [3, 3],
          borderWidth: 1,
          pointRadius: 0,
          fill: false
        },
        {
          label: "Oversold (30)",
          data: s.dates.map(() => 30),
          borderColor: "rgba(46, 158, 107, 0.4)",
          borderDash: [3, 3],
          borderWidth: 1,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    plugins: [leftToRightRevealPlugin],
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#6B7178", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
        y: { min: 0, max: 100, position: "right", grid: { color: "#1C1F24" }, ticks: { color: "#6B7178", stepSize: 20, font: { family: "'JetBrains Mono', monospace", size: 10 } } }
      }
    }
  });

  // MACD Chart
  if (macdChart) macdChart.destroy();
  macdChart = new Chart(macdCanvas, {
    data: {
      labels: s.dates,
      datasets: [
        {
          type: "bar",
          label: "Histogram",
          data: s.macd_hist,
          backgroundColor: s.macd_hist.map(v => v >= 0 ? "rgba(46, 158, 107, 0.6)" : "rgba(214, 69, 69, 0.6)"),
          borderWidth: 0
        },
        {
          type: "line",
          label: "MACD Line",
          data: s.macd,
          borderColor: "#4A7DFF",
          borderWidth: 1.4,
          pointRadius: 0
        },
        {
          type: "line",
          label: "Signal Line",
          data: s.macd_signal,
          borderColor: "#C99A2E",
          borderWidth: 1.4,
          pointRadius: 0
        }
      ]
    },
    plugins: [leftToRightRevealPlugin],
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#6B7178", maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
        y: { position: "right", grid: { color: "#1C1F24" }, ticks: { color: "#6B7178", font: { family: "'JetBrains Mono', monospace", size: 10 } } }
      }
    }
  });
}


