# Real-World Use Case: Desktop Companion Application

Now consider a desktop companion app for internal operations staff.

This kind of application often wants:

- SQLite-backed local durability
- replication with a backend service
- a reactive UI over local data
- the ability to surface remote changes in a deliberate way

That combination is one of the clearest fits for this package.

## Why Desktop Changes The Priorities

Desktop applications often care more about:

- stronger local persistence than a trivial browser-only store
- richer offline behavior
- longer-lived local datasets
- more deliberate cross-device update UX

A pure browser example can hide those pressures. A desktop app makes them obvious.

## How The Package Fits

The host desktop app can keep all runtime-specific storage decisions in `createStorage()`:

- desktop SQLite adapter setup
- validation wrappers
- environment-specific logging

It can then keep all API decisions in pull and push handlers:

- backend endpoint selection
- checkpoint format
- conflict document mapping

And it can still expose clean app-facing helpers such as:

- `useInboxItemsQuery()`
- `archiveMessage(...)`
- `pinConversation(...)`

The shared package remains generic, but the desktop application still gets a repeatable local-first architecture.

## Why Manual Approval May Matter More On Desktop

Desktop workflows often involve longer-lived screens and more deliberate editing.

That means remote changes can be more disruptive there than in lightweight mobile interactions.

A desktop companion app may therefore want manual browser-policy mode for:

- inbox updates
- queue reshuffles
- remote state changes that affect the visible screen

The package supports that by letting the app decide when and how approval is shown, instead of forcing automatic application.

## The Practical Benefit

The real benefit here is not just “less code.”

It is that the desktop app gets a stable architectural seam:

- RxDB stays the persistence and replication layer
- TanStack DB stays the reactive query layer
- the shared package owns the generic wiring
- the desktop app owns the product behavior

That boundary is what keeps a local-first desktop app maintainable once it grows beyond a small demo.
