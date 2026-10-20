import { useEffect, useState } from "react";
import { Download, FileText, Plus, Sparkles, Trash2, Save } from "lucide-react";
import { api, json } from "../services/api";
import type { Notes, Session } from "../types";
export function notesMarkdown(title: string, n: Notes) {
  const list = (heading: string, items: string[]) =>
    `\n## ${heading}\n${items.map((s) => `- ${s}`).join("\n") || "_None recorded._"}\n`;
  return (
    `# ${title}\n\n${n.summary}\n` +
    list("Key points", n.key_points) +
    list("Concepts & definitions", n.concepts) +
    list("Decisions", n.decisions) +
    `\n## Action items\n${n.action_items.map((a) => `- [${a.status === "done" ? "x" : " "}] ${a.description} (Owner: ${a.owner || "Unassigned"}; deadline: ${a.deadline || "Not stated"}; status: ${a.status})\n  Evidence: “${a.evidence}”`).join("\n") || "_None recorded._"}\n` +
    list("Open questions", n.open_questions) +
    list("Follow-up topics", n.follow_up_topics) +
    list("Uncertainties", n.uncertainties)
  );
}
export function Meetings({
  meeting,
  setMeeting,
  busy,
  configured,
  perform,
  composer,
}: {
  meeting: Session | null;
  setMeeting: (s: Session | null) => void;
  busy: boolean;
  configured: boolean;
  perform: (fn: () => Promise<void>) => void;
  composer: React.ReactNode;
}) {
  const [items, setItems] = useState<Session[]>([]),
    [title, setTitle] = useState(""),
    [edit, setEdit] = useState<Notes | null>(null);
  const refresh = async () => setItems(await api<Session[]>("/meetings"));
  useEffect(() => {
    perform(refresh);
  }, []); // initial data; all mutations explicitly refresh
  useEffect(
    () => setEdit(meeting?.notes ? structuredClone(meeting.notes) : null),
    [meeting],
  );
  const generate = () =>
    perform(async () => {
      if (!meeting) return;
      const notes = await api<Notes>(`/meetings/${meeting.id}/summarize`, {
        method: "POST",
      });
      setMeeting({ ...meeting, notes });
      await refresh();
    });
  const exportNotes = () => {
    if (!edit || !meeting) return;
    const url = URL.createObjectURL(
      new Blob([notesMarkdown(meeting.title, edit)], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "voxpilot-notes.md";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">FROM CONVERSATION TO CLARITY</span>
          <h2>Meeting intelligence</h2>
          <p className="muted">Capture the discussion. Keep the decisions.</p>
        </div>
        <FileText className="heading-icon" size={36} />
      </div>
      <div className="meeting-bar">
        <input
          aria-label="New meeting title"
          placeholder="Meeting or lecture title"
          value={title}
          maxLength={150}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            perform(async () => {
              const next = await api<Session>("/meetings", {
                method: "POST",
                body: json({ title: title.trim() || "Untitled meeting" }),
              });
              setMeeting(next);
              setTitle("");
              await refresh();
            })
          }
        >
          <Plus size={16} />
          New meeting
        </button>
      </div>
      <div className="meeting-layout">
        <aside className="panel meeting-list">
          <h3>Your meetings</h3>
          {items.length === 0 && (
            <p className="muted small">
              Create a meeting to start collecting transcripts.
            </p>
          )}
          {items.map((item) =>
            new Date(item.expires_at) <= new Date() ? (
              <div className="expired-item" key={item.id}>
                <span>
                  {item.title}
                  <small>Expired</small>
                </span>
                <button
                  className="icon-button danger"
                  aria-label={`Delete expired meeting ${item.title}`}
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      await api(`/meetings/${item.id}`, { method: "DELETE" });
                      if (meeting?.id === item.id) setMeeting(null);
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <button
                className={`session-item ${meeting?.id === item.id ? "selected" : ""}`}
                key={item.id}
                disabled={busy}
                onClick={() =>
                  perform(async () =>
                    setMeeting(await api<Session>(`/meetings/${item.id}`)),
                  )
                }
              >
                <FileText size={16} />
                <span>
                  {item.title}
                  <small>
                    {new Date(item.created_at).toLocaleDateString()}
                  </small>
                </span>
              </button>
            ),
          )}
        </aside>
        <div>
          {meeting ? (
            <>
              <div className="panel transcript-panel">
                <div className="panel-header">
                  <h3>{meeting.title}</h3>
                  <button
                    className="icon-button danger"
                    aria-label="Delete meeting"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        await api(`/meetings/${meeting.id}`, {
                          method: "DELETE",
                        });
                        setMeeting(null);
                        await refresh();
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="transcript">
                  {meeting.transcript ||
                    "Finalized transcript segments will appear here after you review and add them."}
                </div>
                <div className="panel-footer">
                  <span className="small muted">
                    {meeting.transcript.split(/\s+/).filter(Boolean).length}{" "}
                    words · No raw audio stored
                  </span>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !configured ||
                      meeting.transcript.split(/\s+/).filter(Boolean).length <
                        20
                    }
                    onClick={generate}
                  >
                    <Sparkles size={16} />
                    Finish & generate notes
                  </button>
                </div>
              </div>
              {composer}
            </>
          ) : (
            <div className="panel empty">
              <FileText size={32} />
              <h3>A place for your next big idea</h3>
              <p>
                Create or select a meeting, then add reviewed transcript
                segments.
              </p>
            </div>
          )}
          {edit && meeting && (
            <div className="panel notes">
              <div className="panel-header">
                <h3>
                  Your notes <span className="badge">Editable</span>
                </h3>
                <button className="secondary" onClick={exportNotes}>
                  <Download size={15} />
                  Markdown
                </button>
              </div>
              <label>
                Summary
                <textarea
                  rows={4}
                  value={edit.summary}
                  onChange={(e) =>
                    setEdit({ ...edit, summary: e.target.value })
                  }
                />
              </label>
              {(
                [
                  "key_points",
                  "concepts",
                  "decisions",
                  "open_questions",
                  "follow_up_topics",
                  "uncertainties",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {key.replaceAll("_", " ")}
                  <textarea
                    rows={2}
                    value={edit[key].join("\n")}
                    onChange={(e) =>
                      setEdit({ ...edit, [key]: e.target.value.split("\n") })
                    }
                  />
                  <small className="muted">
                    One item per line. Leave blank when not stated.
                  </small>
                </label>
              ))}
              <h4>Action items</h4>
              {edit.action_items.map((action, index) => (
                <div className="action-edit" key={index}>
                  <label>
                    Description
                    <input
                      value={action.description}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          action_items: edit.action_items.map((a, i) =>
                            i === index
                              ? { ...a, description: e.target.value }
                              : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="two-col">
                    {(["owner", "deadline"] as const).map((key) => (
                      <label key={key}>
                        {key}
                        <input
                          placeholder="Not stated"
                          value={action[key] || ""}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              action_items: edit.action_items.map((a, i) =>
                                i === index
                                  ? { ...a, [key]: e.target.value || null }
                                  : a,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    Supporting transcript quote
                    <textarea
                      value={action.evidence}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          action_items: edit.action_items.map((a, i) =>
                            i === index
                              ? { ...a, evidence: e.target.value }
                              : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Status
                    <select
                      value={action.status}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          action_items: edit.action_items.map((a, i) =>
                            i === index
                              ? {
                                  ...a,
                                  status: e.target.value as typeof a.status,
                                }
                              : a,
                          ),
                        })
                      }
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                  </label>
                  <button
                    className="text-button danger"
                    onClick={() =>
                      setEdit({
                        ...edit,
                        action_items: edit.action_items.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove action
                  </button>
                </div>
              ))}
              <button
                className="secondary"
                onClick={() =>
                  setEdit({
                    ...edit,
                    action_items: [
                      ...edit.action_items,
                      {
                        description: "",
                        owner: null,
                        deadline: null,
                        status: "open",
                        evidence: "",
                      },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Add action item
              </button>
              <p className="small muted">
                Generated facts are constrained by the transcript. Your manual
                edits are saved as supplied; review their accuracy.
              </p>
              <div className="panel-footer">
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      await api(`/meetings/${meeting.id}/notes`, {
                        method: "DELETE",
                      });
                      setMeeting({ ...meeting, notes: null });
                    })
                  }
                >
                  <Trash2 size={15} />
                  Delete notes
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      const clean = { ...edit };
                      for (const key of [
                        "key_points",
                        "concepts",
                        "decisions",
                        "open_questions",
                        "follow_up_topics",
                        "uncertainties",
                      ] as const)
                        clean[key] = clean[key].filter((s) => s.trim());
                      const saved = await api<Notes>(
                        `/meetings/${meeting.id}/notes`,
                        { method: "PATCH", body: json(clean) },
                      );
                      setMeeting({ ...meeting, notes: saved });
                    })
                  }
                >
                  <Save size={15} />
                  Save changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
