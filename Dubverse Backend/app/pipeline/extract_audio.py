from app.audio.decode import decode_audio


def extract_audio(video_path: str) -> dict:
    """
    Extract decoded audio from a media file.

    This is a thin adapter that:
    - Calls decode_audio()
    - Translates ok: bool → status: str
    - Never raises
    """

    decode_result = decode_audio(video_path)

    # Translate low-level contract → pipeline contract
    if not decode_result["ok"]:
        return {
            "status": "skipped",
            "reason": "audio_decode_failed",
            "error_code": decode_result.get("error_code"),
            "error_message": decode_result.get("error_message"),
            "diagnostics": decode_result.get("diagnostics"),
        }

    return {
        "status": "ok",
        "audio": decode_result["audio"],
        "sample_rate": decode_result["sample_rate"],
        "decoder_used": decode_result.get("decoder_used"),
        "diagnostics": decode_result.get("diagnostics"),
    }
