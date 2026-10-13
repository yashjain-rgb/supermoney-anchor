# Testing

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** writing or planning tests, or adding a new endpoint/Server Action that needs security coverage.
> Related: `security.md` (401/403/400 requirements), `self-review.md` (per-change checklist).

---

## What to Test

- **Unit tests**: Utility functions, hooks, validation schemas. Fast, no DOM.
- **Component tests**: UI rendering, user interactions, accessibility. Use React Testing Library.
- **Integration tests**: Critical user flows (login → create → edit → delete).
- **Security tests** (VAPT-ready): verify 401 (unauthenticated), 403 (RBAC denial), 400 (validation rejection) for every endpoint and Server Action.
- **E2E tests**: Smoke-test the happy paths in production-like environment. Use Playwright.

## Testing Rules

- Test behavior, not implementation. Refactoring internals shouldn't break tests.
- Prefer `getByRole`, `getByLabelText`, `getByText` over `getByTestId`.
- Test loading, success, and error states for every data-dependent component.
- Test accessibility: `expect(button).toHaveAccessibleName()`.
- Minimum coverage: 80% for utilities, 60% for components. Focus on critical paths.
- Run tests before every commit. CI must block merge on test failure.

## Current State (Honest)

- No test suite exists yet (`src/__tests__/` absent). When adding tests, use Vitest + React Testing Library (the CRM project `supermoney-crm-web` already has this setup — reuse its patterns).
