// Vite+ (vp): build, format, lint, type check and tests for this package.
//
//     pnpm exec vp pack         # build to dist/ (tsdown)
//     pnpm exec vp check        # format, lint and type-check
//     pnpm exec vp check --fix  # the same, fixing what can be fixed
//     pnpm exec vp test run     # tests (Vitest)
import { defineConfig } from 'vite-plus'

// oxlint-disable-next-line import/no-default-export -- Vite resolves the config through its default export
export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/bin.ts'],
    format: ['esm'],
    dts: true,
  },
  fmt: {
    tabWidth: 2,
    semi: false,
    singleQuote: true,
    printWidth: 120,
    trailingComma: 'all',
    // TypeScript and JSON only: Markdown and YAML stay as written, and the lockfile is generated.
    ignorePatterns: ['dist/**', 'test/generated/**', '**/*.md', '**/*.yaml', '**/*.yml', 'pnpm-lock.yaml'],
  },
  lint: {
    ignorePatterns: ['dist/**', 'test/generated/**'],
    env: { node: true, es2024: true },
    // Setting `plugins` replaces oxlint's default list: restate the defaults, then add
    // import / promise / node / jsdoc.
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise', 'node', 'jsdoc'],
    options: {
      typeAware: true,
      typeCheck: true,
      // A rule that stops firing must have its `oxlint-disable` comment deleted with it.
      reportUnusedDisableDirectives: 'deny',
      // Nothing is configured as a warning; a rule that defaults to `warn` cannot slip through.
      denyWarnings: true,
    },
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
    },
    // Strict by design: exceptions live next to the code as `oxlint-disable-next-line` with a
    // reason, never as `'off'` here. Rules in the correctness / suspicious / perf categories are
    // errors via `categories`; this list adds the pedantic / style / restriction / nursery ones.
    rules: {
      // `@internal` and friends are modifiers, so their text belongs to the description;
      // `check-tag-names` is what catches a tag that is merely misspelled.
      'jsdoc/empty-tags': 'error',
      'jsdoc/check-tag-names': 'error',
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      // `c` is Hono's Context, which a middleware answers through by setting `c.res` / `c.json`.
      'no-param-reassign': ['error', { props: true, ignorePropertyModificationsFor: ['c'] }],
      'no-console': 'error',
      'no-plusplus': 'error',
      // `_tag` is Effect's discriminant on tagged errors and data types; every other
      // dangling underscore stays a smell.
      'no-underscore-dangle': ['error', { allow: ['_tag'] }],
      // Paired with `env: { node: true }` above, so `process` resolves and a typo does not.
      'no-undef': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/consistent-type-imports': 'error',
      'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'typescript/no-misused-promises': 'error',
      'typescript/require-await': 'error',
      'typescript/prefer-readonly': 'error',
      'typescript/prefer-nullish-coalescing': 'error',
      'typescript/switch-exhaustiveness-check': 'error',
      'typescript/no-unsafe-argument': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-return': 'error',
      'unicorn/no-array-for-each': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-spread': 'error',
      'unicorn/prefer-string-replace-all': 'error',
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error',
      // Hardening beyond the defaults: rules below were verified to hold across
      // `src` before being turned on, so any new violation is a real regression.
      'no-new-func': 'error',
      'no-return-assign': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'prefer-object-spread': 'error',
      'symbol-description': 'error',
      'typescript/no-deprecated': 'error',
      'typescript/restrict-plus-operands': 'error',
      'typescript/no-confusing-void-expression': 'error',
      'typescript/only-throw-error': 'error',
      'typescript/prefer-promise-reject-errors': 'error',
      'typescript/prefer-reduce-type-parameter': 'error',
      'typescript/prefer-includes': 'error',
      'typescript/prefer-string-starts-ends-with': 'error',
      'typescript/prefer-optional-chain': 'error',
      'typescript/use-unknown-in-catch-callback-variable': 'error',
      'typescript/return-await': 'error',
      'unicorn/no-await-expression-member': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-string-slice': 'error',
      'unicorn/prefer-at': 'error',
      'unicorn/explicit-length-check': 'error',
      'unicorn/throw-new-error': 'error',
      'import/no-default-export': 'error',
      'import/no-mutable-exports': 'error',
      'import/first': 'error',

      // --- Hardening beyond the enabled categories -------------------------
      // Everything below sits in `pedantic` / `style` / `restriction` / `nursery`,
      // which oxlint leaves off by default. The list mirrors the one in
      // nakita628/hekireki; only rules reachable from this codebase are named, so
      // class / enum / namespace / DOM rules are deliberately absent rather than
      // enabled as dead weight.

      // Escape hatches out of the type system, and the unsound types that survive `strict`.
      'typescript/ban-ts-comment': 'error',
      'typescript/prefer-ts-expect-error': 'error',
      'typescript/no-unsafe-function-type': 'error',
      'typescript/no-empty-object-type': 'error',
      'typescript/no-invalid-void-type': 'error',
      'typescript/no-non-null-asserted-nullish-coalescing': 'error',
      'typescript/non-nullable-type-assertion-style': 'error',
      'typescript/no-dynamic-delete': 'error',
      'typescript/strict-void-return': 'error',

      // Declaration style. `consistent-type-definitions: 'type'` locks in the repo-wide
      // `type X = {...}`; the default of this rule is the opposite ('interface'), so the
      // option is load-bearing, not decoration.
      'typescript/consistent-type-definitions': ['error', 'type'],
      'typescript/consistent-type-exports': 'error',
      'typescript/consistent-generic-constructors': 'error',
      'typescript/array-type': 'error',
      'typescript/method-signature-style': 'error',
      'typescript/no-inferrable-types': 'error',
      'typescript/dot-notation': 'error',
      'typescript/prefer-for-of': 'error',
      'typescript/prefer-find': 'error',
      'typescript/prefer-function-type': 'error',
      // ESM-only package: a `require` call would not survive the build.
      'typescript/no-require-imports': 'error',
      'typescript/no-import-type-side-effects': 'error',

      // Rejections and throws must carry an Error, or the CLI reports `[object Object]`
      // instead of an actionable message.
      'no-throw-literal': 'error',
      'unicorn/error-message': 'error',
      'unicorn/prefer-type-error': 'error',

      // Node / ESM hygiene.
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-global-this': 'error',
      'unicorn/require-module-specifiers': 'error',
      // `unicorn/import-style` is deliberately absent: it wants `node:path` as a default
      // import, and `path` is a domain noun here (OpenAPI Path Item objects), so the
      // namespace shadows a local in nearly every file that needs it.
      'unicorn/prefer-export-from': 'error',
      'unicorn/prefer-import-meta-properties': 'error',
      // `no-abusive-eslint-disable` pairs with `reportUnusedDisableDirectives` above: a
      // suppression must name the rule it silences and must still be earning its place.
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/no-anonymous-default-export': 'error',

      // String and array work: this is what a codegen library does all day.
      'prefer-template': 'error',
      'no-useless-concat': 'error',
      'no-multi-str': 'error',
      'unicorn/consistent-template-literal-escape': 'error',
      'unicorn/consistent-existence-index-check': 'error',
      'unicorn/require-array-join-separator': 'error',
      'unicorn/prefer-negative-index': 'error',
      'unicorn/prefer-array-index-of': 'error',
      'unicorn/prefer-array-flat': 'error',
      'unicorn/prefer-object-from-entries': 'error',
      'unicorn/prefer-string-trim-start-end': 'error',
      // `unicorn/prefer-code-point` is deliberately absent: `charCodeAt` feeds the
      // identifier-hash fallback in src/utils, where the UTF-16 code unit is the value
      // that has been baked into generated names.
      'unicorn/prefer-native-coercion-functions': 'error',
      'unicorn/consistent-empty-array-spread': 'error',
      'unicorn/prefer-single-call': 'error',
      'unicorn/no-useless-collection-argument': 'error',
      'unicorn/no-useless-fallback-in-spread': 'error',
      'unicorn/no-unnecessary-array-flat-depth': 'error',
      'unicorn/no-magic-array-flat-depth': 'error',
      'unicorn/no-unnecessary-slice-end': 'error',
      'unicorn/no-length-as-slice-end': 'error',
      'unicorn/no-unreadable-array-destructuring': 'error',
      'unicorn/no-immediate-mutation': 'error',

      // Regex and numbers.
      'unicorn/prefer-regexp-test': 'error',
      'prefer-regex-literals': 'error',
      'require-unicode-regexp': 'error',
      'no-div-regex': 'error',
      'no-regex-spaces': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-math-min-max': 'error',
      'unicorn/prefer-math-trunc': 'error',
      'unicorn/prefer-modern-math-apis': 'error',
      'unicorn/numeric-separators-style': 'error',
      'unicorn/no-zero-fractions': 'error',
      'unicorn/escape-case': 'error',
      'unicorn/no-hex-escape': 'error',
      radix: 'error',
      'prefer-numeric-literals': 'error',
      'prefer-exponentiation-operator': 'error',
      // `no-implicit-coercion` is deliberately absent: its fix rewrites `!!(a && b)` to
      // `Boolean(a && b)`, and TypeScript's aliased-condition narrowing (`const ok = !!(a && b)`
      // implying `a` and `b` later) does not survive the call form. The rule would trade a
      // real type guarantee for a stylistic one.
      'unicorn/no-typeof-undefined': 'error',

      // Control flow and declarations. `curly` is `multi-line` rather than `all` so the
      // guard-clause form (`if (!x) return null` on one line) stays legal, while a body
      // that wraps onto its own line must be braced.
      curly: ['error', 'multi-line'],
      'no-useless-return': 'error',
      'unicorn/no-lonely-if': 'error',
      'unicorn/prefer-logical-operator-over-ternary': 'error',
      'unicorn/prefer-default-parameters': 'error',
      'unicorn/no-object-as-default-parameter': 'error',
      'unicorn/no-unreadable-iife': 'error',
      'unicorn/no-useless-switch-case': 'error',
      'default-case-last': 'error',
      'default-param-last': 'error',
      'no-fallthrough': 'error',
      'no-case-declarations': 'error',
      'array-callback-return': 'error',
      'no-loop-func': 'error',
      'no-inner-declarations': 'error',
      'block-scoped-var': 'error',
      'init-declarations': 'error',
      'no-redeclare': 'error',
      'no-multi-assign': 'error',
      'no-sequences': 'error',
      'no-useless-assignment': 'error',
      'no-unreachable-loop': 'error',
      // Hoisted `function` declarations are safe to reference above their definition;
      // `const` / `class` are the TDZ hazard this rule is for.
      'no-use-before-define': ['error', { functions: false }],
      'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
      'arrow-body-style': 'error',
      'prefer-arrow-callback': 'error',
      'guard-for-in': 'error',
      'no-labels': 'error',
      'no-label-var': 'error',
      'no-extra-label': 'error',
      'no-lone-blocks': 'error',
      yoda: 'error',
      'no-self-compare': 'error',

      // Objects and globals.
      'object-shorthand': 'error',
      'operator-assignment': 'error',
      'prefer-object-has-own': 'error',
      'no-prototype-builtins': 'error',
      'no-object-constructor': 'error',
      'no-array-constructor': 'error',
      'no-new-wrappers': 'error',
      'unicorn/new-for-builtins': 'error',
      'prefer-rest-params': 'error',
      'no-implicit-globals': 'error',
      'no-extra-bind': 'error',
      'no-useless-computed-key': 'error',
      'unicorn/no-useless-promise-resolve-reject': 'error',
      'unicorn/prefer-structured-clone': 'error',
      'unicorn/prefer-optional-catch-binding': 'error',
      // The rule's default name is `error`; restating it keeps a stray `e` from
      // creeping back in.
      'unicorn/catch-error-name': ['error', { name: 'error' }],

      // Code injection surfaces (`eval` itself is already `correctness`).
      'no-script-url': 'error',
      'no-bitwise': 'error',
      // `void promise` is the marker `typescript/no-floating-promises` prescribes for a
      // deliberate fire-and-forget; `void 0` stays banned.
      'no-void': ['error', { allowAsStatement: true }],
      'no-empty': 'error',
      'no-empty-function': 'error',
      'unicode-bom': 'error',
      // `capIsNew: false`: Effect Schema's constructors are capitalized functions
      // (`Schema.TemplateLiteral`, `Schema.Literals`) called without `new`. The other
      // half of the rule — `new` on a lowercase function — stays on.
      'new-cap': ['error', { capIsNew: false }],
      // A parked TODO is debt that belongs in an issue, not in the source.
      'no-warning-comments': 'error',
      // A `${...}` inside a single-quoted string is almost always a template literal
      // that lost its backticks — a real hazard when the product is emitted source.
      'no-template-curly-in-string': 'error',

      // promise / node rules sit outside the enabled categories, so the ones that matter
      // for an async Node CLI are named explicitly.
      'promise/param-names': 'error',
      'promise/valid-params': 'error',
      'promise/spec-only': 'error',
      'promise/no-new-statics': 'error',
      'promise/no-multiple-resolved': 'error',
      'promise/no-return-wrap': 'error',
      'promise/no-return-in-finally': 'error',
      'promise/no-nesting': 'error',
      'promise/no-promise-in-callback': 'error',
      'promise/no-callback-in-promise': 'error',
      'promise/catch-or-return': 'error',
      'promise/always-return': 'error',
      'promise/prefer-catch': 'error',
      // `promise/prefer-await-to-then` is deliberately absent: it matches any `.catch()`,
      // and zod's `.catch(fallback)` — all over the generator fixtures — is a schema
      // method, not a promise.
      'node/no-exports-assign': 'error',
      'node/no-new-require': 'error',
      'node/no-mixed-requires': 'error',
      'node/global-require': 'error',
      'node/no-path-concat': 'error',
      'node/handle-callback-err': 'error',
      'node/callback-return': 'error',

      // Module graph. `extensions` keeps relative specifiers `.js`-suffixed, which
      // NodeNext resolution requires at runtime and `tsc` does not check.
      'import/extensions': ['error', 'always', { ignorePackages: true }],
      'import/export': 'error',
      'import/unambiguous': 'error',
      'import/no-commonjs': 'error',
      'import/no-named-default': 'error',
      'import/no-unassigned-import': 'error',
      'import/no-named-as-default': 'error',
      'import/no-anonymous-default-export': 'error',
      'import/consistent-type-specifier-style': 'error',
      // Dependency hygiene. (`import/no-extraneous-dependencies` would be the one that
      // matters most here — a `devDependency` reaching `src` breaks the published package —
      // but oxlint does not implement it yet; `vp pack` externalising an undeclared import
      // is the current backstop.)
      'import/no-self-import': 'error',
      'import/no-absolute-path': 'error',
      'import/no-empty-named-blocks': 'error',
      // Naming: the identifiers a reader scans first.
      'no-shadow-restricted-names': 'error',
      'no-delete-var': 'error',
      // `unicorn/filename-case` is deliberately absent: the component modules are named
      // after the OpenAPI Components Object keys they emit (`mediaTypes.ts`, `pathItems.ts`,
      // `requestBodies.ts`, `securitySchemes.ts`), which are also the config field names.
      // Kebab-casing them would break a correspondence that is worth more than the rule.
    },
    overrides: [
      {
        files: ['**/*.test.ts', '**/*.spec.ts'],
        plugins: ['vitest'],
        rules: {
          // A test arranges and asserts imperatively when that is the clearest way to
          // spell a fixture out; the structural rules describe `src`, not the suite.
          // `let` declared per suite and assigned in a hook is the shape of a fixture,
          // not an uninitialized binding waiting to bite.
          'init-declarations': 'off',
          // Stub callbacks (`() => {}` passed to a plugin hook or a spy) are the point.
          'no-empty-function': 'off',
          // A handler is typed by the route the test declares, so it lives beside it.
          'unicorn/consistent-function-scoping': 'off',
          // `_name` is a type-level fixture: assigned only for its type, and never read.
          'no-underscore-dangle': 'off',
          // Mock implementations return whatever is convenient; the contract they stand
          // in for is what the assertions check.
          'typescript/strict-void-return': 'off',
          // Assertions frequently nest a narrowing `if` inside a guard, which reads as a
          // lonely `if` while spelling out the case under test.
          'unicorn/no-lonely-if': 'off',
          'no-restricted-imports': 'off',
          'typescript/no-explicit-any': 'off',
          'typescript/consistent-type-assertions': 'off',
          'typescript/no-unsafe-type-assertion': 'off',
          'typescript/no-unsafe-argument': 'off',
          'typescript/no-unsafe-assignment': 'off',
          'typescript/no-unsafe-member-access': 'off',
          'typescript/no-unsafe-call': 'off',
          'typescript/no-unsafe-return': 'off',
          // Test files sit outside tsconfig.json, so type-aware lint sees the default lib,
          // which predates `toSorted`; `.sort()` on fresh arrays stays allowed here.
          'unicorn/no-array-sort': 'off',
          // The other vitest rules this suite relies on (no-focused-tests, expect-expect, ...)
          // sit in the correctness / suspicious categories, so enabling the plugin is enough.
          // The suite asserts inside try/catch and conditionals throughout (~600 sites).
          'vitest/no-conditional-expect': 'off',
          // Fixtures feed and assert on source text that contains a literal `${...}`;
          // there that is the value under test, not a lost backtick.
          'no-template-curly-in-string': 'off',
          'vitest/no-identical-title': 'error',
          'vitest/valid-expect': 'error',
          'vitest/valid-title': 'error',
          'vitest/valid-describe-callback': 'error',
          // An `expect` outside a test case is never run and never reported.
          'vitest/no-standalone-expect': 'error',
          'vitest/no-test-return-statement': 'error',
          'vitest/no-test-prefixes': 'error',
          'vitest/no-duplicate-hooks': 'error',
          'vitest/prefer-hooks-on-top': 'error',
          'vitest/prefer-hooks-in-order': 'error',
          'vitest/consistent-test-it': 'error',
          'vitest/no-alias-methods': 'error',
          'vitest/prefer-equality-matcher': 'error',
          // `vitest/prefer-called-with` is deliberately absent: the vite-plugin suite
          // asserts that a hook fired at all, and pinning arguments there would test the
          // plugin's internal call shape rather than its contract.
          'vitest/require-to-throw-message': 'error',
          'vitest/prefer-each': 'error',
          'vitest/prefer-spy-on': 'error',
          'vitest/no-mocks-import': 'error',
          // Snapshots are a partial-match assertion by another name, so they are kept
          // small and literal where they appear at all.
          'vitest/no-interpolation-in-snapshots': 'error',
          'vitest/no-large-snapshots': 'error',
        },
      },
    ],
  },
  test: {
    globalSetup: ['test/teardown.ts'],
    // The tests type-check and run the generated files: under a parallel run the 5s default is
    // contention, not a hung test.
    testTimeout: 30_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  staged: {
    '*.{ts,js,json}': 'vp check --fix',
  },
})
