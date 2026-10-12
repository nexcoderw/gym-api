# Formatting

## Standards

Use tabs for TypeScript/JavaScript, tab width 2, print width 100, single quotes, semicolons, trailing
commas, and LF endings. JSON, YAML, and Markdown use spaces. Prettier owns formatting; ESLint owns code
quality and must not conflict.

## Forbidden practices

No mixed indentation, generated-file formatting, drive-by formatting, or duplicate style rules.

## Example and checklist

The human runs `npm run format` and inspects the diff. Verify `.editorconfig`, Prettier, and ESLint agree.
