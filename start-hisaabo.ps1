# Start Vrunda Infotech PostgreSQL and dev servers
Write-Host "Starting PostgreSQL and Vrunda Infotech dev servers..." -ForegroundColor Cyan
wsl -u root bash -c "service postgresql start && cd /mnt/c/Users/DELL/.gemini/antigravity/scratch/hisaabo && pnpm dev"
