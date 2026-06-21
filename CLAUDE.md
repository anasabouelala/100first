# Viraholic

React + Vite SaaS app at `localhost:3000` plus a Chrome MV3 extension at `viraholic-extension/`.
Project config lives in `contexts/ProjectContext.tsx` (`project_config_v1` in localStorage).

## Rules
1. Always check `.claude/skills/` for task-specific protocols before executing.
2. Pipe known-noisy commands through `.claude/hooks/prune-logs.sh` to keep context lean. Noisy = `npm install`, `npm run build`, `tsc --noEmit`, test runners, `git log -n 100+`, anything that routinely exceeds ~200 lines. Example: `npx tsc --noEmit 2>&1 | bash .claude/hooks/prune-logs.sh`.
3. Extension changes (`viraholic-extension/*.js`) are NOT observable in the React preview — they require `chrome://extensions` → reload. Skip `<verification_workflow>` for those files.
4. Edits in the worktree (`.claude/worktrees/youthful-pascal-156f97`) must be synced to the main project before commit. Pattern: edit in worktree, `Copy-Item` to root, commit from root.
5. Project changes go through `useProject()` — never re-introduce per-section input forms.
