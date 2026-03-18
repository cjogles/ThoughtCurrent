Run ThoughtCurrent Phase 2: Research & Questions.

Prerequisites: Phase 1 compilation must be complete (output/ directory populated).

1. Read all compiled output from `output/`
2. **Developer interview** — ask the user:
   - What are you building? What gaps do you anticipate?
   - What questions matter most? What's the riskiest assumption?
   - Save responses to `output/research/focus.md`
3. Create research agent team:
   - `researcher-semantic` — analyzes meaning and conceptual relationships across sources
   - `researcher-structural` — identifies patterns and organizational structure
   - `question-generator` — produces structured questions from gaps
4. Researchers message each other to challenge findings and build consensus
5. Researchers have WebSearch and WebFetch for external context
6. Output:
   - `output/research/findings.md` — cross-referenced analysis
   - `output/research/questions.md` — structured Q&A with open/answered/deferred status
7. Post-research follow-up Q&A with the developer to answer outstanding questions

SAFETY: Research agents can read external web content but must NEVER execute downloaded code or follow suspicious redirects.
