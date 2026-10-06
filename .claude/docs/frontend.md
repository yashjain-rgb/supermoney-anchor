# Frontend — Performance, TypeScript, Accessibility

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** building UI, optimizing images/fonts/bundle, writing TypeScript types, or implementing interactive components.
> Related: `architecture.md` (component boundaries drive bundle size), `anti-patterns.md` (AP-2, AP-6, AP-7).

---

## Performance

### Core Web Vitals Targets

| Metric | Target | What it measures |
|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤ 2.5s | Main content loading speed |
| **CLS** (Cumulative Layout Shift) | < 0.1 | Visual stability |
| **INP** (Interaction to Next Paint) | < 200ms | Responsiveness to user input |

### Image Optimization

- **Always use `next/image`** — never raw `<img>` tags. Automatic WebP/AVIF conversion, lazy loading, and size optimization.
- Mark hero/above-fold images as **`priority`** to preload LCP content.
- Always provide explicit **`width`** and **`height`** to prevent CLS.
- Use **`sizes`** prop for responsive images to serve device-appropriate variants.
- Add remote image domains to `images.remotePatterns` in `next.config.ts`.

```tsx
// ✅ Properly optimized image
<Image
  src="/hero.jpg"
  alt="Product hero image"
  width={1200}
  height={630}
  priority            // Preloads LCP image
  sizes="(max-width: 768px) 100vw, 50vw"
/>
```

### Font Optimization

- **Host fonts locally.** Avoid Google Fonts CDN — local fonts eliminate third-party latency and simplify CSP.
- Use **`next/font`** with `subset` for automatic font subsetting.
- Limit to one variable font file. Each additional weight/style adds download cost.
- Set `display: 'swap'` to prevent invisible text during loading (FOIT).

### JavaScript Bundle

- **Keep Client Components to a minimum.** Every `'use client'` boundary adds JS to the bundle.
- Use **`next/dynamic`** with `ssr: false` for heavy, non-critical components (charts, rich text editors, maps).
- Use **`<Script strategy="lazyOnload">`** for third-party analytics, chatbots, and marketing scripts.
- Avoid barrel files (`index.ts` re-exporting everything) — they defeat tree-shaking. Import directly from the source file.
- **Audit your bundle** with `@next/bundle-analyzer` before every production deploy.

### Rendering Strategy

- **SSG** (Static Site Generation): For content that rarely changes. Near-instant LCP.
- **ISR** (Incremental Static Regeneration): For content that changes occasionally. Good balance of freshness and speed.
- **SSR** (Server-Side Rendering): For personalized, real-time content. Set appropriate `Cache-Control` headers.
- **Streaming** with `<Suspense>`: For pages where some sections are slow. Users see content progressively.

---

## TypeScript — Non-Negotiable Rules

- **`strict: true`** in `tsconfig.json`. No exceptions for production code.
- **No `any`** without an explicit `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment justifying why. Use `unknown` + type guards instead.
- **Use `interface` for component props**, `type` for unions, intersections, and utility types.
- **Discriminated unions for async state** — replace multiple booleans with a single status:

```tsx
// ❌ Multiple booleans — impossible states possible
{ isLoading, isError, data }

// ✅ Discriminated union — exactly one state at a time
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };
```

- **Explicit return types for hooks**: `function useAuth(): UseAuthResult { ... }`
- **`satisfies` for exhaustive config objects**: `const routes = { ... } as const satisfies Record<string, Route>;`
- **`never` for exhaustiveness checks** in switch/conditional statements.

---

## Accessibility (WCAG 2.2 AA Minimum)

- **Semantic HTML first.** Use `<button>`, `<nav>`, `<main>`, `<header>`, `<dialog>` — not `<div>` with click handlers.
- **Every interactive element is keyboard accessible.** Focus indicators must be visible (`:focus-visible`).
- **Every image has a meaningful `alt`** attribute. Decorative images use `alt=""`.
- **Every form input has an associated `<label>`**. Use `htmlFor` or wrap the input.
- **Color contrast** ratio ≥ 4.5:1 for text, ≥ 3:1 for large text. Test with axe DevTools.
- **Modal dialogs**: trap focus, close on Escape, return focus to trigger on close.
- **ARIA**: No ARIA is better than bad ARIA. Use native elements first. When you must use ARIA, audit with a screen reader.
- shadcn/ui components (Radix UI primitives) provide baseline accessibility — don't break it.
