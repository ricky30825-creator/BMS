# Theme and token source

Canonical source: `design-system/cellguard/MASTER.md`. Runtime source: the `:root` and `[data-theme="dark"]` blocks in `web/cellguard_mockup_v4.html`.

## Compact token summary

- UI font: Pretendard Variable; numeric font: JetBrains Mono
- Light: background `#F8FAFC`, surface `#FFFFFF`, foreground `#0F172A`, muted `#475569`, border `#E2E8F0`, primary `#1D4ED8`
- Dark: background `#0F172A`, surface `#1B2336`, foreground `#F8FAFC`, muted `#94A3B8`, border `#334155`, primary `#60A5FA`
- Grade foregrounds: normal `#15803D`, caution `#A16207`, warning `#C2410C`, danger `#B91C1C`; matching dark values are `#4ADE80`, `#FACC15`, `#FB923C`, `#F87171`
- Spacing: 4, 8, 12, 16, 24, 32px
- Radius: 6, 10, 14px; shadow: one restrained 1px level
- Type: score 44px, metric 24px, H1 20px, H2 15px, body 14px, table 13px, label 11px

## Raw runtime token source

```css
:root {
  --bg:#F8FAFC; --surface:#FFFFFF; --surface-sunken:#F1F5F9;
  --fg:#0F172A; --fg-muted:#475569;
  --border:#E2E8F0; --border-strong:#CBD5E1;
  --primary:#1D4ED8; --on-primary:#FFFFFF;
  --danger:#B91C1C; --ring:#1D4ED8;
  --g-normal-fg:#15803D; --g-normal-bg:#F0FDF4;
  --g-caution-fg:#A16207; --g-caution-bg:#FEFCE8;
  --g-warning-fg:#C2410C; --g-warning-bg:#FFF7ED;
  --g-danger-fg:#B91C1C; --g-danger-bg:#FEF2F2;
  --space-1:4px; --space-2:8px; --space-3:12px;
  --space-4:16px; --space-6:24px; --space-8:32px;
  --radius-sm:6px; --radius-md:10px; --radius-lg:14px;
  --shadow:0 1px 2px rgba(15,23,42,.06);
  --text-score:44px; --text-metric:24px; --text-h1:20px;
  --text-h2:15px; --text-body:14px; --text-sm:13px; --text-xs:11px;
  --sidebar-w:240px; --header-h:56px;
  --font-ui:"Pretendard Variable",Pretendard,system-ui,sans-serif;
  --font-num:"JetBrains Mono",ui-monospace,monospace;
}
[data-theme="dark"] {
  --bg:#0F172A; --surface:#1B2336; --surface-sunken:#161E2F;
  --fg:#F8FAFC; --fg-muted:#94A3B8;
  --border:#334155; --border-strong:#475569;
  --primary:#60A5FA; --on-primary:#0F172A;
  --danger:#F87171; --ring:#60A5FA;
}
```

Status colors are reserved for status only, never general chrome. The product supports light, dark, and system themes.
