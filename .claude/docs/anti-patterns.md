# Anti-Patterns — Never Do These

> Part of the CLAUDE.md guideline set. Index: `../../CLAUDE.md`
> **Read when:** reviewing code, or before declaring work done.
> Canonical rules live in `architecture.md`, `security.md`, and `frontend.md`. Each entry below shows the failure and points to the rule that owns it.

---

### AP-1: `useEffect` for Data Fetching

```tsx
// ❌ Fetching in useEffect — waterfall, no SSR, flash of empty state
const [data, setData] = useState(null);
useEffect(() => { fetch('/api/data').then(r => r.json()).then(setData); }, []);

// ✅ Fetch in Server Component — zero client JS, SSR, no flash
export default async function Page() {
  const data = await fetchData();
  return <UI data={data} />;
}
```

**Canonical rule:** `architecture.md` § Data Fetching & Mutations.

### AP-2: Entire Page as Client Component

```tsx
// ❌ 'use client' at the page root — entire page ships as JS
'use client';
export default function DashboardPage() { /* ... */ }

// ✅ Push 'use client' to interactive leaves only
// page.tsx (Server Component)
export default function DashboardPage() {
  return (
    <DashboardLayout>
      <DashboardChart />     {/* Client Component */}
      <DashboardTable />     {/* Server Component */}
    </DashboardLayout>
  );
}
```

**Canonical rule:** `architecture.md` § Server Components vs Client Components.

### AP-3: Auth Only at Layout Level

```tsx
// ❌ Only checking auth in layout — Server Actions remain unprotected
// layout.tsx: const user = await getCurrentUser(); if (!user) redirect('/login');
```

Auth must be re-verified **inside** every Server Action — a layout check does not protect them.

**Canonical rule + full pattern:** `architecture.md` § Mutations (Server Actions).

### AP-4: No Loading or Error States

```tsx
// ❌ No loading state — user sees blank page while data loads
// ❌ No error state — unhandled rejection crashes the entire page

// ✅ Every async page gets loading.tsx + error.tsx
// app/dashboard/
//   page.tsx      (fetches data)
//   loading.tsx   (skeleton shown while data loads)
//   error.tsx     (error UI shown on failure)
```

**Canonical rule:** `architecture.md` § Architecture — Must Answer Before Coding (Q7, Q8).

### AP-5: Exposing Secrets to Client

```tsx
// ❌ NEXT_PUBLIC_ on secrets — visible in browser DevTools
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

// ❌ Passing secrets as props from Server to Client Component
<UserProfile apiKey={process.env.SECRET_KEY} />;

// ✅ Secrets stay server-only. Client gets only the data it needs.
```

**Canonical rule:** `security.md` § Secrets & Environment.

### AP-6: Raw `<img>` Instead of `next/image`

```tsx
// ❌ Raw img — no optimization, CLS-causing, no lazy loading
<img src="/hero.jpg" alt="Hero" />

// ✅ next/image — automatic optimization, no CLS, lazy by default
<Image src="/hero.jpg" alt="Hero" width={1200} height={630} priority />
```

**Canonical rule:** `frontend.md` § Image Optimization.

### AP-7: Non-Serializable Props Across the Boundary

```tsx
// ❌ Passing a Date to a Client Component — will be serialized to string
<ClientComponent createdAt={new Date()} />

// ✅ Pass serializable values only. Convert Dates before the boundary.
<ClientComponent createdAt={post.createdAt.toISOString()} />
```

**Canonical rule:** `architecture.md` § Client Components (Explicit Opt-In).

### AP-8: Inline Form Handling Without Validation

```tsx
// ❌ No validation, no auth — directly inserting user input
await db.comment.create({ data: { body: formData.get('body') } });

// ✅ Zod validation + auth before any DB operation
const schema = z.object({ body: z.string().min(1).max(1000) });
const { body } = schema.parse(Object.fromEntries(formData));
const user = await getSession();
if (!user) throw new Error('Unauthorized');
await db.comment.create({ data: { body, authorId: user.id } });
```

**Canonical rule:** `security.md` § Input Validation; `architecture.md` § Mutations (Server Actions).

### AP-9: Base64 Blobs in Firestore

```tsx
// ❌ Base64 file content in Firestore — exceeds the 1 MiB document cap, breaks consent flow
await setDoc(doc(db1, 'invoiceConsents', id), { file: dataUrl }); // dataUrl can be 100s of KB

// ✅ Upload to Firebase Storage, store only the download URL in Firestore
const ref = storageRef(storage, `consents/${userId}/${fileId}`);
await uploadString(ref, base64, 'base64');
await setDoc(doc(db1, 'invoiceConsents', id), { fileUrl: getDownloadURL(ref) });
```

**Canonical rule:** `security.md` § Known Security Gaps.

### AP-10: Leaking Raw Errors to the Client

```tsx
// ❌ Raw error.message can leak internals, stack traces, DB details (OWASP info disclosure)
catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }

// ✅ Sanitized message to client, full detail logged server-side
catch (error) {
  console.error('[corr-id] create failed', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}
```

**Canonical rule:** `security.md` § Error Sanitization.

### AP-11: Auth Tokens in localStorage / sessionStorage

```tsx
// ❌ XSS can read tokens from storage — session hijacking
localStorage.setItem('token', idToken);

// ✅ httpOnly cookies (iron-session) — JS cannot read them, XSS cannot steal them
```

**Canonical rule:** `security.md` § Authentication & Authorization.
