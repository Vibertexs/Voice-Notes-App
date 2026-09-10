from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter

from faster_whisper import WhisperModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe an audio file with local open-source Whisper via faster-whisper."
    )
    parser.add_argument("audio", type=Path, help="Path to an audio file to transcribe.")
    parser.add_argument(
        "--model",
        default="tiny.en",
        help="Whisper model size or local model path. Start with tiny.en for the POC.",
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

    started_at = perf_counter()
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        language=args.language,
        vad_filter=True,
    )

    transcript_segments = [
        {
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip(),
        }
        for segment in segments
    ]
    text = " ".join(segment["text"] for segment in transcript_segments).strip()

    result = {
        "audio": str(audio_path),
        "model": args.model,
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration_seconds": round(info.duration, 2),
        "elapsed_seconds": round(perf_counter() - started_at, 2),
        "text": text,
        "segments": transcript_segments,
    }

    print(json.dumps(result, indent=2))

    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
