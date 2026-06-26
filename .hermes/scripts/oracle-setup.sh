#!/bin/bash
# Gary Budgets Oracle Setup — run ONCE on Oracle VM
# This sets up the cron pipeline for the Gary Budgets Instagram publisher
# Steps:
#   1. Clones/updates the command center repo
#   2. Creates the token file
#   3. Sets up cron jobs

set -e

echo "=== Gary Budgets Oracle Pipeline Setup ==="

# 1. Create directories
mkdir -p ~/garybudgets/scripts ~/garybudgets/logs ~/workspace

# 2. Clone/update repo
if [ -d ~/garybudgets/repo ]; then
  cd ~/garybudgets/repo && git pull
else
  git clone https://github.com/timothygaer/garybudgets-command-center.git ~/garybudgets/repo
fi

# 3. Symlink manifest to expected path  
ln -sf ~/garybudgets/repo/manifest.json ~/workspace/garybudgets-command-center/manifest.json 2>/dev/null || \
  mkdir -p ~/workspace/garybudgets-command-center && \
  ln -sf ~/garybudgets/repo/manifest.json ~/workspace/garybudgets-command-center/manifest.json

# 4. Create token file
# NOTE: You need to copy the actual IG token here.
# Run this on your Mac: scp -i ~/.ssh/oracle_cloud_ed25519 ~/Documents/Obsidian\ Vault/Private/API\ Keys/Instagram\ Graph\ API\ Token.md.md ubuntu@ORACLE_IP:~/garybudgets/scripts/ig_token.txt
echo "# Token must be copied manually — see note above" > ~/garybudgets/scripts/ig_token.txt

# 5. Download the gb-publish script
curl -sL "https://raw.githubusercontent.com/timothygaer/garybudgets-command-center/main/.hermes/scripts/gb-publish.py" \
  -o ~/garybudgets/scripts/gb-publish.py 2>/dev/null || \
  echo "Script not in repo — will be added after first publish"

# 6. Git config
git config --global user.name 'Gary Budgets Bot'
git config --global user.email 'garybudgets@hermes-online'

# 7. Set up cron for future posts
cat > ~/garybudgets/crontab.txt << 'CRONEOF'
# Gary Budgets publish jobs — all times UTC
# Mon-Fri weekly posts at 6am PT = 13:00 UTC
0 13 * * 1 cd /home/ubuntu/garybudgets/repo && GB_TOKEN_PATH=/home/ubuntu/garybudgets/scripts/ig_token.txt python3 /home/ubuntu/garybudgets/scripts/gb-publish.py POST_ID >> /home/ubuntu/garybudgets/logs/publish.log 2>&1
# Add more lines as new posts are approved
CRONEOF

# 8. Test the token
python3 -c "
import json, urllib.request
token = open('/home/ubuntu/garybudgets/scripts/ig_token.txt').read().strip().split('=',1)[1].strip()
url = 'https://graph.instagram.com/v21.0/17841414649666554?fields=id,username&access_token=' + token
data = json.loads(urllib.request.urlopen(url).read())
print(f'API OK: {data[\"username\"]} (ID: {data[\"id\"]})')
" 2>&1

echo "=== Setup complete ==="
echo "Run: crontab ~/garybudgets/crontab.txt to activate"
