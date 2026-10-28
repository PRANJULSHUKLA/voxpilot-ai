import pytest
from app.services.evaluation import word_error_rate


@pytest.mark.parametrize(
    "reference,hypothesis,expected",
    [
        ("Hello, WORLD!", "hello world", 0),
        ("a b c", "a x c", 1 / 3),
        ("a b c", "a c", 1 / 3),
        ("a b", "a x b", 1 / 2),
        ("a b", "", 1),
        ("a", "x y z", 3),
    ],
)
def test_word_error_rate(reference, hypothesis, expected):
    assert word_error_rate(reference, hypothesis) == pytest.approx(expected)


def test_empty_reference_is_not_a_quality_measurement():
    with pytest.raises(ValueError):
        word_error_rate("", "hello")
