"""Persistent local Faster Whisper worker for WhatsApp voice notes.

Reads one JSON object per line from stdin and writes one JSON result per line
to stdout. Keeping the process alive avoids loading the Whisper model for every
voice note.
"""

import json
import sys

from faster_whisper import WhisperModel


def emit(payload):
    print(json.dumps(payload, ensure_ascii=True), flush=True)


models = {}

for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request["id"]
        model_name = request.get("model") or "small"
        model = models.get(model_name)
        if model is None:
            model = WhisperModel(model_name, device="cpu", compute_type="int8")
            models[model_name] = model

        segments, info = model.transcribe(
            request["path"],
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        emit({
            "id": request_id,
            "text": text,
            "language": info.language,
            "languageProbability": info.language_probability,
        })
    except Exception as error:
        emit({
            "id": request.get("id") if "request" in locals() else None,
            "error": str(error),
        })
