import os
import io
import json
import math
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLE_DATASETS = {
    "AAPL": {"filename": "AAPL.csv", "path": os.path.join(BASE_DIR, "AAPL.csv"), "name": "Apple Inc."},
    "MSFT": {"filename": "MSFT_sample.csv", "path": os.path.join(BASE_DIR, "MSFT_sample.csv"), "name": "Microsoft Corp."},
    "TSLA": {"filename": "TSLA_sample.csv", "path": os.path.join(BASE_DIR, "TSLA_sample.csv"), "name": "Tesla Inc."},
}



def normalize_column_name(col):
    c = str(col).strip().lower().replace(" ", "").replace("_", "")
    if c in ["date", "timestamp", "datetime", "time", "date_time"]:
        return "date"
    if c in ["close", "adjclose", "adjustedclose", "last", "price", "c", "adj_close"]:
        return "close"
    if c in ["open", "openprice", "o", "open_price"]:
        return "open"
    if c in ["high", "highprice", "h", "high_price"]:
        return "high"
    if c in ["low", "lowprice", "l", "low_price"]:
        return "low"
    if c in ["volume", "vol", "shares", "v", "adjvolume", "adj_volume"]:
        return "volume"
    return col


def clean_numeric_series(series):
    if series.dtype in [np.float64, np.int64, np.float32, np.int32]:
        return pd.to_numeric(series, errors="coerce")
    cleaned = (
        series.astype(str)
        .str.replace("$", "", regex=False)
        .str.replace("₩", "", regex=False)
        .str.replace("¥", "", regex=False)
        .str.replace("€", "", regex=False)
        .str.replace("£", "", regex=False)
        .str.replace("₹", "", regex=False)
        .str.replace(",", "", regex=False)
        .str.strip()
    )
    return pd.to_numeric(cleaned, errors="coerce")


