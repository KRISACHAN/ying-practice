---
name: git-commit
description: Draft and validate project-compliant commit messages, then commit when the user invokes git-commit or asks to commit. Defaults to Chinese Conventional Commits with selective Lore decision trailers; verifies and removes injected AI/tool attribution from newly created local commits. Supports message-only requests without staging or committing.
---

# Git Commit

Turn the selected changes into the smallest useful decision record, validate it against the target project's rules, commit when requested, and verify the resulting history.

Invoking this Skill to commit authorizes a local commit. Reading, migrating, or editing the Skill does not. For message-only requests (`不要提交`, `仅生成信息`, `只给 message`, `draft only`), draft and validate without staging or committing. Push only when the user requests it.

Read [Git Commit Protocol](./references/_shared/git-commit-protocol.md) for default message and Lore rules. Explicit user instructions and target-project conventions take precedence over these defaults.

## Workflow

1. **Confirm repository and rules** — inspect the current checkout, branch, status, repository instructions, commit protocol, hooks, package scripts, and any commitlint configuration (`commitlint.config.*`, `.commitlintrc*`, or package configuration). Use the project's configured validator and package manager; do not assume `pnpm` or a particular config filename.
2. **Select changes** — explicit user scope wins; otherwise use staged changes when present. If nothing is staged, inspect working-tree changes and untracked files, then stage the intended changes by path when committing. Read relevant untracked content explicitly: ordinary `git diff` does not show it. Preserve unrelated work and partial staging; do not blindly stage the entire repository. Stop if there are no intended changes or unresolved merge conflicts.
3. **Gather decision context** — inspect the actual diff and relevant requirements, rationale, and verification evidence. Do not invent rejected alternatives, confidence, or test results.
4. **Draft** — follow project language, type, scope, length, and trailer rules. Without a project convention, use a concise Chinese Conventional Commit subject. Routine changes need only a subject; add a concise body and selective Lore trailers when they preserve material context.
5. **Validate the complete message** — use the existing project command on the exact subject/body/trailers, revising until it passes. For example, a project with local commitlint may support `pnpm exec commitlint --edit <message-file>`. When no validator exists, check the documented convention and report that validation was manual; do not install tooling solely to lint a message.
6. **Message-only mode** — output the message in a fenced `text` block, report validation, and stop here.
7. **Commit** — save the exact validated message in a temporary UTF-8 file and use `git commit -F <message-file>` to preserve multiline text and avoid shell interpolation. Run normal hooks. If a hook fails, inspect the failure and any file changes before retrying; do not skip hooks or silently include unrelated edits.
8. **Verify the result** — inspect `git log -1 --format=%B`, the committed paths/tree, and `git status --short`. Confirm the intended changes were committed and unrelated work remains. Handle attribution injection as described below before reporting success.

## Context Commands

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
git diff --cached --quiet
git diff --cached --stat
git diff --cached --find-renames --find-copies
# When no intended changes are staged:
git diff --stat
git diff --find-renames --find-copies
git ls-files --others --exclude-standard
```

For `git diff --cached --quiet`, exit `0` means no staged diff, `1` means a staged diff, and other codes indicate an error. Do not treat an error as a change signal. Summarize large generated files or lockfiles where a full diff adds little context.

## No AI Attribution

Record the change and its rationale without adding attribution footers such as `Co-authored-by`, `Made-with`, `Generated-by`, `Assisted-by`, or agent email addresses. Do not add signoffs unless requested or required by project policy. Legitimate mentions of an AI product being changed are ordinary change context, not attribution.

After each commit, inspect the actual message; some IDEs or hooks may append attribution after the command runs. Detect attribution footers case-insensitively, including `cursoragent@cursor.com` and equivalent AI/tool credit. Restore the validated message rather than deleting arbitrary body lines or useful Lore trailers.

### Strip Injected Attribution

Cleanup is limited to the unpushed local commit just created by this task. Do not rewrite older or pushed history without explicit authorization. If the repository requires signing or message-transforming hooks that cannot be preserved during cleanup, report the conflict and leave cleanup unresolved instead of bypassing those requirements.

For an unsigned commit with no conflicting project requirement, use `git commit-tree` to recreate the commit from the validated message, then move the current HEAD with an expected-old-value check:

1. Capture the new commit's object ID, tree, **all parents** (none for a root commit; preserve every parent for a merge), and author/committer names, emails, and dates.
2. In a command-local environment, preserve that identity metadata and pass the exact validated message file to `git commit-tree <tree> [-p <parent> ...] -F <message-file>`. Do not change global Git configuration or leave exported identity variables behind.
3. Confirm the replacement has the same tree, ordered parents, and identity metadata, with only the intended message change. Atomically update with `git update-ref -m 'remove injected attribution' HEAD <replacement> <old>`. If HEAD has moved, stop and re-inspect; do not overwrite the concurrent change.
4. Re-read the message and status. Updating the ref preserves the index and working tree; **do not use `git reset --hard`**. Verify unrelated staged, unstaged, and untracked work is still present.

Some environments reinject attribution on every amend. Do not repeatedly run `git commit --amend` expecting that injection to disappear. If a replacement still contains unexpected attribution, stop and report the unresolved source instead of looping.

## Completion

Report the final commit SHA and subject, message validation, relevant verification evidence, and remaining working-tree changes. Distinguish committed from pushed. For a draft, report only the message and its validation. Never claim clean attribution, a clean working tree, passing tests, or a successful push without checking the corresponding result.
