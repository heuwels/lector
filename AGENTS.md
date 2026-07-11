# Repository instructions for coding agents

## Formatting

- `.editorconfig` and `.prettierrc` are the canonical shared formatting settings.
- Install dependencies from `package-lock.json`; the repository pins Prettier and its Tailwind plugin so every agent uses the same formatter implementation.
- Format only files changed for the current task: `npx prettier --write <touched-files...>`.
- Do not run repository-wide formatting during a feature or fix. The legacy tree is not yet fully normalized, so doing so creates unrelated review churn.
- Before handing off, run `npx prettier --check <touched-files...>` and `git diff --check`.
- A future formatting-only baseline change should normalize the whole tree before `npm run format:check` becomes a required CI gate.

## GitHub text

- Always use an input file for multiline PR bodies and comments: `gh pr create/edit --body-file …` and `gh pr comment --body-file …`. Never embed escaped `\n` sequences in `--body`.
