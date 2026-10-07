---
name: frontend-review
description: Review frontend/UI code for accessibility, UI states, performance, and common framework pitfalls (React/Vue/Angular/Svelte). Load when writing or reviewing components, pages, forms, or styles.
---

# Frontend review

## UI states

- Every data-driven view handles **loading, empty, error, and partial** states — not just success.
- Buttons that trigger requests are disabled / show progress while pending; double submit is impossible.
- Long text, long lists, missing images, and narrow widths do not break the layout.

## Accessibility

- Semantic elements: `button` for actions, `a` for navigation, headings in order, lists as lists.
- Every input has a label; icon-only buttons have `aria-label`; images have meaningful `alt` (or `alt=""` if decorative).
- Keyboard: all actions reachable with Tab/Enter/Space; visible focus; modals trap and restore focus; Escape closes.
- Color contrast is sufficient; state is not conveyed by color alone.

## Performance

- No expensive work in render; memoize only measured hot paths (do not wrap everything in `useMemo`/`useCallback`).
- Long lists virtualized or paginated; images sized and lazy-loaded.
- Effects/subscriptions/timers cleaned up; no fetch waterfalls that could run in parallel.
- Bundle: no heavy library imported for one helper; dynamic import for rarely used routes/dialogs.

## Framework pitfalls

- React: stable `key`s (not array index for reorderable lists), complete effect dependencies, no state derived from props without reason, no setState in render.
- Vue: no mutating props; `computed` instead of watchers for derived values.
- Forms: validation on submit and on blur, server errors mapped back to fields.

## Consistency

- Use the project's design tokens and existing components (no ad-hoc hex/px when tokens exist).
- User-facing strings go through i18n if the project localizes.
- Security: no `dangerouslySetInnerHTML` / `v-html` with untrusted data; external links with `rel="noopener noreferrer"`.

## Report

`path:line — issue — user impact — fix`, grouped by section, most impactful first.
