# PUSH.md — owner commands (in order)

1. Backup verified: see /mnt/c/Users/ADMIN/Documents/milo-backups/release-prep-*/
2. ```
   cd /home/eya/milo/milo-main
   git remote add origin git@github.com:symulacr/milo.git   # if missing
   git fetch origin
   git merge-base main origin/main   # expect b151d52; if moved, STOP
   git push origin release/wave2:main   # fast-forward only, NEVER --force
   ```
3. Topic: `gh repo edit symulacr/milo --add-topic midnightntwrk`
4. Confirm description + website on the repo
5. `bash scripts/post-push-verify.sh`
6. Record/upload demo video; paste URL into README + AKINDO form
7. Submit SUBMISSION-UPDATE.md v2 in AKINDO Updates/Milestone/4th Wave

CI optional: copy push-kit/ci.yml to .github/workflows/ci.yml
