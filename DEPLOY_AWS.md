# Deploy to AWS

This project can run on AWS in two ways:

- **Serverless**: S3 + CloudFront for the frontend, Lambda for the API.
- **Server-based**: EC2 + Nginx + PM2 + Postgres on one VM.

If you want the easiest path for this repo today, use **Server-based (EC2)**.

The current backend assumes a long-running process for warmup, caching, and scheduled refresh behavior, which maps more naturally to EC2 than Lambda.

--- 

## Choose a deployment path

| Path | Best when | Tradeoffs |
|------|-----------|-----------|
| Serverless | You want minimal server management and are willing to adapt the backend for Lambda | Cheapest steady-state footprint, but this repo needs refactoring for the best result |
| Server-based | You want the fastest, clearest deployment with the current codebase | You manage one server, but behavior matches the app as written |

---

## Option 1: Serverless

Use this when you specifically want AWS-managed infrastructure and are comfortable changing the backend shape.

### Recommended architecture

- Frontend: S3 + CloudFront
- Backend: Lambda behind Function URL or API Gateway
- Secrets: AWS Secrets Manager
- Optional persistent cache: DynamoDB

### Why this is not the easiest path for this repo

The current backend was built around a long-lived Node process. In Lambda:

- the in-memory cache is only per warm instance
- cold starts lose cache state
- startup warmup and hourly refresh logic need redesign
- long `180d` fetches are more likely to hit timeout or cold-start latency issues

### What you would need to change

1. Split the Express app from the `listen()` boot path.
2. Add a Lambda adapter such as `@vendia/serverless-express`.
3. Move warmup/refresh behavior out of process startup.
4. Replace or supplement in-memory caching with DynamoDB if cross-instance reuse matters.
5. Re-test large-range requests such as `90d` and `180d` under Lambda timeouts.

### High-level serverless flow

1. Build the frontend and deploy `client/dist` to S3.
2. Put CloudFront in front of S3.
3. Package the server for Lambda.
4. Store Anthropic keys in Secrets Manager.
5. Deploy Lambda and expose it through Function URL or API Gateway.
6. Route `/api/*` from CloudFront to Lambda.

### When to choose this anyway

Choose serverless if:

- traffic is light and bursty
- you want to avoid patching and maintaining a VM
- you are willing to trade some app simplicity for infrastructure simplicity

---

## Option 2: Server-based (EC2)

This is the recommended deployment path for the current codebase.

### Architecture

- Frontend build served by the backend or by Nginx
- Node/Express API running on EC2
- PM2 managing the Node process
- Nginx as reverse proxy on port 80
- Postgres on the same EC2 instance
- Anthropic keys stored in AWS Secrets Manager
- EC2 IAM role used to fetch secrets securely

### What this gives you

- behavior consistent with local development
- warm process state for the in-memory cache
- reuse of persisted dashboard snapshots in Postgres
- simpler debugging over SSH
- no Lambda adaptation work

---

## EC2 deployment guide

These steps are based on the deployment flow already validated for this repo.

### 1. Create the EC2 instance

Recommended baseline:

- Ubuntu 24.04 LTS
- `t3.small` or `t3.medium`
- 20 to 30 GB gp3 storage
- security group allowing:
  - `22` from your IP only
  - `80` from your users or internal network
  - optionally `443` if you add TLS later

If this should stay internal, do not open access broadly. Restrict by office IP, VPN, or private network controls.

### 2. Attach an Elastic IP

Attach an Elastic IP if you want the server address to remain stable across stops/starts.

Later, point a DNS record such as `dashboard.example.com` at that Elastic IP.

### 3. Create the secret in AWS Secrets Manager

Store your API keys in one secret. Use placeholders below, not real keys in files.

```bash
aws secretsmanager create-secret \
  --name claude-usage-dashboard/prod \
  --secret-string '{
    "ANTHROPIC_ADMIN_KEY":"REPLACE_ME",
    "ANTHROPIC_ANALYTICS_KEY":"REPLACE_ME",
    "ANTHROPIC_VERSION":"2023-06-01",
    "ANTHROPIC_BASE_URL":"https://api.anthropic.com"
  }'
```

If the secret already exists, update it with `put-secret-value`.

### 4. Create and attach an EC2 IAM role

Create an IAM role for EC2 with permission to read only that secret.

Minimum access needed:

- `secretsmanager:GetSecretValue` on the deployment secret

Attach the role to the EC2 instance through an instance profile. This avoids hardcoding AWS credentials on the box.

### 5. SSH into the instance and install system packages

```bash
sudo apt update
sudo apt install -y nginx postgresql postgresql-contrib unzip curl git build-essential
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install PM2 globally:

```bash
sudo npm install -g pm2
pm2 -v
```

If AWS CLI is not already present, install AWS CLI v2:

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
aws --version
```

### 6. Set up Postgres

Create the app database:

```bash
sudo -u postgres createuser -s "$USER"
createdb claude_usage_dashboard
psql -d claude_usage_dashboard -c '\dt'
```

This repo uses Postgres for persisted dashboard snapshots. That is what allows one user's loaded data to be reused later by other users for the same unfiltered ranges.

### 7. Clone the repo and install dependencies

