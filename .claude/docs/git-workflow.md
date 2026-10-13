# Git Workflow — Industry Standard

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** branching, committing, squashing, or pushing.

---

## Branch Context

- Default branch: `master`. Current working branch: `live`. Staging: `UAT`. Feature work happens on dedicated branches (e.g., `enterprise`, `anchor-portal`).
- `firestore.rules` and environment-specific configs are branch-sensitive — when moving code across branches, ensure config files don't travel with it.

## Rules (Non-Negotiable)

| Rule | Description |
|------|-------------|
| **Pull before ANY code** | `git pull origin <active-branch>` BEFORE starting any change. Never write code on stale code. If pull fails, STOP — resolve the pull first, then proceed |
| **Conventional prefixes** | `fix:`, `feat:`, `perf:`, `docs:`, `build:`, `refactor:` — enables automated changelogs and clean history |
| **One commit per fix** | No WIP commits on shared branches. Iterative fixes to the same issue use `git commit --amend --no-edit` |
| **Push once, verified** | Only push after the change works locally — never push "attempt" commits |
| **Squash before pushing** | Squash multiple local WIP commits into one clean commit before pushing (`git rebase -i` / `git reset --soft HEAD~N`) |
| **Force-with-lease** | Use `--force-with-lease` when amending pushed commits — never bare `--force` |
