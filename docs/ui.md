# Interface

The application uses Material UI 9 with its default Material Design theme, React,
and Vite. Buttons, form fields, checkboxes, cards, dialogs, feedback, progress
indicators, and typography come from MUI. Application CSS handles responsive
layout and workout-specific data visualization, rather than recreating the
library's component styles.

Roboto's Latin 300/400/500/700 weights are bundled through Fontsource and served
with the app. No external font service or undefined Next.js font variables are
required. The workout interface and dialogs load separately from the sign-in
screen. Cognito's managed sign-in page remains AWS-hosted.

`frontend/theme.ts` is the theme entry point. `frontend/ui.tsx` preserves native
input names, refs, and event contracts while rendering MUI fields.
`frontend/dialog.tsx` supplies responsive dialogs with MUI focus management.

Validation includes the existing API and data contract suites, mock-AWS browser
flows, and desktop/mobile checks for font loading, keyboard focus, nested
dialogs, plan creation, set entry, completion, and horizontal overflow. All test
data is synthetic.

Selection rationale: the latest published [State of React UI library survey](https://2025.stateofreact.com/en-US/libraries/component-libraries/)
ranks MUI first in usage. Popularity depends on the metric; this choice uses
reported adoption rather than GitHub stars. Follow the [MUI installation guide](https://mui.com/material-ui/getting-started/installation/)
for dependencies and fonts. MUI adds more client code than plain HTML controls
in exchange for maintained components and consistent interaction behavior.
