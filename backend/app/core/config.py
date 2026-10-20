from functools import lru_cache
from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-2.5-flash"
    gemini_temperature: float = Field(0.3, ge=0, le=2)
    embedding_model: str = "gemini-embedding-001"
    database_url: str = "sqlite:///./voxpilot.db"
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"
    session_ttl_hours: int = Field(24, ge=1)
    max_input_characters: int = Field(12000, ge=100, le=100000)
    max_output_tokens: int = Field(1024, ge=128, le=8192)
    request_timeout_seconds: int = Field(45, ge=1, le=180)
    context_messages: int = Field(20, ge=0, le=100)
    context_characters: int = Field(24000, ge=100, le=100000)
    max_upload_bytes: int = Field(5 * 1024 * 1024, ge=1024, le=20000000)
    max_document_characters: int = Field(100000, ge=1000, le=500000)
    chunk_size: int = Field(1000, ge=100, le=4000)
    chunk_overlap: int = Field(150, ge=0)
    retrieval_top_k: int = Field(4, ge=1, le=10)
    retrieval_min_score: float = Field(0.3, ge=-1, le=1)
    trace_retention_days: int = Field(7, ge=1)
    stt_model: str = "base"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    stt_model_cache: str = ".cache/whisper"
    stt_cpu_threads: int = Field(4, ge=1, le=32)
    stt_max_upload_bytes: int = Field(10485760, ge=1024, le=30000000)
    stt_max_duration_seconds: int = Field(60, ge=1, le=300)
    stt_min_duration_seconds: float = Field(0.4, ge=0.1, le=5)
    rate_limit_per_minute: int = Field(60, ge=1)

    @model_validator(mode="after")
    def valid_chunking(self):
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        if not self.gemini_model.strip() or not self.embedding_model.strip():
            raise ValueError("Model identifiers cannot be empty")
        return self

    @property
    def provider_ready(self) -> bool:
        return bool(self.gemini_api_key.get_secret_value().strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
