# Layouts

There is no separate layout component. The actual layout source is the standalone shell in `web/cellguard_mockup_v4.html`.

## Desktop shell

- Fixed 240px neutral sidebar
- 56px top header with current screen title and global controls
- Main content uses a responsive CSS grid
- F4 currently uses a two-column grid: connected battery spans full width; anomaly score and current metrics share a row; trend and notices span full width

## Tablet and mobile shell

- Tablet collapses the fixed sidebar and reduces the content grid
- Mobile is a single content column
- Mobile navigation exposes four primary destinations plus a fifth “more” sheet
- Minimum interactive target is 44x44px
- Tables transform to card lists instead of horizontal scrolling

## Actual source authority

Full layout and responsive rules are in `web/cellguard_mockup_v4.html`; no wrapper or nested layout files are imported.
