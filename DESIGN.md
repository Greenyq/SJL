# SJL design conventions

The public homepage preserves the league's navy and yellow crest, Archivo body type and Barlow Condensed display type. This pass refines the existing visual identity.

## Homepage

The homepage serves parents checking fixtures, clubs and player statistics. Show the season introduction, then the schedule, member clubs, highlights, statistics, league stories and registration. Keep player registration directly accessible in the hero and parent login in navigation.

- Navy `#07133d` and raised navy `#0c205c` carry the identity. Yellow `#ffd21e` marks primary actions and selected controls. Use light `#eef2f8` for schedule and news, with ink `#07112d` and secondary text `#485874`.
- Keep display headings at or below 96px. Use 16px body text, visible labels and a restrained condensed heading hierarchy. Avoid repeating decorative labels above headings.
- Use a 1180px content width, 32px desktop gutters, 20px mobile gutters, 72px desktop section spacing and 48px mobile spacing.
- Use 14px card corners and 8px control corners, with borders defining elevation. Use compact horizontal club identity rows rather than full poster panels.
- Maintain native labelled selects, clear keyboard focus, 48px primary controls, a skip link to fixtures, Escape dismissal for the mobile menu and reduced-motion support.
- At 1100px use the menu; at 760px stack fixtures and leaderboards; at 520px stack filters and club rows. Preserve long club names and avoid horizontal page overflow.
- Keep the schedule and player data sourced from existing APIs and schedule JSON. This stylesheet must not change private account, approval or consent behavior.

`assets/home.css` owns public-page layout and is loaded after shared `assets/features.css`. Parent and admin pages keep their existing styles. No frontend framework or new runtime dependency is required.
