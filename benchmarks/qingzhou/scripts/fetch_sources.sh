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

echo "Fetching Online-Mind2Web human_label.json (public on GitHub; labels only)..."
curl -fsSL -o "$RAW/human_label.json" \
  "https://raw.githubusercontent.com/OSU-NLP-Group/Online-Mind2Web/main/data/evaluation_results/online_mind2web_evaluation_results/human_label.json"
python3 -c "import json; print('om2w label tasks', len(json.load(open('$RAW/human_label.json'))))"

echo "Fetching Online_Mind2Web.json from public third-party mirrors (website field; CC BY 4.0)..."
if curl -fsSL -o "$RAW/Online_Mind2Web.public_mirror.json" \
  "https://raw.githubusercontent.com/theredsix/abp-online-mind2web-results/HEAD/Online_Mind2Web.json"; then
  python3 -c "import json,hashlib,pathlib; p=pathlib.Path('$RAW/Online_Mind2Web.public_mirror.json'); d=json.loads(p.read_text()); print('om2w mirror tasks', len(d), 'sha256', hashlib.sha256(p.read_bytes()).hexdigest()[:16])"
else
  echo "WARN: public mirror fetch failed; curated set still has committed om2w_website_join.json"
fi

echo
echo "NOTE: Hugging Face dataset osunlp/Online-Mind2Web is GATED (HTTP 401 without auth)."
echo "After you accept the dataset terms and set HF_TOKEN, try:"
echo "  huggingface-cli download osunlp/Online-Mind2Web Online_Mind2Web.json --local-dir $RAW/om2w-hf"
echo "Then diff against datasets/opensource/om2w_website_join.json."
