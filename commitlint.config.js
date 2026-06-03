/**
 * Commitlint config — enforces Conventional Commits per ADR-033.
 *
 * The default `@commitlint/config-conventional` accepts the standard
 * Angular-style prefixes:
 *   feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
 *
 * `feat` and `fix` drive semantic-release version bumps (minor / patch);
 * `BREAKING CHANGE:` in the body or a `!` after the type drives major.
 * Everything else (chore, refactor, docs, etc.) ships under the release
 * but doesn't itself trigger a bump.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Body lines can exceed 100 chars — we paste log excerpts, URLs,
    // and HEREDOC blocks regularly. Subject line stays bounded.
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
    "subject-max-length": [2, "always", 100],
    // Disable subject-case enforcement. The default rule rejects any
    // subject that isn't all-lowercase, but legitimate subjects regularly
    // contain proper nouns (Claude, Gemini, Vercel, Cloudflare), product
    // names (Remix, Neon), and ALL-CAPS env vars / constants
    // (`ENABLE_EXPERIMENTAL_COREPACK`). Forcing lowercase mangles them.
    "subject-case": [0],
  },
};
