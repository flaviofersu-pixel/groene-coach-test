/**
 * @file theme.js
 * @description Chooses the colour theme before the page is drawn.
 *
 * Rule from the product owner: light is the default, because most municipal
 * employees are not used to a dark theme.
 *  - Plain browser: always light.
 *  - Inside Teams: follow the user's Teams theme. The Teams manifest opens the
 *    tab as `...?theme={theme}`, and Teams fills in default / dark / contrast.
 *
 * This is a classic (non-module) script loaded in <head>, so the theme is set
 * before anything is painted and the page never flashes dark.
 *
 * TODO(teams): replace the URL parameter with TeamsJS
 * (`app.getContext()` -> `context.app.theme`) and react to live theme changes
 * with `app.registerOnThemeChangeHandler`. With Fluent UI that becomes
 * <FluentProvider theme={teamsLightTheme | teamsDarkTheme | teamsHighContrastTheme}>.
 */
(function applyTheme() {
  /** Teams theme name -> our CSS theme name. */
  const THEMES = {
    default: 'light',
    dark: 'dark',
    // TODO(teams): give high contrast its own palette; dark is the closest we have now.
    contrast: 'dark',
  };

  const teamsTheme = new URLSearchParams(window.location.search).get('theme');
  document.documentElement.dataset.theme = THEMES[teamsTheme] ?? 'light';
})();
