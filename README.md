# Stock Trend AI — Quantitative Market Forecasting & Analytics Terminal

A quantitative market intelligence terminal and machine learning forecasting application built for deep time-series financial analysis. Upload any stock or asset CSV dataset to compute multi-model walk-forward backtests, stationary log-return forecasting, OLS linear regression channels, empirical return distributions with Gaussian Normal curve fitting, Value-at-Risk (VaR/CVaR), Fibonacci retracements, and classic floor trader pivots.

---

## Features

- **Data Ingestion Engine**:
  - Auto-detection and normalization for `Date`, `Close`, `Open`, `High`, `Low`, and `Volume` columns.
  - Sanitizes currency symbols (`₩`, `$`, `¥`, `€`, `,`), strips non-price Yahoo Finance dividend rows, deduplicates timestamps, and enforces chronological sorting.
  - Includes quick-load sample datasets (`AAPL.csv`, `MSFT_sample.csv`, `TSLA_sample.csv`).

- **Multi-Model Machine Learning & Backtesting Benchmark**:
  - **Stationary Target Variable**: Trains on stationary daily percentage returns $\Delta \ln(P_t)$ rather than raw non-stationary prices, eliminating random walk lag artifacts.
  - **Walk-Forward Validation**: Strict temporal train/test split preserving sequence causality with zero future lookahead bias.
  - **Multi-Model Benchmark Matrix**: Evaluates **Random Forest Regressor**, **OLS Linear Regression**, **EMA Momentum Drift**, and **Naive Persistence Baseline** across standard statistical metrics:
    - Mean Absolute Error (MAE)
    - Root Mean Squared Error (RMSE)
    - Mean Absolute Percentage Error (MAPE)
    - Directional Sign Accuracy (%)
    - Out-of-Sample $R^2$ Score
    - Net Outperformance vs. Random-Walk Benchmark

- **OLS Time-Series Linear Regression & Confidence Channels**:
  - Computes exact Ordinary Least Squares regression parameters ($R^2$, Slope $\beta$, Intercept $\alpha$, Standard Error $\sigma_{\epsilon}$, Annualized Drift %).
  - Generates empirical 1-standard-deviation and 2-standard-deviation parallel volatility channels.
  - Computes 30-day linear projection with upper/lower boundary bounds.

- **Return Distribution & Quantitative Risk Engine**:
  - Calculates daily mean return, median, daily standard deviation, and annualized volatility ($\sigma \times \sqrt{252}$).
  - Higher-moment statistical modeling: **Skewness** (asymmetry) and **Excess Kurtosis** (leptokurtic fat tails).
  - Parametric & Historical Risk Metrics:
    - Value at Risk 95% ($VaR_{0.95}$) and 99% ($VaR_{0.99}$)
    - Expected Shortfall / Conditional VaR ($CVaR_{0.95}$)
    - Historical Maximum Drawdown time-series & peak-to-trough dates
  - 60-Day Monte Carlo simulation cone ($P_{10}$, $P_{25}$, $P_{50}$, $P_{75}$, $P_{90}$).

- **Technical Analysis & Support/Resistance Levels**:
  - **Fibonacci Retracement Suite**: 0.0% (52W High), 23.6%, 38.2%, 50.0% Midpoint, 61.8% Golden Ratio, 78.6%, and 100.0% (52W Low).
  - **Classic Floor Trader Pivots**: Central Pivot Point (PP), Resistance levels (R1, R2, R3), and Support cushions (S1, S2, S3).
  - **Oscillators**: 14-Period RSI with Overbought (70) / Oversold (30) channels, MACD line, 9-period Signal line, and differential histogram.
  - **Bollinger Bands & Moving Averages**: 20-day SMA, 50-day SMA, and 2-standard-deviation envelope.

- **High-Density Terminal UI & Smooth Progressive Animation**:
  - Koyfin/TradingView-inspired dark theme (`#0D0F12`, `tabular-nums` monospace numerical data).
  - 6 dedicated analytical tabs: Overview, Forecasting & Linear Reg, Model Validation & Backtest, Distribution & Risk, Technical Oscillators, and Historical Data Table.
  - Custom Chart.js `leftToRightRevealPlugin` providing a progressive 60/120fps ease-out cubic sweep on initial load, page refresh, dataset upload, and tab navigation.
  - 1-Click CSV export of computed analytical series.

---

## Getting Started

### 1. Requirements & Dependencies
Ensure Python 3.9+ is installed, then install package dependencies:
```bash
pip install -r requirements.txt
```

### 2. Launch the Application
```bash
python3 app.py
```
*Or use the shell launcher:*
```bash
./run.sh
```

### 3. Open the Terminal
Navigate in your browser to:
```
http://127.0.0.1:5005
```
*(Or `http://127.0.0.1:5000` depending on your environment).*

---

## Directory Structure

```
Stock_Trend_AI-Stock-Market-Forecasting-Model/
├── app.py                # Flask server, data sanitation, ML backtesting, regression & risk calculations
├── templates/
│   └── index.html        # 6-tab quantitative terminal HTML layout
├── static/
│   ├── style.css         # Dark theme styling, metrics strip & monospace financial tables
│   └── app.js            # Client-side Chart.js controller with progressive sweep animation
├── AAPL.csv              # Apple Inc. historical stock dataset
├── MSFT_sample.csv       # Microsoft Corp. sample dataset
├── TSLA_sample.csv       # Tesla Inc. sample dataset
├── requirements.txt      # Python dependencies (Flask, pandas, numpy, scikit-learn, scipy)
├── run.sh                # Executable startup script
└── README.md             # Project documentation
```

---

## Tech Stack
- **Backend**: Python 3, Flask, NumPy, Pandas, Scikit-Learn, SciPy
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 (Custom Design System, Flexbox/Grid)
- **Charting Engine**: Chart.js v4 with custom canvas clipping animation plugins
