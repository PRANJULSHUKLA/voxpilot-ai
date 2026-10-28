import json
from typing import Literal, TypedDict
from langgraph.graph import END, START, StateGraph
from app.core.errors import AppError
from app.db.models import Message
from app.providers.gemini import SYSTEM, MEETING_SYSTEM, RAG_SYSTEM
from app.repositories.sessions import get_session, history
from app.schemas.api import MeetingNotes, GroundedAnswer
from app.services.retrieval import retrieve


class AgentState(TypedDict, total=False):
    session_id: str
    text: str
    intent: Literal["chat", "meeting", "document"]
    document_id: str
    history: list
    answer: str
    notes: MeetingNotes
    grounded: GroundedAnswer
    sources: list


def build_graph(db, provider, settings, trace):
    # Per-request graph closes over only this request's database transaction and trace.
    def validate_input(state):
        trace.nodes += 1
        if not state["text"].strip() or len(state["text"]) > settings.max_input_characters:
            raise AppError(422, "input_limit", f"Enter 1–{settings.max_input_characters} characters.")
        return {}

    def load_context(state):
        trace.nodes += 1
        get_session(db, state["session_id"], "meeting" if state["intent"] == "meeting" else "chat")
        return {
            "history": history(db, state["session_id"], settings.context_messages, settings.context_characters)
            if state["intent"] == "chat"
            else []
        }

    def classify_intent(state):
        trace.nodes += 1
        # Explicit UI/API intent is deterministic; no extra paid classification call.
        return {"intent": state["intent"]}

    async def conversational_response(state):
        trace.nodes += 1
        answer = await provider.generate(SYSTEM, state["text"], state["history"], None, trace)
        return {"answer": answer}

    async def meeting_notes_workflow(state):
        trace.nodes += 1
        if len(state["text"].split()) < 20:
            raise AppError(422, "short_transcript", "Add at least 20 words before generating meaningful notes.")
        notes = await provider.generate(MEETING_SYSTEM, state["text"], [], MeetingNotes, trace)
        return {"notes": MeetingNotes.model_validate(notes)}

    async def document_question_answering(state):
        trace.nodes += 1
        sources = await retrieve(
            db, provider, settings, state["session_id"], state["document_id"], state["text"], trace
        )
        if not sources:
            return {
                "sources": [],
                "answer": "The uploaded material does not contain enough evidence to answer this question.",
            }
        prompt = json.dumps({"question": state["text"], "untrusted_evidence": sources})
        grounded = await provider.generate(RAG_SYSTEM, prompt, [], GroundedAnswer, trace)
        return {"grounded": GroundedAnswer.model_validate(grounded), "sources": sources}

    def validate_output(state):
        trace.nodes += 1
        if state["intent"] == "meeting":
            notes = state["notes"]
            for item in notes.action_items:
                if (
                    item.evidence not in state["text"]
                    or (item.owner and item.owner not in item.evidence)
                    or (item.deadline and item.deadline not in item.evidence)
                ):
                    raise AppError(
                        502,
                        "unsupported_action",
                        "Model returned an action without matching evidence. Retry or edit the transcript.",
                    )
            return {}
        if "grounded" in state:
            grounded = state["grounded"]
            allowed = {s["id"] for s in state["sources"]}
            if not set(grounded.citation_ids) <= allowed:
                raise AppError(502, "invalid_citations", "Model returned invalid evidence references. Retry.")
            if grounded.insufficient_evidence or not grounded.citation_ids:
                return {
                    "answer": "The uploaded material does not contain enough evidence to answer this question.",
                    "sources": [],
                }
            if not grounded.answer.strip():
                raise AppError(502, "invalid_output", "Model returned a blank grounded answer. Retry.")
            return {
                "answer": grounded.answer,
                "sources": [s for s in state["sources"] if s["id"] in grounded.citation_ids],
            }
        if not state.get("answer", "").strip() or len(state["answer"]) > 50000:
            raise AppError(502, "invalid_output", "Model returned an empty or oversized response. Retry.")
        return {}

    def persist_result(state):
        trace.nodes += 1
        # Re-check TTL after generation. Transaction commits only after all nodes succeed.
        session = get_session(db, state["session_id"])
        if state["intent"] == "meeting":
            session.notes = state["notes"].model_dump()
        else:
            db.add_all(
                [
                    Message(session_id=session.id, role="user", content=state["text"]),
                    Message(session_id=session.id, role="assistant", content=state["answer"]),
                ]
            )
        db.commit()
        return {}

    graph = StateGraph(AgentState)
    for name, node in [
        ("validate_input", validate_input),
        ("load_context", load_context),
        ("classify_intent", classify_intent),
        ("conversational_response", conversational_response),
        ("meeting_notes_workflow", meeting_notes_workflow),
        ("document_question_answering", document_question_answering),
        ("validate_output", validate_output),
        ("persist_result", persist_result),
    ]:
        graph.add_node(name, node)
    graph.add_edge(START, "validate_input")
    graph.add_edge("validate_input", "load_context")
    graph.add_edge("load_context", "classify_intent")
    graph.add_conditional_edges(
        "classify_intent",
        lambda s: s["intent"],
        {
            "chat": "conversational_response",
            "meeting": "meeting_notes_workflow",
            "document": "document_question_answering",
        },
    )
    for name in ["conversational_response", "meeting_notes_workflow", "document_question_answering"]:
        graph.add_edge(name, "validate_output")
    graph.add_edge("validate_output", "persist_result")
    graph.add_edge("persist_result", END)
    return graph.compile()
