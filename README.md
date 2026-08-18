# @askdb/widget

An embeddable chat assistant that answers questions about a database. Paste one
script tag; a visitor asks in plain English; the answer comes back streamed,
with the same guardrails the first-party product has.

```html
<script>
  (function (w, d) {
    w.askdb = w.askdb || function () { (w.askdb.q = w.askdb.q || []).push(arguments) };
    var s = d.createElement('script');
    s.src = 'https://your-askdb-host/embed.js'; s.async = 1;
    d.head.appendChild(s);
  })(window, document);

  askdb('init', { key: 'pk_live_…' });
</script>
```

That is the whole installation. Everything else has a default, set on the embed
in askdb, and the page can override any of it.

---

## What the key does, and does not, grant

The publishable key is **meant to be public** — it is in your HTML. On its own
it grants nothing except the right to start a conversation from an origin you
listed.

What a visitor may actually read is an ordinary **RBAC role**, chosen on the
embed's settings screen and granted tables on the Access screen like any other
role. There is no separate permission model for embeds, deliberately: if you
would not give a role to a contractor, do not give it to the internet.

Four things stand between the key and your data, and they are worth knowing in
order:

| | |
|---|---|
| **Role** | What the assistant can read at all. The one that matters. |
| **Origins** | Which sites may use the key. Checked server-side against `Origin`, on every request including the ones that carry a session token. |
| **Limits** | Messages per conversation and new conversations per hour, per embed. |
| **Identity** | Optional. See below. |

Turning the embed off in askdb stops it everywhere immediately, without anyone
touching the customer's page.

---

## Configuration

```js
askdb('init', {
  key: 'pk_live_…',            // required; everything else is optional
  apiUrl: 'https://askdb.acme.com',  // only for self-hosting

  appearance: {
    title: 'Acme Support',
    subtitle: 'Usually replies instantly',
    greeting: 'Hi — ask me anything about your orders.',
    accent: '#6d28d9',
    accentForeground: '#ffffff',
    position: 'right',          // 'left' | 'right'
    offset: 20,                 // px from the corner
    radius: 16,                 // px; 0 for square
    launcherLabel: 'Ask a question',
    launcherIcon: 'chat',       // 'chat' | 'sparkle' | 'question' | 'search'
    avatarUrl: 'https://acme.com/logo.png',
    placeholder: 'Ask a question…',
    suggestions: ['How many orders shipped last week?'],
    theme: 'system',            // 'light' | 'dark' | 'system'
    disclaimer: 'Answers come from live data.',
    showBranding: true,
    zIndex: 2147483000,
  },

  behaviour: {                  // `behavior` also accepted
    autoOpen: false,
    openDelay: 0,
    rememberState: true,        // keep open/closed across page loads
    focusOnOpen: true,          // ignored on small screens
    hideLauncher: false,        // drive it from your own button instead
  },

  user: { id: 'cus_4172', name: 'Priya', email: 'p@acme.com', hash: '…' },

  onReady:   () => {},
  onOpen:    () => {},
  onClose:   () => {},
  onMessage: (m) => {},         // { role, text } for both sides
  onError:   (e) => {},
})
```

Appearance set here **overrides** the embed's own defaults. That split is
deliberate: whoever owns the embed picks the greeting and the suggestions;
whoever owns the page picks where it sits, so it does not cover their cookie
banner.

### Methods

```js
askdb('open')                   // also 'show'
askdb('close')                  // also 'hide'
askdb('toggle')
askdb('send', 'How many accounts are open?')
askdb('update', { appearance: { accent: '#0f766e' } })
askdb('reset')                  // forget the conversation, start a new one
askdb('shutdown')               // remove every element and listener
```

`update` restyles a live widget without losing the conversation. Changing
`user.id` resets it, because a different person must not see the previous
person's answers.

---

## Identifying your visitors

If the page knows who is asking, tell the widget — and prove it:

```js
askdb('init', {
  key: 'pk_live_…',
  user: {
    id: 'cus_4172',
    name: 'Priya Raghunathan',
    hash: '<HMAC_SHA256(secret, "cus_4172"), hex>',
  },
})
```

Compute the hash **on your server**, with the signing secret from the embed's
settings. Never put the secret in the page.

```js
// Node
const hash = require('crypto')
  .createHmac('sha256', process.env.ASKDB_EMBED_SECRET)
  .update(user.id)
  .digest('hex')
```

```python
# Python
hash = hmac.new(secret.encode(), user_id.encode(), hashlib.sha256).hexdigest()
```

Without the hash, the page can claim to be any customer whose id somebody can
guess. Embeds reject unsigned ids unless you explicitly allow them, which is
only reasonable when the answer does not depend on who is asking.

---

## Installing as a package

```bash
npm install @askdb/widget
```

```ts
import AskDB from '@askdb/widget'

AskDB.init({ key: 'pk_live_…' })
```

The API is identical. Use it when you would rather have the widget in a
component tree than a script tag — a Next.js layout, say.

---

## What it does about the awkward parts

**Host CSS.** Everything renders in a shadow root. Sites have
`* { box-sizing: content-box }` and `button` resets, and a widget that inherits
either looks broken in a way its author cannot reproduce. Nothing leaks in;
nothing leaks out.

**Small screens.** Below 480px the panel is the page — full bleed, launcher
hidden. A 400px card floating over a 390px phone is the most common way an
embedded widget becomes unusable.

**Streaming.** The answer arrives token by token over SSE, with a caret at the
live end so a pause reads as thinking rather than as finished. Closing the
widget aborts the request; the visitor stops paying for an answer they walked
away from.

**Interruption.** A dropped connection, a suspended tab and a closed widget all
end as an aborted fetch, and all three are handled. A session token that the
server has forgotten is replaced once, silently — "your session expired" means
nothing to somebody who has been on the page for ten seconds.

**Reading while it answers.** Auto-scroll only happens if you are already at
the bottom. Being yanked down mid-read is the most irritating thing a streaming
panel can do.

**Accessibility.** The panel is a labelled `dialog`, the log is an `aria-live`
region, Escape closes, focus returns to the launcher, and everything animated
is switched off under `prefers-reduced-motion`.

**Markdown.** Answers use bold figures, lists and tables, so a small renderer
ships with the widget. It escapes first and adds tags second, so nothing in an
answer can become markup, and links are restricted to `http(s)`.

---

## Size

~9.5 KB gzipped, one request, no dependencies.

## Development

```bash
npm run build      # dist/askdb.js (script tag) + dist/index.js (package)
npm run typecheck
python3 -m http.server 4173 --directory example
```

`example/index.html` ships with a placeholder key. Copy it to
`example/local.html`, put your own key and `apiUrl` in, and open that —
`local.html` is gitignored so a real key never ends up in a commit.

The example page ships a `content-box` reset and a magenta dashed `button`
rule, because the point of the demo is to prove those do not reach the widget.
