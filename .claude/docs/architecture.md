# Architecture — Components, Data Flow, Caching, Resilience

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** choosing Server vs Client boundaries, adding a route/Server Action/Route Handler, deciding caching, or designing degradation behaviour.
> Related: `security.md` (auth + validation rules), `anti-patterns.md` (AP-1, AP-2, AP-3, AP-7), `project-context.md` (route + data-layer inventory).

---

## Server Components vs Client Components

### The Decision Rule

```
                    ┌─────────────────────────────────┐
                    │ Does it need interactivity?      │
                    │ (state, effects, events, browser │
                    │  APIs, or client-only libraries) │
                    └──────────────┬──────────────────┘
                           │               │
                          Yes             No
                           │               │
                           ▼               ▼
                    Client Component   Server Component
                    (add 'use client') (default, no directive)
```

### Server Components (Default)

- **Always start here.** All components are Server Components by default in App Router.
- Fetch data directly with `async/await`. No `useEffect` + `useState` for data fetching.
- Access databases, file systems, and backend services directly.
- Keep secrets, tokens, and sensitive logic on the server.
- Cannot use: React hooks (`useState`, `useEffect`, etc.), browser APIs (`window`, `document`), event handlers (`onClick`, `onChange`), or client-only libraries.

```tsx
// ✅ Server Component — direct async data fetch, zero client JS
export default async function UserProfile({ userId }: { userId: string }) {
  const user = await db.user.findUnique({ where: { id: userId } });
  return <ProfileCard user={user} />;
}
```

### Client Components (Explicit Opt-In)

- Add `'use client'` **only** when you need interactivity.
- Keep the boundary **as low as possible** in the component tree — mark leaf components, not entire pages.
- Props passed from Server to Client Components must be **serializable** (strings, numbers, plain objects — not functions, Dates, or class instances).

```tsx
// ✅ Client Component — only the interactive leaf is marked
'use client';
export function FavoriteButton({ postId }: { postId: string }) {
  const [isFavorite, setIsFavorite] = useState(false);
  return <button onClick={() => setIsFavorite(!isFavorite)}>★</button>;
}
```

### Composition Patterns

- **Server Components can import Client Components.** The reverse is not true, but you can pass Server Components as `children` or `slots` to Client Components.
- **Context providers** must be Client Components. Place them in a dedicated wrapper file, import into a Server Component layout, and wrap only the subtree that needs them — never the entire `<html>`.
- **Moving Client Components down the tree** is the #1 technique to reduce JS bundle size. A `'use client'` on a leaf button ships far less JS than on an entire layout.

---

## Data Fetching & Mutations

### Fetching Data

- **Fetch in Server Components** using native `fetch` or your data layer directly. Never fetch in `useEffect`.
- **Parallel fetches** with `Promise.all()` to eliminate request waterfalls:

```tsx
// ✅ Parallel — both start simultaneously
const [user, posts] = await Promise.all([
  getUser(userId),
  getPostsByUser(userId),
]);
```

- **Stream with `<Suspense>`** — wrap sections that depend on slow data so the rest of the page renders immediately.
- **Proper error handling** — every async fetch must handle errors. Use `error.tsx` boundaries for route-level errors; `try/catch` for component-level.

### Mutations (Server Actions)

- **Use Server Actions** (`'use server'`) for all form submissions and data mutations.
- **Every Server Action must independently verify authentication and authorization** — treat them as public API endpoints. Never trust that the page component already checked auth.

```tsx
// ✅ Server Action with full auth + validation
'use server';
export async function deletePost(postId: string) {
  const session = await getSession();                       // 1. Authenticate
  if (!session?.user) throw new Error('Unauthorized');
  const post = await db.post.findUnique({ where: { id: postId } });
  if (post.authorId !== session.user.id) throw new Error('Forbidden'); // 2. Authorize
  const parsed = z.string().uuid().safeParse(postId);   // 3. Validate input
  if (!parsed.success) throw new Error('Invalid input');
  await db.post.delete({ where: { id: parsed.data } }); // 4. Execute
  revalidatePath('/posts');                              // 5. Refresh cache
}
```

