# Set up a clean rebuild within MMShida/CMCM

Download this ZIP to `~/Downloads` on macOS. These commands create a **separate clone** and a **new branch** so Mateus's current local working copy and remote `bailey-model` branch stay untouched.

```bash
# If necessary: brew install gh node; gh auth login
cd ~
gh repo clone MMShida/CMCM bailey-rebuild -- --branch bailey-model
cd ~/bailey-rebuild
git switch -c rebuild-from-scratch

# Delete tracked old application files on the NEW branch only.
# DO NOT run this in Mateus's original checkout.
git rm -r -- .

# Add the specification, references, and Codex instructions.
unzip -o ~/Downloads/Bailey_Hall_Mateus_Repo_Rebuild_Handoff.zip

git add -A
git commit -m "Start independent Bailey Hall implementation on rebuild branch"
git push -u origin rebuild-from-scratch

npm install -g @openai/codex  # skip if already installed
codex
```

Paste `CODEX_PROMPT.md` into Codex or simply say: `Read CODEX_PROMPT.md and complete its implementation task.`

If `git push` is denied, you lack write access to Mateus's repository. Request collaborator access or push the branch to a personal fork, then open a pull request. Do not force-push any shared branch.
