#!/usr/bin/env bash
# =========================================================
# AI Stock Market Forecasting Web Application Launcher
# =========================================================

echo "=================================================="
echo "🚀 Starting Stock Trend AI Web Server..."
echo "=================================================="

# Detect best Python environment
PYTHON_CMD=""
if [ -f "/opt/anaconda3/bin/python" ]; then
    PYTHON_CMD="/opt/anaconda3/bin/python"
elif command -v python &> /dev/null && python -c "import numpy, flask" &> /dev/null; then
    PYTHON_CMD="python"
elif command -v python3 &> /dev/null && python3 -c "import numpy, flask" &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
else
    PYTHON_CMD="python"
fi

echo "🔍 Using Python environment: $PYTHON_CMD"

# Verify dependencies, install if missing
if ! $PYTHON_CMD -c "import numpy, pandas, flask, sklearn" &> /dev/null; then
    echo "📦 Installing required dependencies..."
    $PYTHON_CMD -m pip install -r requirements.txt
fi

$PYTHON_CMD app.py