- **Revalidate after mutation**: call `revalidatePath()` or `revalidateTag()` to purge stale caches.
- **Use `useActionState`** (React 19) or `useTransition` for loading/pending states during mutations.
- **Design rate-limiter-ready** (ISO A.12.6): Server Actions that handle authentication, payments, file uploads, or other sensitive operations should be structured so a rate limiter can be added without rework. **Rate limiting is required for future use, but not mandatory for now** (deferred by project decision, 2026-08-21).

### Route Handlers

- Use only for external webhooks, API callbacks, or when you need to expose a REST endpoint.
- **Never call Route Handlers from Server Components.** Share a data layer in `lib/` instead.
- Apply the same authentication + authorization + validation pattern as Server Actions.
- Existing routes: `api/session`, `api/upsert-invoice`, `api/update-dealer-limit` (protected by `DEALER_API_SECRET_KEY`), `api/create-dealer`, `api/get-dealer-id`, `api/upcoming-payments` — follow their established patterns when adding new ones.

---

## Caching

Next.js has four caching layers. Understand each one:

| Cache | What it stores | Where | Duration | Control |
|---|---|---|---|---|
| **Request Memoization** | Duplicate `fetch` calls within one render | Server | One render pass | Automatic (no opt-out needed) |
| **Data Cache** | `fetch` responses across requests | Server | Persistent (opt-in in v15) | `cache: 'force-cache'` / `revalidate` |
| **Full Route Cache** | Rendered HTML + RSC payloads | Server | Persistent | ISR via `revalidate` |
| **Router Cache** | RSC payloads per route segment | Client | Session / time-based | `revalidatePath()` / `router.refresh()` |

### Caching Rules

- **Next.js 15 defaults to `no-store`** for fetch. Explicitly opt into caching where safe.
- Cache data that changes infrequently (config, reference data, static content).
- Never cache: authentication state, user-specific sensitive data, real-time data.
- **`revalidateTag()`** for on-demand invalidation is preferred over time-based `revalidate`.
- Mark cached Server Components with a cache tag so they can be invalidated selectively:

```tsx
// ✅ Opt-in caching with tag for targeted revalidation
const data = await fetch('https://api.example.com/config', {
  next: { tags: ['config'] },
});
```

---

## Architecture — Must Answer Before Coding

**Never generate code until architecture is approved.**

Answer all 10 questions before writing a single line:

1. **What existing components can be reused?** — Check shared UI components, hooks, utilities.
2. **What existing hooks can be extended?** — Can you add a parameter instead of creating a new hook?
3. **Should this be a Server or Client Component?** — Default server; justify every `'use client'`.
4. **Is duplicate logic being introduced?** — If two features do similar things, extract a shared hook or utility now.
5. **Can this become generic?** — Will you need this again? If yes, parameterize it.
6. **Where does the data live?** — Server Component fetch? Route Handler? Client-side SWR/TanStack Query?
7. **What is the loading state?** — Every async component needs a `<Suspense>` fallback or `loading.tsx`.
8. **What is the error state?** — Every async operation needs an `error.tsx` boundary or try/catch.
9. **Is this accessible?** — Keyboard navigation? Screen reader labels? Color contrast? Focus management?
10. **Is there a simpler architecture?** — Step back. What's the minimal code that solves this?

Output your architecture as:

```
New files:          [list with paths]
Modified files:     [list with paths]
Shared components:  [components/hooks used by 2+ features]
Component type:     [Server Component / Client Component — justify if client]
Data flow:          [Page → Server Component → data layer → DB/API → rendered]
Loading strategy:   [Suspense boundary at <location>, skeleton type]
Error strategy:     [error.tsx / try-catch at <location>]
```

---

## Resilience Patterns (ISO A.16.1)

### Graceful Degradation

- **Firestore unavailable:** Show cached data with a "stale data" banner; queue writes for retry.
- **AI flows unavailable:** Show sensible defaults; **never block the core UI on AI** (risk assessment, invoice extraction, ask-anything must all degrade).
- **Email unavailable:** Queue for retry; show "email queued" status.

### Circuit Breaker (External Services)

For calls to AI (Genkit), email (SMTP), and external APIs:
- Timeout (max 10s for AI, 5s for email)
- Retry with exponential backoff (max 3 attempts)
- Fallback behavior (degraded UI, not a crash)

### Error Boundaries (Required)

Every route segment must have an `error.tsx` boundary. The root layout must have a global error boundary.
