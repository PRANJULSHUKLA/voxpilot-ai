"""Reference-based speech evaluation; punctuation/case are excluded from WER."""

import re


def word_error_rate(reference: str, hypothesis: str) -> float:
    reference_words = re.findall(r"\w+", reference.lower())
    hypothesis_words = re.findall(r"\w+", hypothesis.lower())
    if not reference_words:
        raise ValueError("WER requires a nonempty reference transcript")
    previous = list(range(len(hypothesis_words) + 1))
    for i, expected in enumerate(reference_words, 1):
        current = [i]
        for j, actual in enumerate(hypothesis_words, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1] / len(reference_words)
