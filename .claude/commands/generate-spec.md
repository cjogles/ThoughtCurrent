Run ThoughtCurrent Phase 3: Spec & Task Generation.

Prerequisites: Phase 1 compilation and Phase 2 research must be complete.

1. Read all output: `output/`, `output/research/`
2. Generate constitution — immutable project principles → `output/specs/constitution.md`
3. **Specification generation** (spec-kit patterns):
   - User scenarios with Given/When/Then acceptance criteria
   - Numbered functional requirements (FR-###) traceable to research findings (RF-###)
   - Measurable success criteria (SC-###)
   - Clarification pass: scan for ambiguity, ask max 5 questions, integrate answers
4. **Complexity analysis**:
   - Score each spec section 1-10
   - Generate expansionPrompt per complex section
5. **Task decomposition** (Task Master patterns):
   - Generate 10-25 coarse parent tasks, dependency-ordered
   - Expand complex tasks (score > 5) into 3-7 subtasks each
   - Dependencies only reference lower IDs (no circular refs)
   - Each task: id, title, description, status, dependencies, priority, details, testStrategy
6. **Quality validation**:
   - Cross-artifact consistency (duplication, ambiguity, coverage gaps)
   - Checklist pass for requirement completeness
   - Traceability chain: RF-### → FR-### → T-### → CHK-###
7. Output:
   - `output/specs/spec.md`
   - `output/specs/tasks.md`
   - `output/.meta/summaries.json` (updated with AI summary cards)

All output is local markdown. User creates GitHub issues manually from the GUI.
