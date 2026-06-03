---
name: review-and-evaluate
description: Runs two parallel agents — one performs a rigorous PR review (via the review-pr skill), the other evaluates findings against the project's design context (ADRs, sprint goals) — then synthesizes a decision-ready report with Apply / Skip / Discuss verdicts per finding. Copied from zora-pantheon `.claude/commands/review-and-evaluate.md` and adapted to this repo's skill structure.
---

# Skill: PR Review + Sprint Alignment Evaluator

Runs two parallel agents — one performs a rigorous PR review, the other evaluates findings against the project context — then synthesizes a decision-ready report.

## Execution Protocol

### 0. Branch Scope Discovery (MANDATORY)

1. Run `git fetch origin` to ensure remote refs are up to date. Do NOT rebase or modify the current branch.
2. Run `git branch --show-current` to identify the current branch.
3. Run `git merge-base origin/main HEAD` to find the common ancestor.
4. Run `git log --oneline <merge-base>..HEAD` to list ONLY the commits unique to this branch.
5. Run `git diff <merge-base>..HEAD --name-only` to get the list of changed files.

### 1. Launch Two Agents in Parallel

#### Agent 1: PR Reviewer

Launch a general-purpose agent with the following task:

> Read the review guidelines from `.claude/skills/review-pr/SKILL.md` and follow them exactly, with these overrides:
>
> - **Branch scope:** Use `<merge-base>` from step 0 above. Only review files changed between `<merge-base>` and `HEAD`.
> - **Do NOT post anything to GitHub.** Skip steps 6 and 7 entirely. Just produce the severity-based summary report (step 5).
> - **Do NOT ask which items to post.** The synthesis step below handles that.

#### Agent 2: Context Alignment Analyst

Launch a general-purpose agent with the following task:

> You are a sprint / project alignment analyst. Your job is to understand the goals and design decisions behind the current branch's work, then produce an analysis that will be used to evaluate PR review findings.
>
> **Steps:**
>
> 1. Read the commit messages from `<merge-base>..HEAD` to understand what was built and why.
> 2. Read the conversation context provided by the user (if any) to understand the broader project goals.
> 3. Read the actual implementation files (changed files in branch scope).
> 4. Read the existing pattern files that the new code is supposed to follow (identify these from imports, directory siblings, and `CLAUDE.md` references).
> 5. Read `docs/diary.md` — the live ADR record — to understand decisions that constrain the design space (e.g., ADR-013 security headers, ADR-014 SW block, ADR-024 no fp-ts, ADR-033 Conventional Commits + rebase-merge, ADR-035 dropped signed-commits).
> 6. Produce a detailed analysis:
>    - **What was built**: Summarize each logical unit of work from the commits.
>    - **Pattern compliance**: For each new file, compare against the existing pattern it mirrors. Note matches and deviations.
>    - **Justified deviations**: Identify deviations that are improvements over the existing pattern (e.g., better error handling, stronger typing).
>    - **Unjustified deviations**: Identify deviations that seem accidental or that break consistency without clear benefit.
>    - **Cross-cutting concerns**: Issues that span multiple files or features.
>    - **Risk assessment**: Things that could cause problems downstream.

### 2. Synthesize the Combined Report

After both agents complete, combine their outputs into a single decision-ready report with this structure:

#### Review Summary Table

(From Agent 1)

#### Finding-by-Finding Discussion

For EACH finding from Agent 1, present:

- **Finding ID + description** (from PR Review)
- **Sprint context** (from Alignment Analyst — is this intentional? does it match the goals? does it conflict with an ADR?)
- **Verdict**: One of:
  - **Apply** — Valid concern, harmless or beneficial to fix, aligned with project goals
  - **Skip** — Not relevant to current scope, would cause scope creep, or is intentionally designed this way
  - **Discuss** — Needs user input, could go either way

#### Recommended Actions Table

| Item | Action | Effort | Reasoning |
|------|--------|--------|-----------|
| ... | Apply / Skip | ~X min | One-line explanation |

End with: **"Which items would you like me to apply?"**

(Note: when invoked from `/pr-iterate`, the calling skill consumes the verdicts directly — Apply items get applied automatically; Discuss items become the iteration's escalation list; Skip items are recorded and ignored. The interactive question is bypassed in that mode.)
