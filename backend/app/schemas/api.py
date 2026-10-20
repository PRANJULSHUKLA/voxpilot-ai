from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator


class TextInput(BaseModel):
    text: str = Field(min_length=1, max_length=100000)

    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Text cannot be blank")
        return value.strip()


class SessionCreate(BaseModel):
    title: str = Field(default="Untitled conversation", min_length=1, max_length=150)


class ChatInput(TextInput):
    session_id: UUID


class ActionItem(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    owner: str | None = None
    deadline: str | None = None
    status: Literal["open", "in_progress", "done"] = "open"
    evidence: str = Field(min_length=1, description="Exact supporting transcript quotation")


class MeetingNotes(BaseModel):
    summary: str = Field(min_length=1, max_length=6000)
    key_points: list[str]
    concepts: list[str]
    decisions: list[str]
    action_items: list[ActionItem]
    open_questions: list[str]
    follow_up_topics: list[str]
    uncertainties: list[str] = Field(default_factory=list)


class GroundedAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=20000)
    citation_ids: list[str] = Field(default_factory=list)
    insufficient_evidence: bool = False


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    role: str
    content: str
    created_at: datetime


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    kind: str
    created_at: datetime
    expires_at: datetime
    transcript: str
    notes: MeetingNotes | None


class Source(BaseModel):
    id: str
    name: str
    page: int | None
    excerpt: str


class ChatOut(BaseModel):
    model_latency_ms: float | None = None
    answer: str
    trace_id: str
    sources: list[Source] = Field(default_factory=list)


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_id: str
    name: str
    embedding_model: str
    created_at: datetime


class TraceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_ref: str | None
    route: str
    started_at: datetime
    completed_at: datetime
    latency_ms: float
    model_latency_ms: float | None
    retrieval_latency_ms: float | None
    input_tokens: int | None
    output_tokens: int | None
    success: bool
    error_category: str | None
    nodes: int