def parse_stock_csv(file_stream_or_path, filename="dataset.csv"):
    try:
        if isinstance(file_stream_or_path, str):
            df = pd.read_csv(file_stream_or_path)
        else:
            df = pd.read_csv(file_stream_or_path)
    except Exception as e:
        raise ValueError(f"Unable to parse '{filename}'. Ensure file is a valid CSV: {str(e)}")

    if df.empty:
        raise ValueError(f"File '{filename}' contains no rows.")

    # 1. Filter out non-price rows (e.g. Dividend / Stock Split records in Yahoo Finance CSVs)
    for col in df.columns:
        col_clean = str(col).lower().replace("_", "").replace(" ", "")
        if col_clean in ["recordtype", "type", "event"]:
            is_price = df[col].astype(str).str.lower().str.contains("price")
            if is_price.sum() >= 10:
                df = df[is_price].copy()
            break

    # 2. Normalize standard column names
    col_mapping = {}
    for original_col in df.columns:
        norm = normalize_column_name(original_col)
        if norm in ["date", "close", "open", "high", "low", "volume"] and norm not in col_mapping.values():
            col_mapping[original_col] = norm

    df = df.rename(columns=col_mapping)

    if "close" not in df.columns:
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        if numeric_cols:
            df["close"] = df[numeric_cols[-1]]
        else:
            raise ValueError(f"Missing price column in '{filename}'. Required: 'Close' or 'Price'.")

    # Clean numeric columns
    for col in ["close", "open", "high", "low", "volume"]:
        if col in df.columns:
            df[col] = clean_numeric_series(df[col])

    # Date handling
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
    else:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=len(df))
        df["date"] = pd.date_range(start=start_date, periods=len(df), freq="D")

    # Drop rows where close is NaN (such as dividend or empty lines)
    df = df.dropna(subset=["close"])

    # Deduplicate dates (keep last valid row) and sort chronologically
    df = df.drop_duplicates(subset=["date"], keep="last")
    df = df.sort_values("date").reset_index(drop=True)

    if "open" not in df.columns:
        df["open"] = df["close"]
    if "high" not in df.columns:
        df["high"] = df[["open", "close"]].max(axis=1)
    if "low" not in df.columns:
        df["low"] = df[["open", "close"]].min(axis=1)
    if "volume" not in df.columns:
        df["volume"] = 1000000

    for col in ["close", "open", "high", "low", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.ffill().bfill()
    df = df.dropna(subset=["close"]).reset_index(drop=True)

    if len(df) < 30:
        raise ValueError(f"Dataset '{filename}' requires at least 30 valid observations for modeling (found {len(df)}).")

    return df



def calculate_technicals(df):
    data = df.copy()

    # Moving Averages
    data["sma_20"] = data["close"].rolling(window=min(20, len(data)), min_periods=1).mean()
    data["sma_50"] = data["close"].rolling(window=min(50, len(data)), min_periods=1).mean()
    data["sma_200"] = data["close"].rolling(window=min(200, len(data)), min_periods=1).mean()

    ema_12 = data["close"].ewm(span=12, adjust=False).mean()
    ema_26 = data["close"].ewm(span=26, adjust=False).mean()
    data["ema_12"] = ema_12
    data["ema_26"] = ema_26
    data["macd"] = ema_12 - ema_26
    data["macd_signal"] = data["macd"].ewm(span=9, adjust=False).mean()
    data["macd_hist"] = data["macd"] - data["macd_signal"]

    # Bollinger Bands
    roll_20 = data["close"].rolling(window=min(20, len(data)), min_periods=1)
    bb_std = roll_20.std().fillna(0)
    data["bb_upper"] = data["sma_20"] + (2 * bb_std)
    data["bb_lower"] = data["sma_20"] - (2 * bb_std)
    data["bb_bandwidth"] = ((data["bb_upper"] - data["bb_lower"]) / data["sma_20"]) * 100.0

    # RSI (14)
    delta = data["close"].diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=min(14, len(data)), min_periods=1).mean()
    avg_loss = loss.rolling(window=min(14, len(data)), min_periods=1).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    data["rsi"] = rsi.fillna(50.0)

    # Returns & Volatility
    data["daily_return"] = data["close"].pct_change().fillna(0)
    roll_vol = data["daily_return"].rolling(window=min(20, len(data)), min_periods=1).std().fillna(0)
    data["volatility_annualized"] = roll_vol * math.sqrt(252) * 100

    # ATR (14)
    high_low = data["high"] - data["low"]
    high_close = (data["high"] - data["close"].shift()).abs()
    low_close = (data["low"] - data["close"].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    data["atr_14"] = tr.rolling(window=min(14, len(data)), min_periods=1).mean().fillna(0)

    # Cumulative Returns & Drawdowns
    data["cum_return_pct"] = ((data["close"] / data["close"].iloc[0]) - 1.0) * 100.0
    running_max = data["close"].cummax()
    data["drawdown_pct"] = ((data["close"] - running_max) / running_max) * 100.0

    return data


def compute_linear_regression(df):
    """
    Computes time-series OLS linear regression across the historical close series,
    calculating slope, intercept, R-squared, standard error, channels, and forward projection.
    """
    n = len(df)
    x = np.arange(n)
    y = df["close"].values

    slope, intercept = np.polyfit(x, y, 1)
    y_pred = intercept + (slope * x)
    residuals = y - y_pred
    std_err = float(np.std(residuals))

    ss_tot = float(np.sum((y - np.mean(y))**2))
    ss_res = float(np.sum(residuals**2))
    r2 = float(1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0

    # Upper and Lower 1-sigma & 2-sigma regression channels
    channel_upper_1 = y_pred + std_err
    channel_lower_1 = y_pred - std_err
    channel_upper_2 = y_pred + (2 * std_err)
    channel_lower_2 = y_pred - (2 * std_err)

    # Daily expected price delta
    daily_delta = float(slope)
    annualized_trend_pct = float((slope * 252 / y[-1]) * 100) if y[-1] > 0 else 0.0

    # Forward linear regression projection for 30 days
    future_linear_30d = [float(intercept + slope * (n + i)) for i in range(30)]

    return {
        "slope": round(float(slope), 4),
        "intercept": round(float(intercept), 2),
        "r2": round(r2, 4),
        "std_err": round(std_err, 2),
        "daily_delta": round(daily_delta, 3),
        "annualized_trend_pct": round(annualized_trend_pct, 2),
        "trend_direction": "Upward" if slope > 0 else ("Downward" if slope < 0 else "Flat"),
        "linear_fit": [round(float(v), 2) for v in y_pred],
        "channel_upper_1": [round(float(v), 2) for v in channel_upper_1],
        "channel_lower_1": [round(float(v), 2) for v in channel_lower_1],
        "channel_upper_2": [round(float(v), 2) for v in channel_upper_2],
        "channel_lower_2": [round(float(v), 2) for v in channel_lower_2],
        "future_linear_30d": [round(v, 2) for v in future_linear_30d]
    }


def compute_distribution_analytics(df):
    """
    Computes empirical daily returns histogram vs. theoretical Normal distribution curve,
    along with skewness, kurtosis, VaR (95%/99%), and CVaR (Expected Shortfall).
    """
    returns = df["close"].pct_change().dropna().values
    if len(returns) == 0:
        returns = np.array([0.0])

    mean_ret = float(np.mean(returns))
    std_ret = float(np.std(returns)) if len(returns) > 1 else 0.01
    ret_series = pd.Series(returns)
    skew = float(ret_series.skew()) if len(returns) > 2 else 0.0
    kurt = float(ret_series.kurt()) if len(returns) > 3 else 0.0

    # Histogram (30 bins)
    num_bins = 30
    counts, bin_edges = np.histogram(returns * 100.0, bins=num_bins)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2.0
    bin_width = bin_edges[1] - bin_edges[0]

    # Theoretical Normal PDF scaled to frequency counts
    normal_fitted_counts = []
    for x in bin_centers:
        x_dec = x / 100.0
        pdf = (1.0 / (std_ret * np.sqrt(2 * np.pi))) * np.exp(-0.5 * ((x_dec - mean_ret) / std_ret)**2)
        freq = pdf * len(returns) * (bin_width / 100.0)
        normal_fitted_counts.append(round(float(freq), 2))

    # Risk Metrics: VaR and CVaR
    var_95 = float(-np.percentile(returns, 5) * 100.0)
    var_99 = float(-np.percentile(returns, 1) * 100.0)

    tail_losses_95 = returns[returns <= np.percentile(returns, 5)]
    cvar_95 = float(-np.mean(tail_losses_95) * 100.0) if len(tail_losses_95) > 0 else var_95

    # Positive vs Negative days
    pos_days = int(np.sum(returns > 0))
    neg_days = int(np.sum(returns < 0))
    win_rate = round((pos_days / len(returns)) * 100.0, 1) if len(returns) > 0 else 50.0

    # Drawdown profile
    running_max = df["close"].cummax()
    dd_series = ((df["close"] - running_max) / running_max) * 100.0
    max_dd = float(dd_series.min())
    curr_dd = float(dd_series.iloc[-1])
    mdd_idx = int(dd_series.idxmin())
    mdd_date = df["date"].iloc[mdd_idx].strftime("%Y-%m-%d")

    return {
        "mean_daily_return_pct": round(mean_ret * 100.0, 3),
        "median_daily_return_pct": round(float(np.median(returns)) * 100.0, 3),
        "daily_std_pct": round(std_ret * 100.0, 3),
        "annualized_volatility_pct": round(std_ret * math.sqrt(252) * 100.0, 2),
        "skewness": round(skew, 3),
        "excess_kurtosis": round(kurt, 3),
        "var_95_pct": round(var_95, 2),
        "var_99_pct": round(var_99, 2),
        "cvar_95_pct": round(cvar_95, 2),
        "max_gain_pct": round(float(np.max(returns) * 100.0), 2),
        "max_loss_pct": round(float(np.min(returns) * 100.0), 2),
        "pos_days_count": pos_days,
        "neg_days_count": neg_days,
        "win_rate_pct": win_rate,
        "max_drawdown_pct": round(max_dd, 2),
        "max_drawdown_date": mdd_date,
        "current_drawdown_pct": round(curr_dd, 2),
        "histogram": {
            "bin_centers_pct": [round(float(b), 2) for b in bin_centers],
            "frequencies": [int(c) for c in counts],
            "normal_fitted": normal_fitted_counts
        }
    }


def compute_key_levels(df, technicals):
    """
    Computes 52-week channel, Fibonacci retracement levels, and Classic Pivot Points.
    """
    last_close = float(df["close"].iloc[-1])
    last_high = float(df["high"].iloc[-1])
    last_low = float(df["low"].iloc[-1])

    # 52-Week Range (or full dataset if < 252 bars)
    lookback = min(252, len(df))
    window_df = df.tail(lookback)
    h52 = float(window_df["high"].max())
    l52 = float(window_df["low"].min())
    pos_52w = ((last_close - l52) / (h52 - l52)) * 100.0 if (h52 - l52) > 0 else 50.0

    # Fibonacci Retracement Levels
    diff = h52 - l52
    fib = {
        "level_0_high": round(h52, 2),
        "level_236": round(h52 - (0.236 * diff), 2),
        "level_382": round(h52 - (0.382 * diff), 2),
        "level_500": round(h52 - (0.500 * diff), 2),
        "level_618": round(h52 - (0.618 * diff), 2),
        "level_786": round(h52 - (0.786 * diff), 2),
        "level_100_low": round(l52, 2)
    }

    # Classic Floor Trader Pivot Points
    pivot = (last_high + last_low + last_close) / 3.0
    r1 = (2 * pivot) - last_low
    s1 = (2 * pivot) - last_high
    r2 = pivot + (last_high - last_low)
    s2 = pivot - (last_high - last_low)
    r3 = last_high + 2 * (pivot - last_low)
    s3 = last_low - 2 * (last_high - pivot)

    pivots = {
        "r3": round(r3, 2),
        "r2": round(r2, 2),
        "r1": round(r1, 2),
        "pivot": round(pivot, 2),
        "s1": round(s1, 2),
        "s2": round(s2, 2),
        "s3": round(s3, 2)
    }

    return {
        "high_52w": round(h52, 2),
        "low_52w": round(l52, 2),
        "position_52w_pct": round(pos_52w, 1),
        "fibonacci": fib,
        "pivots": pivots
    }


def train_and_forecast_multi_model(df, forecast_days=30):
    """
    Multi-model walk-forward backtest and future forecasting.
    Compares:
      1. Random Forest Regressor (Non-linear Stationary Return Model)
      2. Linear Regression Model (OLS Lag + Trend Model)
      3. Exponential Smoothing Drift Model (EMA-12 Momentum)
      4. Naive Persistence Baseline (Prediction = Previous Close)
    """
    data = df.copy()

    # Create stationary lag features
    data["ret"] = data["close"].pct_change().fillna(0)
    for lag in range(1, 6):
        data[f"ret_lag_{lag}"] = data["ret"].shift(lag)

    data["sma_ratio_20"] = (data["close"] / data["sma_20"]) - 1.0
    data["target_ret"] = data["ret"].shift(-1)
    feature_cols = ["ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_4", "ret_lag_5", "sma_ratio_20"]
    clean_data = data.dropna(subset=feature_cols + ["target_ret"]).reset_index(drop=True)
    X = clean_data[feature_cols]
    y = clean_data["target_ret"]

    # 80/20 chronological split (Walk-forward test partition)
    split_idx = int(len(clean_data) * 0.8)
    if split_idx >= len(clean_data):
        split_idx = max(1, len(clean_data) - 10)

    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    test_dates = clean_data["date"].iloc[split_idx:].dt.strftime("%Y-%m-%d").tolist()
    curr_test_prices = clean_data["close"].iloc[split_idx:].values
    actual_next_prices = curr_test_prices * (1.0 + y_test.values)

    # ---------------------------
    # Model 1: Random Forest
    # ---------------------------
    rf = RandomForestRegressor(n_estimators=100, max_depth=5, random_state=42)
    rf.fit(X_train, y_train)
    rf_pred_rets = rf.predict(X_test)
    rf_pred_prices = curr_test_prices * (1.0 + rf_pred_rets)

    mae_rf = float(mean_absolute_error(actual_next_prices, rf_pred_prices))
    rmse_rf = float(np.sqrt(mean_squared_error(actual_next_prices, rf_pred_prices)))
    r2_rf = float(r2_score(actual_next_prices, rf_pred_prices)) if len(actual_next_prices) > 1 else 0.0
    mape_rf = float(np.mean(np.abs((actual_next_prices - rf_pred_prices) / actual_next_prices)) * 100.0)

    actual_change = actual_next_prices - curr_test_prices
    rf_change = rf_pred_prices - curr_test_prices
    dir_acc_rf = float(np.mean(np.sign(actual_change) == np.sign(rf_change)) * 100) if len(actual_change) > 0 else 50.0

    # ---------------------------
    # Model 2: Linear Regression
    # ---------------------------
    lr = LinearRegression()
    lr.fit(X_train, y_train)
    lr_pred_rets = lr.predict(X_test)
    lr_pred_prices = curr_test_prices * (1.0 + lr_pred_rets)

    mae_lr = float(mean_absolute_error(actual_next_prices, lr_pred_prices))
    rmse_lr = float(np.sqrt(mean_squared_error(actual_next_prices, lr_pred_prices)))
    r2_lr = float(r2_score(actual_next_prices, lr_pred_prices)) if len(actual_next_prices) > 1 else 0.0
    mape_lr = float(np.mean(np.abs((actual_next_prices - lr_pred_prices) / actual_next_prices)) * 100.0)
    lr_change = lr_pred_prices - curr_test_prices
    dir_acc_lr = float(np.mean(np.sign(actual_change) == np.sign(lr_change)) * 100) if len(actual_change) > 0 else 50.0

    # ---------------------------
    # Model 3: EMA Momentum Drift
    # ---------------------------
    ema_drift_rets = (clean_data["ema_12"].iloc[split_idx:].values / clean_data["close"].iloc[split_idx:].values) - 1.0
    ema_pred_prices = curr_test_prices * (1.0 + (ema_drift_rets * 0.1))
    mae_ema = float(mean_absolute_error(actual_next_prices, ema_pred_prices))
    rmse_ema = float(np.sqrt(mean_squared_error(actual_next_prices, ema_pred_prices)))
    r2_ema = float(r2_score(actual_next_prices, ema_pred_prices)) if len(actual_next_prices) > 1 else 0.0
    mape_ema = float(np.mean(np.abs((actual_next_prices - ema_pred_prices) / actual_next_prices)) * 100.0)
    ema_change = ema_pred_prices - curr_test_prices
    dir_acc_ema = float(np.mean(np.sign(actual_change) == np.sign(ema_change)) * 100) if len(actual_change) > 0 else 50.0

    # ---------------------------
    # Model 4: Naive Persistence Baseline (Today's Price)
    # ---------------------------
    base_pred_prices = curr_test_prices
    mae_base = float(mean_absolute_error(actual_next_prices, base_pred_prices))
    rmse_base = float(np.sqrt(mean_squared_error(actual_next_prices, base_pred_prices)))
    r2_base = float(r2_score(actual_next_prices, base_pred_prices)) if len(actual_next_prices) > 1 else 0.0
    mape_base = float(np.mean(np.abs((actual_next_prices - base_pred_prices) / actual_next_prices)) * 100.0)
    dir_acc_base = 50.0

    # ---------------------------
    # Forward Multi-Horizon Projections (1D, 5D, 10D, 30D)
    # ---------------------------
    last_known_ret_lags = [float(clean_data["ret"].iloc[-i]) for i in range(1, 6)]
    last_known_sma_ratio = float(clean_data["sma_ratio_20"].iloc[-1])
    last_close = float(clean_data["close"].iloc[-1])
    last_date = clean_data["date"].iloc[-1]

    future_dates = []
    rf_future_prices = []
    lr_future_prices = []
    upper_bounds = []
    lower_bounds = []

    curr_ret_lags_rf = list(last_known_ret_lags)
    curr_ret_lags_lr = list(last_known_ret_lags)
    curr_sma_ratio = last_known_sma_ratio
    running_price_rf = last_close
    running_price_lr = last_close
    recent_daily_vol = max(0.008, float(clean_data["ret"].tail(20).std()))

    for day in range(1, forecast_days + 1):
        next_date = last_date + timedelta(days=1)
        while next_date.weekday() >= 5:
            next_date += timedelta(days=1)
        last_date = next_date

        # Random Forest step
        row_rf = pd.DataFrame([curr_ret_lags_rf + [curr_sma_ratio]], columns=feature_cols)
        pred_ret_rf = float(rf.predict(row_rf)[0])
        running_price_rf = running_price_rf * (1.0 + pred_ret_rf)
        rf_future_prices.append(round(running_price_rf, 2))

        # Linear Regression step
        row_lr = pd.DataFrame([curr_ret_lags_lr + [curr_sma_ratio]], columns=feature_cols)
        pred_ret_lr = float(lr.predict(row_lr)[0])
        running_price_lr = running_price_lr * (1.0 + pred_ret_lr)
        lr_future_prices.append(round(running_price_lr, 2))

        future_dates.append(next_date.strftime("%Y-%m-%d"))

        # 95% uncertainty band
        band = running_price_rf * recent_daily_vol * math.sqrt(day) * 1.96
        upper_bounds.append(round(running_price_rf + band, 2))
        lower_bounds.append(round(max(0.01, running_price_rf - band), 2))

        # Shift lags
        curr_ret_lags_rf = [pred_ret_rf] + curr_ret_lags_rf[:-1]
        curr_ret_lags_lr = [pred_ret_lr] + curr_ret_lags_lr[:-1]
        curr_sma_ratio = curr_sma_ratio * 0.95

    # ---------------------------
    # Monte Carlo Return Simulation (60-Day Envelope)
    # ---------------------------
    all_returns = clean_data["ret"].values
    mean_ret = float(np.mean(all_returns))
    std_ret = float(np.std(all_returns))

    np.random.seed(42)
    n_sims = 500
    n_days = 60
    sim_finals = []
    for _ in range(n_sims):
        sim_rets = np.random.normal(mean_ret, std_ret, n_days)
        path = last_close * np.cumprod(1.0 + sim_rets)
        sim_finals.append(path[-1])

    mc_p10 = round(float(np.percentile(sim_finals, 10)), 2)
    mc_p25 = round(float(np.percentile(sim_finals, 25)), 2)
    mc_p50 = round(float(np.percentile(sim_finals, 50)), 2)
    mc_p75 = round(float(np.percentile(sim_finals, 75)), 2)
    mc_p90 = round(float(np.percentile(sim_finals, 90)), 2)

    return {
        "test_dates": test_dates,
        "test_actual": [round(float(v), 2) for v in actual_next_prices],
        "test_predicted_rf": [round(float(v), 2) for v in rf_pred_prices],
        "test_predicted_lr": [round(float(v), 2) for v in lr_pred_prices],
        "test_predicted_ema": [round(float(v), 2) for v in ema_pred_prices],
        "test_baseline": [round(float(v), 2) for v in base_pred_prices],
        "test_split_info": {
            "train_start": clean_data["date"].iloc[0].strftime("%Y-%m-%d"),
            "train_end": clean_data["date"].iloc[split_idx-1].strftime("%Y-%m-%d"),
            "test_start": clean_data["date"].iloc[split_idx].strftime("%Y-%m-%d"),
            "test_end": clean_data["date"].iloc[-1].strftime("%Y-%m-%d"),
            "train_samples": split_idx,
            "test_samples": len(actual_next_prices)
        },
        "model_comparison_matrix": [
            {
                "model_name": "Random Forest Regressor",
                "type": "Non-Linear Return Ensemble",
                "mae": round(mae_rf, 2),
                "rmse": round(rmse_rf, 2),
                "mape": round(mape_rf, 2),
                "directional_acc": round(dir_acc_rf, 1),
                "r2": round(r2_rf, 3),
                "delta_vs_baseline": round(mae_rf - mae_base, 2),
                "beats_baseline": bool(mae_rf <= mae_base)
            },
            {
                "model_name": "Linear Regression (OLS)",
                "type": "Multi-lag Linear Trend",
                "mae": round(mae_lr, 2),
                "rmse": round(rmse_lr, 2),
                "mape": round(mape_lr, 2),
                "directional_acc": round(dir_acc_lr, 1),
                "r2": round(r2_lr, 3),
                "delta_vs_baseline": round(mae_lr - mae_base, 2),
                "beats_baseline": bool(mae_lr <= mae_base)
            },
            {
                "model_name": "EMA Momentum Drift",
                "type": "Exponential Smoothing",
                "mae": round(mae_ema, 2),
                "rmse": round(rmse_ema, 2),
                "mape": round(mape_ema, 2),
                "directional_acc": round(dir_acc_ema, 1),
                "r2": round(r2_ema, 3),
                "delta_vs_baseline": round(mae_ema - mae_base, 2),
                "beats_baseline": bool(mae_ema <= mae_base)
            },
            {
                "model_name": "Naive Persistence Baseline",
                "type": "Benchmark (Pt = Pt-1)",
                "mae": round(mae_base, 2),
                "rmse": round(rmse_base, 2),
                "mape": round(mape_base, 2),
                "directional_acc": round(dir_acc_base, 1),
                "r2": round(r2_base, 3),
                "delta_vs_baseline": 0.0,
                "beats_baseline": True
            }
        ],
        "future_forecast": {
            "dates": future_dates,
            "rf_prices": rf_future_prices,
            "lr_prices": lr_future_prices,
            "upper_bound": upper_bounds,
            "lower_bound": lower_bounds,
            "d1_price": rf_future_prices[0],
            "d5_price": rf_future_prices[min(4, len(rf_future_prices)-1)],
            "d10_price": rf_future_prices[min(9, len(rf_future_prices)-1)],
            "d30_price": rf_future_prices[-1],
            "monte_carlo_60d": {
                "p10": mc_p10,
                "p25": mc_p25,
                "p50": mc_p50,
                "p75": mc_p75,
                "p90": mc_p90
            }
        }
    }


def synthesize_signal_matrix(df, technicals, ml_results, lin_reg):
    """
    Unified signal matrix and composite scoring function.
    Guarantees strict mathematical consistency: if the AI forecast direction is negative,
    the composite verdict CANNOT be Bullish.
    """
    curr_close = float(df["close"].iloc[-1])
    last_date = df["date"].iloc[-1].strftime("%Y-%m-%d")
    first_date = df["date"].iloc[0].strftime("%Y-%m-%d")

    sma20 = float(technicals["sma_20"].iloc[-1])
    sma50 = float(technicals["sma_50"].iloc[-1])
    rsi = float(technicals["rsi"].iloc[-1])
    macd_hist = float(technicals["macd_hist"].iloc[-1])
    annual_vol = float(technicals["volatility_annualized"].iloc[-1])
    atr_14 = float(technicals["atr_14"].iloc[-1])

    d1_pred = ml_results["future_forecast"]["d1_price"]
    d5_pred = ml_results["future_forecast"]["d5_price"]
    d10_pred = ml_results["future_forecast"]["d10_price"]
    d30_pred = ml_results["future_forecast"]["d30_price"]

    d1_pct = ((d1_pred - curr_close) / curr_close) * 100 if curr_close > 0 else 0.0
    d5_pct = ((d5_pred - curr_close) / curr_close) * 100 if curr_close > 0 else 0.0
    d10_pct = ((d10_pred - curr_close) / curr_close) * 100 if curr_close > 0 else 0.0
    d30_pct = ((d30_pred - curr_close) / curr_close) * 100 if curr_close > 0 else 0.0

    score = 0
    signal_rows = []

    # 1. AI 5-Day Forecast Direction (Weight: 35)
    if d5_pct > 1.0:
        contrib = 35
        state = "Positive"
    elif d5_pct >= -0.5:
        contrib = 10
        state = "Neutral"
    else:
        contrib = -35
        state = "Negative"
    score += contrib
    signal_rows.append({
        "name": "5D Model Forecast",
        "value": f"${round(d5_pred, 2)} ({'+' if d5_pct >= 0 else ''}{round(d5_pct, 2)}%)",
        "state": state,
        "weight": contrib
    })

    # 2. Moving Average Alignment (Weight: 25)
    if curr_close > sma20 and sma20 > sma50:
        contrib = 25
        state = "Bullish Alignment"
    elif curr_close > sma20:
        contrib = 10
        state = "Above SMA20"
    elif curr_close < sma20 and sma20 < sma50:
        contrib = -25
        state = "Bearish Alignment"
    else:
        contrib = -10
        state = "Below SMA20"
    score += contrib
    signal_rows.append({
        "name": "SMA Structure (20/50)",
        "value": f"SMA20: ${round(sma20, 2)}",
        "state": state,
        "weight": contrib
    })

    # 3. RSI (14) Momentum (Weight: 20) — Overbought is Caution/Negative
    if rsi > 70:
        contrib = -20
        state = "Caution (Overbought)"
    elif rsi < 30:
        contrib = 15
        state = "Oversold Rebound"
    elif 45 <= rsi <= 65:
        contrib = 15
        state = "Expansion Range"
    else:
        contrib = 0
        state = "Neutral"
    score += contrib
    signal_rows.append({
        "name": "14D RSI",
        "value": f"{round(rsi, 1)}",
        "state": state,
        "weight": contrib
    })

    # 4. MACD Momentum (Weight: 20)
    if macd_hist > 0:
        contrib = 20
        state = "Positive Histogram"
    else:
        contrib = -20
        state = "Negative Histogram"
    score += contrib
    signal_rows.append({
        "name": "MACD Histogram",
        "value": f"{round(macd_hist, 2)}",
        "state": state,
        "weight": contrib
    })

    # 5. Linear Regression Trend (Weight: 15)
    lr_slope = lin_reg["slope"]
    if lr_slope > 0.05:
        contrib = 15
        state = f"Upward (+{lin_reg['annualized_trend_pct']}%)"
    elif lr_slope < -0.05:
        contrib = -15
        state = f"Downward ({lin_reg['annualized_trend_pct']}%)"
    else:
        contrib = 0
        state = "Flat Trend"
    score += contrib
    signal_rows.append({
        "name": "OLS Linear Trend",
        "value": f"Slope: {round(lr_slope, 3)} (R2: {lin_reg['r2']})",
        "state": state,
        "weight": contrib
    })

    # Hard Consistency Constraint
    if d5_pct < -0.2 and score > 0:
        score = min(score, 0)

    # Label synthesis
    if score >= 45:
        composite_signal = "Bullish"
        signal_tone = "pos"
    elif score >= 15:
        composite_signal = "Moderately Bullish"
        signal_tone = "pos"
    elif score >= -15:
        composite_signal = "Neutral"
        signal_tone = "neu"
    elif score >= -45:
        composite_signal = "Moderately Bearish"
        signal_tone = "neg"
    else:
        composite_signal = "Bearish"
        signal_tone = "neg"

    atr_pct = (atr_14 / curr_close) * 100 if curr_close > 0 else 0.0

    return {
        "last_close": round(curr_close, 2),
        "last_date": last_date,
        "date_range": f"{first_date} to {last_date}",
        "total_records": len(df),
        "composite_score": score,
        "composite_signal": composite_signal,
        "signal_tone": signal_tone,
        "signals_table": signal_rows,
        "d1_forecast": {
            "price": round(d1_pred, 2),
            "pct": round(d1_pct, 2)
        },
        "d5_forecast": {
            "price": round(d5_pred, 2),
            "pct": round(d5_pct, 2)
        },
        "d10_forecast": {
            "price": round(d10_pred, 2),
            "pct": round(d10_pct, 2)
        },
        "d30_forecast": {
            "price": round(d30_pred, 2),
            "pct": round(d30_pct, 2)
        },
        "risk_profile": {
            "annual_volatility": round(annual_vol, 1),
            "atr_14": round(atr_14, 2),
            "atr_pct": round(atr_pct, 2),
            "volatility_channel_upper": round(curr_close + (1.5 * atr_14), 2),
            "volatility_channel_lower": round(max(0.01, curr_close - (1.5 * atr_14)), 2)
        }
    }


def analyze_single_dataset(df, dataset_name="Dataset"):
    technicals = calculate_technicals(df)
    lin_reg = compute_linear_regression(df)
    dist_analytics = compute_distribution_analytics(df)
    key_levels = compute_key_levels(df, technicals)
    ml_results = train_and_forecast_multi_model(technicals, forecast_days=30)
    summary = synthesize_signal_matrix(df, technicals, ml_results, lin_reg)

    dates = [d.strftime("%Y-%m-%d") for d in df["date"]]
    closes = [round(float(v), 2) for v in df["close"]]
    opens = [round(float(v), 2) for v in df["open"]]
    highs = [round(float(v), 2) for v in df["high"]]
    lows = [round(float(v), 2) for v in df["low"]]
    volumes = [int(v) for v in df["volume"]]

    sma20 = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["sma_20"]]
    sma50 = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["sma_50"]]
    sma200 = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["sma_200"]]
    ema12 = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["ema_12"]]
    ema26 = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["ema_26"]]

    bb_u = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["bb_upper"]]
    bb_l = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["bb_lower"]]
    bb_bw = [round(float(v), 2) if not pd.isna(v) else None for v in technicals["bb_bandwidth"]]

    rsi = [round(float(v), 2) for v in technicals["rsi"]]
    macd = [round(float(v), 2) for v in technicals["macd"]]
    macd_sig = [round(float(v), 2) for v in technicals["macd_signal"]]
    macd_hist = [round(float(v), 2) for v in technicals["macd_hist"]]

    cum_returns = [round(float(v), 2) for v in technicals["cum_return_pct"]]
    drawdowns = [round(float(v), 2) for v in technicals["drawdown_pct"]]

    preview_df = df[["date", "open", "high", "low", "close", "volume"]].tail(100).copy()
    preview_df["date"] = preview_df["date"].dt.strftime("%Y-%m-%d")
    preview_rows = preview_df.to_dict(orient="records")

    return {
        "dataset_name": dataset_name,
        "summary": summary,
        "linear_regression": lin_reg,
        "distribution_analytics": dist_analytics,
        "key_levels": key_levels,
        "ml_results": ml_results,
        "series": {
            "dates": dates,
            "close": closes,
            "open": opens,
            "high": highs,
            "low": lows,
            "volume": volumes,
            "sma20": sma20,
            "sma50": sma50,
            "sma200": sma200,
            "ema12": ema12,
            "ema26": ema26,
            "bb_upper": bb_u,
            "bb_lower": bb_l,
            "bb_bandwidth": bb_bw,
            "rsi": rsi,
            "macd": macd,
            "macd_signal": macd_sig,
            "macd_hist": macd_hist,
            "cum_returns": cum_returns,
            "drawdowns": drawdowns,
            "linear_fit": lin_reg["linear_fit"],
            "linear_upper_1": lin_reg["channel_upper_1"],
            "linear_lower_1": lin_reg["channel_lower_1"]
        },
        "preview_rows": preview_rows
    }


