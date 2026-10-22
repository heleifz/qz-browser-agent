#!/usr/bin/env bash
# Download upstream sources used for resampling. Does not commit into git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/raw"
mkdir -p "$RAW"

echo "Fetching WebVoyager_data.jsonl..."
curl -fsSL -o "$RAW/webvoyager.jsonl" \
  "https://raw.githubusercontent.com/MinorJerry/WebVoyager/main/data/WebVoyager_data.jsonl"
wc -l "$RAW/webvoyager.jsonl"

echo "Fetching Online-Mind2Web human_label.json (public on GitHub; task text only, no official website field)..."
curl -fsSL -o "$RAW/human_label.json" \
  "https://raw.githubusercontent.com/OSU-NLP-Group/Online-Mind2Web/main/data/evaluation_results/online_mind2web_evaluation_results/human_label.json"
python3 -c "import json; print('om2w tasks', len(json.load(open('$RAW/human_label.json'))))"

echo
echo "NOTE: Hugging Face dataset osunlp/Online-Mind2Web is GATED (HTTP 401 without auth)."
echo "After you accept the dataset terms and set HF_TOKEN, try:"
echo "  huggingface-cli download osunlp/Online-Mind2Web Online_Mind2Web.json --local-dir $RAW/om2w-hf"
echo "Then re-run scripts/sample_curated.py to fill official start_url fields."
