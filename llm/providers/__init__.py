from __future__ import annotations

from dataclasses import dataclass


@dataclass
class LLMResult:
    output_text: str
    reasoning_trace: str = ""
