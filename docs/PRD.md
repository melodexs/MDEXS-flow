# MDEXS Flow — Product Requirements (Phase 2 snapshot)

## Vision

An offline-first Android/iOS app to play local music, read PDFs, listen to
audiobooks, and convert PDF text to speech — with an approved downloadable
catalog and progress sync when connectivity returns.

## In scope (product goals)

1. Import and play music files stored on the device.
2. Import and read PDF documents.
3. Listen to recorded audiobooks.
4. PDF text-to-speech, incl. downloadable offline voice packs where feasible.
5. Download approved music, PDFs, audiobooks, and voice packs from a catalog.
6. Full offline use of the downloaded library.
7. Reading positions, bookmarks, playback positions, playlists, history.
8. Reading/listening time tracked by day, week, month.
9. Progress sync with the user account when back online.
10. Admin-managed catalog with mandatory review before publication.

## Non-goals (explicit, Phase 2)

- No streaming, no podcast feed, no live radio.
- No subscriptions, payments, advertising, or paid tiers. Business model undecided.
- No social features (comments, follows, sharing feeds).
- No desktop or web client. (`apps/admin/` is a future operator dashboard, not a user product.)
- No cloud transcoding or server-side media processing.
- No distribution of copyrighted content without verified rights.

## Not yet implemented

Everything in the goals list is **planned**. Implemented today: monorepo
foundation, FastAPI health service, mobile navigation shell, shared contracts.
See `architecture.md` for the phase roadmap.

## Content rules (requirements, not implemented features)

- All catalog items require explicit rights attribution before publication.
- User submissions enter a pending state visible only to administrators.
- Nothing is publicly downloadable until an authorized admin approves it.
- Moderation review must record rights/licensing status as part of approval.
