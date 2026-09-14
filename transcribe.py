from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.settings import FINAL_TRANSCRIPTION_MODEL
from transcription import transcribe_audio


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe an audio file with local open-source Whisper via faster-whisper."
    )
    parser.add_argument("audio", type=Path, help="Path to an audio file to transcribe.")
    parser.add_argument(
        "--model",
        default=FINAL_TRANSCRIPTION_MODEL,
        help="Whisper model size or local model path. Defaults to the app's high-accuracy final model.",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "cuda", "auto"],
        help="Inference device. Use cpu for widest compatibility.",
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="Compute precision. int8 is a good default for CPU tests.",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Language hint. Use ISO code such as en, es, fr.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional path to save JSON transcript output.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    audio_path = args.audio.resolve()

    if not audio_path.exists():
        raise SystemExit(f"Audio file does not exist: {audio_path}")

    result = transcribe_audio(
        audio_path,
        model_name=args.model,
        device=args.device,
        compute_type=args.compute_type,
        language=args.language,
    )

    print(json.dumps(result, indent=2))

    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
