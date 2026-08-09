# CellGuard F4 concept design system

## Product character

CellGuard is a safety-critical battery monitoring website, not a generic SaaS analytics template. It should feel authored by an industrial product team: calm, exact, legible, operational, and evidence-oriented.

## Shared invariants for all six concepts

- Keep every F4 content item and action from `docs/product_contract.md`.
- Use Pretendard Variable for UI copy and JetBrains Mono for numbers, times, scores, and IDs.
- Use tabular numerals. Live updates must not move or resize neighboring elements.
- Status always combines semantic color, geometric shape, Korean label, and number.
- Show all four anomaly bands: 정상 0-29, 주의 30-59, 경고 60-79, 위험 80-100.
- Reserve green, yellow, orange, and red for status meaning only. Neutral chrome plus blue actions.
- Temperature can show a grade. Voltage, current, and SOC show “임계값 미정” without inventing a grade.
- Use real F4 snapshot data: PACK-002, session active, 11.46V, 1.7A, 28.7C, SOC 90%, anomaly score 18 normal.
- Trend may use a deterministic illustrative waveform ending at the current metric value; visually distinguish missing data from zero.
- Relay cut is an entry into a reason plus re-authentication flow, not an instant optimistic toggle.
- Provide desktop, tablet, and mobile behavior. Minimum touch target 44px.
- No emoji icons. Use simple line SVG icons where needed.

## Anti-template rules

- No gradients, glassmorphism, floating blobs, purple/blue neon, decorative glows, or giant rounded cards.
- No repeated same-size card mosaic as the primary organizing idea.
- No marketing hero language inside the operational screen.
- No invented metrics, fake percentages, generic “performance” cards, or filler charts.
- Avoid excessive pill controls and 20px-plus corner radii.
- Prefer section rules, alignment, grouping, and typography over shadows.

## Allowed visual language

Only the following shared palette and two themes may be used:

- Light: `#F8FAFC`, `#FFFFFF`, `#F1F5F9`, `#0F172A`, `#475569`, `#E2E8F0`, `#CBD5E1`, action blue `#1D4ED8`.
- Dark: `#0F172A`, `#1B2336`, `#161E2F`, `#F8FAFC`, `#94A3B8`, `#334155`, `#475569`, action blue `#60A5FA`.
- Status: normal `#15803D/#4ADE80`, caution `#A16207/#FACC15`, warning `#C2410C/#FB923C`, danger `#B91C1C/#F87171`.
- Spacing steps: 4, 8, 12, 16, 24, 32px. Radius 0, 6, 10, or 14px only. One subtle shadow level maximum.

## Six approved composition directions

1. Operations Ledger — light, dense, flat table-and-rule composition, compact left navigation, anomaly score integrated as a labeled instrument rather than a hero card.
2. Signal Canvas — light, trend-first composition with one wide signal field, a narrow status rail, generous but purposeful whitespace, minimal side navigation.
3. Instrument Bench — dark, modular measurement bays, precise oscilloscope-like plot treatment, compact command strip, no neon or glow.
4. Incident Briefing — light, chronological and narrative hierarchy: current safety verdict, evidence, actions, and notices arranged like an incident briefing sheet.
5. Split Command — dark or light, stable three-zone desktop: live metrics on the left, primary trend in the center, status/actions/notices on the right.
6. Compact Dock — light, top navigation, horizontal status bands and docked control row, optimized for laptop and tablet without conventional sidebar cards.

Each concept must change the information architecture and page composition, not merely colors or border radii. Use ONLY the fonts, colors, spacing, and component styles defined in this design system. Do not introduce any fonts, colors, or visual styles not in this design system.
