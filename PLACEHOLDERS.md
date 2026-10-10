# Placeholders

Zene expands placeholders in language strings and related text surfaces through Core placeholder utilities.

## Guidance

- Prefer documented placeholder forms used by existing language files
- Treat missing required values as validation failures where the subsystem requires them
- Do not embed secrets in placeholder defaults
- Reload behavior follows configuration/language reload rules for the active plugin generation

Inspect current helper implementations under Core utils/helpers when adding new placeholder tokens so names stay consistent with existing expansion order.