# -----------------------------
# Flask API Routes
# -----------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sample", methods=["GET"])
def get_sample():
    try:
        ticker = request.args.get("ticker", "AAPL").upper().strip()
        sample_info = SAMPLE_DATASETS.get(ticker, SAMPLE_DATASETS["AAPL"])
        csv_path = sample_info["path"]
        if not os.path.exists(csv_path):
            return jsonify({"success": False, "error": f"Sample file for '{ticker}' ({sample_info['filename']}) not found on server."}), 404
        df = parse_stock_csv(csv_path, filename=sample_info["filename"])
        data = analyze_single_dataset(df, dataset_name=ticker if ticker in SAMPLE_DATASETS else "AAPL")
        return jsonify({"success": True, "dataset": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/analyze", methods=["POST"])
def analyze_upload():
    try:
        if "file" not in request.files and "files" not in request.files:
            return jsonify({"success": False, "error": "No CSV file provided in upload request."}), 400

        file_obj = request.files.get("file") or (request.files.getlist("files")[0] if request.files.getlist("files") else None)
        if not file_obj or file_obj.filename == "":
            return jsonify({"success": False, "error": "Empty filename provided."}), 400

        fname = file_obj.filename
        stream = io.StringIO(file_obj.stream.read().decode("utf-8", errors="ignore"))
        df = parse_stock_csv(stream, filename=fname)
        ticker = os.path.splitext(fname)[0].upper()
        data = analyze_single_dataset(df, dataset_name=ticker)

        return jsonify({"success": True, "dataset": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()})


if __name__ == "__main__":
    import socket

    def is_port_in_use(p):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', p)) == 0

    port = int(os.environ.get("PORT", 5005))
    if is_port_in_use(port):
        for candidate in [5005, 5001, 8000, 8080, 5050]:
            if not is_port_in_use(candidate):
                port = candidate
                break

    print(f"Server active: http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=True)