import asyncio
from uuid import uuid4
import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
from app.core.config import Settings
from app.core.errors import AppError
from app.observability.tracing import RequestTrace
from app.providers.gemini import GeminiProvider
from app.schemas.api import MeetingNotes


def trace():
    return RequestTrace(str(uuid4()), "chat", str(uuid4()))


@pytest.mark.asyncio
async def test_real_prompt_chain_and_sdk_usage(monkeypatch):
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="server-only-secret"))
    prompts = []

    async def reply(prompt):
        prompts.append(prompt.to_messages())
        return AIMessage(
            content="Atlas is your project.", usage_metadata={"input_tokens": 7, "output_tokens": 5, "total_tokens": 12}
        )

    monkeypatch.setattr(provider, "model", lambda: RunnableLambda(reply))
    t = trace()
    answer = await provider.generate(
        "Helpful system", "What is my project?", [("human", "My project is Atlas.")], None, t
    )
    assert answer == "Atlas is your project."
    assert [m.type for m in prompts[0]] == ["system", "human", "human"]
    assert prompts[0][1].content == "My project is Atlas."
    assert t.input_tokens == 7 and t.output_tokens == 5 and t.model_latency_ms > 0


@pytest.mark.asyncio
async def test_actual_timeout_wrapper(monkeypatch):
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test"))
    provider.settings.request_timeout_seconds = 0.01

    async def delayed(_):
        await asyncio.sleep(0.1)
        return AIMessage(content="late")

    monkeypatch.setattr(provider, "model", lambda: RunnableLambda(delayed))
    with pytest.raises(AppError) as exc:
        await provider.generate("system", "hello", [], None, trace())
    assert exc.value.code == "provider_timeout"


@pytest.mark.asyncio
async def test_structured_model_parsing_failure(monkeypatch):
    class StructuredModel:
        def with_structured_output(self, schema, **kwargs):
            assert schema is MeetingNotes and kwargs["method"] == "json_schema"
            return RunnableLambda(
                lambda _: {
                    "raw": AIMessage(content="bad json"),
                    "parsed": None,
                    "parsing_error": ValueError("secret payload"),
                }
            )

    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test"))
    monkeypatch.setattr(provider, "model", StructuredModel)
    with pytest.raises(AppError) as exc:
        await provider.generate("system", "transcript", [], MeetingNotes, trace())
    assert exc.value.code == "invalid_output"
    assert "secret payload" not in exc.value.message


def test_sdk_instantiation_uses_explicit_server_key():
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="server-key", gemini_model="gemini-2.5-flash"))
    model = provider.model()
    assert model.model == "gemini-2.5-flash"
    assert model.google_api_key.get_secret_value() == "server-key"


@pytest.mark.asyncio
async def test_embedding_adapter_explicit_model_key_and_task_types(monkeypatch):
    import app.providers.gemini as module

    constructed = []

    class Embeddings:
        def __init__(self, **kwargs):
            constructed.append(kwargs)

        async def aembed_documents(self, texts):
            return [[1.0, 0.0] for _ in texts]

        async def aembed_query(self, text):
            return [0.0, 1.0]

    monkeypatch.setattr(module, "GoogleGenerativeAIEmbeddings", Embeddings)
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="server-key"))
    assert await provider.embed(["first", "second"]) == [[1.0, 0.0], [1.0, 0.0]]
    assert await provider.embed(["question"], query=True) == [[0.0, 1.0]]
    assert constructed[0]["model"] == "gemini-embedding-001"
    assert constructed[0]["api_key"] == "server-key" and constructed[0]["vertexai"] is False
    assert constructed[0]["task_type"] == "RETRIEVAL_DOCUMENT"
    assert constructed[1]["task_type"] == "RETRIEVAL_QUERY"


def test_invalid_configuration_does_not_echo_secrets():
    with pytest.raises(ValueError) as exc:
        Settings(_env_file=None, gemini_api_key="never-show-this-secret", chunk_overlap=1000, chunk_size=1000)
    assert "never-show-this-secret" not in str(exc.value)


@pytest.mark.parametrize("model_id", ["gemini-3.6-flash", "models/gemini-3.6-flash"])
def test_gemini_three_omits_deprecated_sampling_parameters(model_id):
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test-only", gemini_model=model_id))
    model = provider.model()
    assert model.temperature is None
    assert model.top_p is None and model.top_k is None
    from langchain_core.messages import HumanMessage

    request = model._prepare_request([HumanMessage(content="hello")], generation_config={"candidate_count": None})
    wire = request["config"].model_dump(exclude_none=True)
    assert not {"temperature", "top_p", "top_k", "candidate_count"} & wire.keys()


def test_legacy_gemini_retains_configured_temperature():
    model = GeminiProvider(
        Settings(_env_file=None, gemini_api_key="test-only", gemini_model="gemini-2.5-flash", gemini_temperature=0.3)
    ).model()
    assert model.temperature == 0.3


@pytest.mark.asyncio
@pytest.mark.parametrize("structured", [False, True])
async def test_gemini_three_compatibility_reaches_chat_and_structured_requests(monkeypatch, structured):
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.outputs import ChatResult, ChatGeneration
    from app.schemas.api import GroundedAnswer

    seen = []

    async def generate(self, messages, stop=None, run_manager=None, **kwargs):
        request = self._prepare_request(messages, stop=stop, **kwargs)
        wire = request["config"].model_dump(exclude_none=True)
        assert not {"temperature", "top_p", "top_k", "candidate_count"} & wire.keys()
        seen.append(request)
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content='{"answer":"hello","citation_ids":[],"insufficient_evidence":true}'
                        if structured
                        else "hello"
                    )
                )
            ]
        )

    monkeypatch.setattr(ChatGoogleGenerativeAI, "_agenerate", generate)
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test-only", gemini_model="gemini-3.6-flash"))
    result = await provider.generate("Helpful system", "hello", [], GroundedAnswer if structured else None, trace())
    assert seen
    assert result.answer == "hello" if structured else result == "hello"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code,http",
    [
        (401, "credentials", 502),
        (403, "credentials", 502),
        (404, "model_unavailable", 502),
        (429, "quota", 429),
        (503, "unavailable", 503),
        (504, "timeout", 504),
    ],
)
async def test_wrapped_sdk_errors_are_classified_without_payloads(monkeypatch, status, code, http):
    from google.genai.errors import ClientError
    from langchain_google_genai.chat_models import ChatGoogleGenerativeAIError

    async def rejected(_):
        try:
            raise ClientError(status, {"error": {"message": "private-secret-payload", "code": status}})
        except ClientError as cause:
            raise ChatGoogleGenerativeAIError("private-secret-payload") from cause

    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test"))
    monkeypatch.setattr(provider, "model", lambda: RunnableLambda(rejected))
    with pytest.raises(AppError) as exc:
        await provider.generate("system", "private input", [], None, trace())
    assert exc.value.code == f"provider_{code}"
    assert exc.value.status == http
    assert "private" not in exc.value.message
