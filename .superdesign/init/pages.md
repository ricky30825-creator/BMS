# Page dependency map

## F4 실시간 관제 (`monitor`)

`web/cellguard_mockup_v4.html`
-> application shell (`aside`, header, main, bottom navigation, modal)
-> `render()` and `renderNav()`
-> `V.monitor()`
-> shared status helpers `gradeOf`, `badge`, `gauge`, `legend`, `shapeSVG`
-> live metric primitive generated inside `V.monitor`
-> `sparkline(state.monitorMetric)`
-> `DATA.session`, `TREND_METRICS`, deterministic `trendSeries`

Required content: connected battery and active measurement session; anomaly score 18 plus normal grade and all four threshold bands; 11.46V, 1.7A, 28.7C, SOC 90%; temperature grade only, while voltage/current/SOC explicitly have undefined thresholds; selectable recent trend; recent notices.

Required actions: change measured battery, enter relay cut flow, inspect anomaly evidence, open full trends, open all notices, select voltage/current/temperature/SOC.

## Supporting screens reached from F4

- `assets`: measurement target change
- `relay`: gated relay control
- `anomaly`: anomaly evidence
- `trend`: all four trends
- `notices`: all notices

All screens share the same single-file shell and local data object. No external UI component dependency is imported.