```bash
git clone git@github.com:maherhanafi/claude-usage-dashboard.git
cd claude-usage-dashboard
npm --prefix client install
npm --prefix server install
```

If you use HTTPS, a different SSH host alias, or a tarball instead of `git clone`, adjust accordingly.

### 8. Create the server environment file from Secrets Manager

Fetch the secret at deploy time and write only the values the app needs.

```bash
aws secretsmanager get-secret-value \
  --secret-id claude-usage-dashboard/prod \
  --query SecretString \
  --output text
```

Create `server/.env` with these values:

```dotenv
ANTHROPIC_ADMIN_KEY=REPLACE_ME
ANTHROPIC_ANALYTICS_KEY=REPLACE_ME
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_BASE_URL=https://api.anthropic.com

PORT=8787
DATABASE_URL=postgres://YOUR_LINUX_USER@localhost:5432/claude_usage_dashboard
PERSIST_HISTORY=true
HISTORY_WARMUP_CONCURRENCY=4
USE_MOCK=false
```

Do not commit this file.

### 9. Build the app

```bash
npm --prefix client run build
npm --prefix server run build
```

### 10. Start the app with PM2

Run the backend from the repo root so it can find the built frontend.

```bash
pm2 start npm --name claude-dashboard -- run start
pm2 save
pm2 startup
```

Validate PM2:

```bash
pm2 status
pm2 logs claude-dashboard --lines 100
```

### 11. Configure Nginx as a reverse proxy

Create an Nginx site config:

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        send_timeout 300s;
    }
}
```

Enable it:

```bash
sudo tee /etc/nginx/sites-available/claude-dashboard >/dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        send_timeout 300s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/claude-dashboard /etc/nginx/sites-enabled/claude-dashboard
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

The extended timeouts matter for cold `180d` requests. We hit `504 Gateway Timeout` until these were increased.

### 12. Verify the deployment

Local checks on the box:

```bash
curl http://127.0.0.1:8787/api/health
curl "http://127.0.0.1:8787/api/dashboard?period=180d"
```

Public checks:

```bash
curl http://YOUR_PUBLIC_IP/api/health
curl "http://YOUR_PUBLIC_IP/api/dashboard?period=180d"
```

Expected health response should include:

- `ok: true`
- `source: analytics`
- `persistenceEnabled: true`

### 13. Make the app start on reboot

If `pm2 startup` prints a command, run that command with `sudo`, then run:

```bash
pm2 save
```

Reboot test:

```bash
sudo reboot
```

After reconnecting:

```bash
pm2 status
curl http://127.0.0.1:8787/api/health
```

---

## How cached and persisted data behaves on EC2

For the current backend:

- repeated requests in the same running process can reuse the in-memory cache
- persisted dashboard snapshots are stored in Postgres
- when no filters are selected, the backend can reuse previously loaded period data from Postgres instead of calling Anthropic again

That means one user's warmup or unfiltered load can make later unfiltered loads faster for other users.

Filtered requests can still require fresh computation or upstream fetches depending on the exact slice requested.

---

## Operations notes

### Logs

```bash
pm2 logs claude-dashboard --lines 200
sudo journalctl -u nginx -n 100 --no-pager
```

### CPU and memory usage over SSH

```bash
top
free -h
df -h
vmstat 1 5
```

If you want a friendlier view:

```bash
sudo apt install -y htop
htop
```

### Postgres checks

```bash
psql -d claude_usage_dashboard -c '\dt'
psql -d claude_usage_dashboard -c 'select count(*) from dashboard_snapshots;'
```

### DNS and friendly URL

For a friendlier address:

1. Allocate and attach an Elastic IP.
2. Create a DNS `A` record pointing at it.
3. Optionally add Nginx TLS with Let's Encrypt or put CloudFront/ALB in front later.

---

## Known caveats

- The optional monthly cost analysis feature expects an OpenAI-compatible endpoint, defaulting to `http://localhost:1234/v1`.
- If that service is not running on EC2, that feature will be degraded or should be disabled.
- First-load `180d` requests can take long enough to require increased reverse-proxy timeouts.
- Do not store secrets directly in the repo or bake them into images.

---

## Cost expectations

### Serverless

Usually lowest idle cost, but only worth it if you are willing to adapt the backend architecture.

### EC2

Expect cost from:

- EC2 instance
- EBS volume
- Elastic IP if unused or detached
- optional Route 53 hosted zone and DNS queries

For a small internal deployment, a single `t3.small` or `t3.medium` is usually the right starting point.

---

## Quick reference

### Fastest path for this repo

1. Launch Ubuntu EC2.
2. Attach Elastic IP.
3. Store Anthropic keys in Secrets Manager.
4. Attach EC2 IAM role with secret read access.
5. Install Node 20, PM2, Nginx, Postgres, AWS CLI.
6. Clone repo and install dependencies.
7. Create `server/.env` from the secret.
8. Build client and server.
9. Start with PM2.
10. Put Nginx in front with 300s read timeout.
11. Verify `/api/health` and `/api/dashboard?period=180d`.

### Subsequent deploys on EC2

```bash
cd ~/claude-usage-dashboard
git pull
npm --prefix client install
npm --prefix server install
npm --prefix client run build
npm --prefix server run build
pm2 restart claude-dashboard
```
