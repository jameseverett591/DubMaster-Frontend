from dataclasses import dataclass
from typing import List, Literal

VariantType = Literal["faithful", "performable", "sync_fit"]

VARIANT_ORDER: List[str] = ["faithful", "performable", "sync_fit"]


@dataclass
class AdaptationVariant:
    variant_type: str          # "faithful" | "performable" | "sync_fit"
    text: str
    rationale: str
    estimated_duration_ratio: float  # 1.0 = fills timing slot exactly
    syllable_count: int


@dataclass
class AdaptedSegment:
    segment_id: str
    source_text: str
    source_language: str
    target_language: str
    source_duration: float             # seconds — the timing window to fill
    variants: List[AdaptationVariant]  # always length 3: faithful/performable/sync_fit
    recommended: str                   # "faithful" | "performable" | "sync_fit"
    context_notes: str

    def get_variant(self, variant_type: str) -> AdaptationVariant:
        for v in self.variants:
            if v.variant_type == variant_type:
                return v
        for v in self.variants:
            if v.variant_type == "performable":
                return v
        return self.variants[0]
