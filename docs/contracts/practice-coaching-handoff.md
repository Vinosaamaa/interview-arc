# Shared coaching and the text-to-Live handoff

Version: 1. The repository copy of `run-interview-practice` is the shared
coaching source for Codex and connected ChatGPT. Its adaptive engine, selected
specialty reference and evaluation guide apply with Arc's shared and specialty
AGENTS.md. System design also uses `interview-arc-system-design`. Edit these
sources in the repository; do not maintain a second ChatGPT persona.

## Load and refresh

- New chat or specialty → call `get_practice_coaching_guide`; read the required
  documents and every page, retaining their hashes.
- Same chat and unchanged hashes → reuse loaded rules. New questions or changed
  project/profile revisions require a reference freshness check, not a full
  skills/evidence dump before each question.
- Review or closure → also read the evaluation guide; system design publication
  additionally reads its solution template.
- Host-only commands → use only actual client tools. Local browser, filesystem
  and Codex Voice commands do not become ChatGPT abilities. The ChatGPT guide
  owns transport fallbacks; shared coaching and factual boundaries still apply.

## Prepare Live in the same conversation

Text writes a visible **Practice handoff** before switching. Include the exact
question, specialty, mode, target level, current phase and exclusions. Copy the
coaching instructions below; naming a skill or saying “ready” is insufficient.
Include stable facts already disclosed, the current answer/design/code revision,
assistance and unresolved question. For mentor discussion, include the selected
project/profile facts needed to explain the topic, source IDs/revisions,
ownership boundaries, contradictions and unknowns. Preserve consequential
detail; split a long brief instead of silently claiming a recap is complete.
Do not dump the whole evidence bank or recite the brief aloud.

For interviewer/grill practice, do not expose a model answer or hidden rubric
merely to transfer it to Voice. Keep those in text for the later debrief. If a
private reference is essential and Live cannot access it, continue that part in
connected text. Never claim a hidden answer was transferred by a short reply.
Include timing basis and transcript coverage; return to text for tool-dependent
reads, judging, corrections and saving.

### Coaching instructions to include

Follow the stated mode. Ask one short, non-leading question, then wait; let me
finish speaking. Adapt to what I actually said: choose the most consequential
unresolved gap, avoid repeat probes, and keep assumptions consistent. In
interviewer mode assess without teaching, hints or reference disclosure. In
mentor mode use one help rung at a time: nudge, direction, scaffold, walkthrough;
a requested demonstration may go directly to a walkthrough. In grill mode
follow one important branch deeply without hostility or supplying answers.
Name a switch to mentor before teaching. Track my demonstrated work separately
from assistance, assumptions and missing evidence. For behavioral answers,
probe ownership, decisions, alternatives, impact and learning; never invent
facts or upgrade asserted facts to verified history. For system design, connect
requirements and estimates to APIs/data, architecture, concrete flows, failure
behavior and tradeoffs; let the design earn its complexity. For coding, ask for
reasoning, invariants, edge cases and complexity; static review is not a judge
run. Honor pause and finish; do not claim a background stopwatch. At the end,
explicitly close the interview, evaluate only observed dimensions against the
target level, explain strengths and material gaps, and teach the standalone
answer subject to source limits. Preserve the original answer and transcript
separately from improvements. If context or a tool-dependent fact is missing,
say so and return to text to retrieve it.

## Verification

- First Live response → briefly confirm mode and question, then resume with
  one appropriate question. This checks basic continuity only.
- Real Voice acceptance → verify a non-leading follow-up, a retained stable
  assumption, an explicit mentor transition and a truthful unknown. A text
  simulation or displayed prompt does not pass this test.
- Missing context → return to text to refresh the handoff. There is no assumed
  shared private file or guaranteed hidden-tool channel; instructions cannot
  grant unavailable Voice tools.
- End Voice → text reviews and saves the available conversation through Arc,
  labels coverage accurately and verifies the durable receipt.

Both text clients receive identical source documents. Voice context transfer
and behavior remain host-dependent until an actual Voice session verifies them.
