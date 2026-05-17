## Pre-Staging Diff Check Rule

Before running `git add` on any file — even for a
single-line change — Claude Code must first run:

  git diff <filename>

and report:
- How many lines are changed in the working tree
- Whether those changes match the approved plan exactly

If the diff shows MORE changes than the approved plan
specifies, Claude Code must STOP and flag before
staging anything. Do not run `git add` until James
and the Senior Engineer have reviewed the discrepancy
and given explicit approval to proceed.

Never assume that extra working-tree changes are safe
to include. Always confirm scope before staging.

This rule has no exceptions.
