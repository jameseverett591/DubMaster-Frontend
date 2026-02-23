# app/audio/types.py
from typing import TypedDict, Optional, List, TYPE_CHECKING

if TYPE_CHECKING:
    import torch


class DecodeDiagnostics(TypedDict):
    input_path: str
    input_ext: str
    file_size: Optional[int]

    decoder_attempts: List[str]
    decoder_stderr: Optional[str]

    duration_sec: Optional[float]
    num_samples: Optional[int]
    sample_rate: Optional[int]
    resampled_from: Optional[int]

    warnings: List[str]


class DecodeResult(TypedDict):
    """
    Hard contract for audio decoding.

    Rules:
    - decode_audio() MUST always return this shape
    - No exceptions escape the decoding boundary
    - If ok == False, downstream must skip processing
    """

    ok: bool

    # Present only if ok == True
    audio: Optional["torch.Tensor"]      # float32 mono PCM
    sample_rate: Optional[int]
    decoder_used: Optional[str]

    # Present only if ok == False
    error_code: Optional[str]
    error_message: Optional[str]

    # Always present
    diagnostics: DecodeDiagnostics
