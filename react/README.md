# @askdb/react

Ask your database questions, in React.

```bash
npm install @askdb/react
```

```tsx
import { AskDBWidget } from "@askdb/react"

export function Assistant({ user }) {
  return (
    <AskDBWidget
      publicKey="pk_live_…"
      apiUrl="https://askdb.example.com"
      user={{ id: user.id, hash: user.askdbHash }}
    />
  )
}
```

That is the launcher in the corner. Everything else on this page is a variation
on it.

## Three ways in

| | What it is | When |
|---|---|---|
| `<AskDBWidget/>` | The launcher and its popover | An assistant on top of your product |
| `<AskDBChat/>` | The same conversation, filling its container | A tab, a panel, a page of your own app |
| `useAskDB()` | The messages and the state, nothing drawn | You have a design system and want to use it |

They share one engine, so a fix in the stream reducer or the citation model
reaches all three at once — and reaches the script-tag widget too, which is the
same engine with a different renderer.

### `<AskDBChat/>`

Takes the size of its parent, so give the parent a height:

```tsx
<div style={{ height: 560 }}>
  <AskDBChat publicKey="pk_live_…" apiUrl="https://askdb.example.com" user={user} />
</div>
```

### `useAskDB()`

```tsx
const chat = useAskDB({ publicKey: "pk_live_…", apiUrl: "…", user })

chat.messages     // ChatMessage[] — text, charts, citations, steps, timing
chat.busy         // an answer is streaming
chat.status       // "idle" | "loading" | "ready" | "failed"
chat.capabilities // what this embed allows: threads, charts, citations, …
chat.look         // the resolved appearance, server defaults included
chat.threads      // past conversations
chat.remaining    // questions left in this session, or null when uncapped

chat.send("How many applications were funded last month?")
chat.stop()
chat.newThread()
chat.openThread(id)
chat.reset()
```

The pieces `<AskDBChat/>` draws are exported too — `Message`, `Composer`,
`Citations`, `Trace`, `Charts`, `ThreadList`, `Suggestions` — so you can keep
the two you like and write the rest.

## Two things that are not obvious

**The prop is `publicKey`, not `key`.** `key` is reserved by React: a prop by
that name is consumed by the reconciler and never reaches the component. It
would fail silently, and the developer would be looking at a key they could see
in their own JSX. `apiKey` is accepted as an alias.

**`apiUrl` is effectively required.** The script tag infers its host from its
own `src`; a bundled component has no tag to read. Leave it out and the
component asks your own origin for an embed that is not there.

## Identity

An embedded assistant answers questions about somebody's own data, so it only
answers signed-in users:

```ts
// On your server. The secret never goes near the browser.
const hash = crypto.createHmac("sha256", EMBED_SECRET).update(user.id).digest("hex")
```

The publishable key is safe in your bundle — it identifies the configuration
and grants nothing on its own. What the assistant may read is decided by the
RBAC role on the embed, server-side, on every request.

## Styling

By default everything renders inside a shadow root, so your CSS cannot reach
in and its CSS cannot reach out. That is what stops a `* { box-sizing }` rule
or a `button` reset from breaking it in a way you cannot reproduce.

Pass `isolate={false}` when you want the opposite — the assistant as part of
your own product, inheriting your typography. The same rules are then applied
through a scoping class.

Appearance comes from the embed's settings and can be overridden per mount:

```tsx
<AskDBWidget
  publicKey="pk_live_…"
  appearance={{ accent: tenant.brandColour, launcherLabel: "Ask the data" }}
  behaviour={{ autoOpen: true, openDelay: 3000 }}
/>
```

An override only replaces what it names. Fields you leave out keep the value
the embed's owner configured.

## Callbacks

```tsx
<AskDBWidget
  publicKey="pk_live_…"
  onReady={() => …}
  onOpen={() => …}
  onClose={() => …}
  onMessage={({ role, text }) => analytics.track("askdb_message", { role })}
  onError={(error) => Sentry.captureException(error)}
/>
```

Inline arrows are fine — they are read through a ref, so a new function on
every render does not count as a configuration change.

## Server-side rendering

The components render nothing until they are mounted in a browser, so they are
safe in a Next.js app directory tree as long as the file is a client component:

```tsx
"use client"
import { AskDBWidget } from "@askdb/react"
```
