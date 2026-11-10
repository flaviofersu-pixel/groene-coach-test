# Teams app manifest (template)

`manifest.json` is a **template, not deployable as-is**. Before packaging it for Teams:

1. Replace every `00000000-0000-0000-0000-000000000000` with the real app id and the
   Entra ID app registration (client) id.
2. Replace `opruimcoach.example` with the real hosting domain.
3. Add the two icons `color.png` (192×192) and `outline.png` (32×32, transparent) next to it
   and zip the three files.

## Theme

The tab URL ends with `?theme={theme}`. Teams fills in `default`, `dark` or `contrast`, and
`frontend/public/js/theme.js` picks the matching colours. Without the parameter (plain
browser) the app is always light.

TODO(teams): in the real version, read the theme with TeamsJS
(`app.getContext()` → `context.app.theme`) and follow live changes with
`app.registerOnThemeChangeHandler`, and use Fluent UI's `FluentProvider` with
`teamsLightTheme` / `teamsDarkTheme` / `teamsHighContrastTheme`.
