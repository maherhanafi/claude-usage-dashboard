# Deploying to AWS Lambda

This document covers deploying the Claude Usage Dashboard to AWS:

- **Frontend** — React SPA → **S3 + CloudFront**
- **Backend** — Express API → **AWS Lambda + Function URL** (or API Gateway HTTP API)

No containers, no persistent servers. The entire stack is serverless.

---

## Architecture

```
Browser
  │
  ├─ GET /  (static assets) ──────► CloudFront ──► S3 bucket (client/dist)
  │
  └─ GET /api/*  (API calls) ──────► CloudFront ──► Lambda Function URL
                                                         │
                                                  serverless-express wrapper
                                                         │
                                                  Express app (src/index.ts)
                                                         │
                                              ┌──────────┴──────────┐
                                        Anthropic Analytics API  Anthropic Admin API
```

**Important Lambda cache note:** The in-memory 1-hour cache in `dashboardService.ts` works per Lambda instance. Warm instances reuse the cache normally, but cold starts always hit Anthropic's API fresh. For an internal dashboard with low traffic this is fine. If you need persistent caching across instances, see [Optional: Persistent cache](#optional-persistent-cache-with-dynamodb) below.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js 20+ | [nodejs.org](https://nodejs.org) |
| AWS CLI v2 | `brew install awscli` then `aws configure` |
| AWS CDK CLI | `npm install -g aws-cdk` |
| An AWS account | With a region selected |

```bash
# Verify
aws sts get-caller-identity   # must return your account ID
cdk --version                 # 2.x
```

---

## Step 1 — Adapt the Express server for Lambda

Install the Lambda adapter. This wraps the Express app so it can handle Lambda's event format.

```bash
cd server
npm install @vendia/serverless-express
npm install -D @types/aws-lambda
```

Create `server/src/lambda.ts` — the Lambda handler entry point:

```typescript
import serverlessExpress from "@vendia/serverless-express";
import { app } from "./app.js";   // see Step 2

export const handler = serverlessExpress({ app });
```

> **Step 2 — Split `index.ts` into `app.ts` + `lambda.ts`**
>
> Currently `index.ts` both builds the Express app and calls `app.listen()`.
> Lambda doesn't call `listen()` — the adapter handles the HTTP layer.
> You need to export the `app` instance separately so `lambda.ts` can import it
> without triggering `listen()`.

Create `server/src/app.ts` — everything from `index.ts` except the `app.listen()` call:

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { getDashboard } from "./dashboardService.js";
import { HttpApiError } from "./httpError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, source: config.source });
});

app.get("/api/dashboard", async (req, res) => {
  const period =
    typeof req.query.period === "string" && req.query.period
      ? req.query.period
      : `${Number(req.query.days) || 7}d`;
  const force = req.query.refresh === "1" || req.query.refresh === "true";
  const userId =
    typeof req.query.user === "string" && req.query.user ? req.query.user : undefined;
  try {
    const payload = await getDashboard(period, force, userId);
    res.json(payload);
  } catch (err) {
    if (err instanceof HttpApiError) {
      console.error(`[${err.api}-api] ${err.message}`);
      const message =
        err.api === "analytics"
          ? err.status === 401 || err.status === 403
            ? "Anthropic rejected the Analytics API key."
            : `Anthropic Analytics API returned ${err.status}.`
          : err.status === 401
            ? "Anthropic rejected the Admin API key (401)."
            : `Anthropic Admin API returned ${err.status}.`;
      res.status(502).json({ error: `${err.api}_api_error`, status: err.status, message });
    } else {
      console.error("[dashboard] unexpected error", err);
      res.status(500).json({ error: "internal_error", message: (err as Error).message });
    }
  }
});

// Serve bundled frontend when available (optional, for local `npm start`).
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}
```

Update `server/src/index.ts` to import and start the app:

```typescript
import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`  ▶ http://localhost:${config.port}`);
});
```

Update `server/tsconfig.json` to include the new entry point (or it is already covered by `"include": ["src"]`).

---

## Step 2 — Store API keys in AWS Secrets Manager

Never put secrets in Lambda environment variables as plain text if you can avoid it. Use Secrets Manager.

```bash
# Create the secret (run once)
aws secretsmanager create-secret \
  --name "claude-dashboard/api-keys" \
  --secret-string '{
    "ANTHROPIC_ANALYTICS_KEY": "sk-ant-api01-...",
    "ANTHROPIC_ADMIN_KEY": "sk-ant-admin01-..."
  }'
```

The Lambda execution role (created by CDK below) is granted `secretsmanager:GetSecretValue` on this secret. The app reads the keys from **environment variables** that Lambda sets at startup — you populate those from the secret in the CDK stack (see Step 4).

Alternatively, for simplicity you can pass them directly as Lambda env vars in the CDK stack; the trade-off is that they appear in plain text in the Lambda console.

---

## Step 3 — Build both packages

```bash
# From the project root
cd client && npm run build && cd ..
cd server && npm run build && cd ..
```

`client/dist` will be copied to S3.
`server/dist` will be zipped and uploaded to Lambda.

---

## Step 4 — CDK stack

Create a new CDK app alongside the project:

```bash
mkdir infra && cd infra
npx cdk init app --language typescript
npm install aws-cdk-lib constructs
```

Replace `infra/lib/infra-stack.ts` with:

```typescript
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import path from "node:path";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Secrets ──────────────────────────────────────────────────────────────
    const apiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ApiKeys",
      "claude-dashboard/api-keys",
    );

    // ── Lambda (API backend) ──────────────────────────────────────────────────
    const fn = new lambda.Function(this, "DashboardApi", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "lambda.handler",           // server/dist/lambda.js → handler export
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../server/dist"),
      ),
      architecture: lambda.Architecture.ARM_64,  // cheaper + faster for Node
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),   // analytics fetches can take 10-20s on 90d
      environment: {
        NODE_ENV: "production",
        // Resolve secrets into env vars at deploy time.
        // Use dynamic resolution so the value isn't in CloudFormation plaintext.
        ANTHROPIC_ANALYTICS_KEY: cdk.SecretValue.secretsManager(
          "claude-dashboard/api-keys",
          { jsonField: "ANTHROPIC_ANALYTICS_KEY" },
        ).unsafeUnwrap(),
        ANTHROPIC_ADMIN_KEY: cdk.SecretValue.secretsManager(
          "claude-dashboard/api-keys",
          { jsonField: "ANTHROPIC_ADMIN_KEY" },
        ).unsafeUnwrap(),
        ANTHROPIC_VERSION: "2023-06-01",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        USE_MOCK: "false",
      },
    });

    // Allow Lambda to read the secret at runtime (if you switch to runtime fetch).
    apiSecret.grantRead(fn);

    // Lambda Function URL — no API Gateway needed, lower latency + cost.
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,   // CloudFront is the auth/edge layer
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.OPTIONS],
      },
    });

    // ── S3 (static frontend) ──────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── CloudFront ────────────────────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, "CDN", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        // Serve frontend from S3.
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        // Route /api/* to Lambda Function URL, bypassing S3.
        "/api/*": {
          origin: new origins.HttpOrigin(
            cdk.Fn.select(2, cdk.Fn.split("/", fnUrl.url)),  // strip https://
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // SPA fallback — serve index.html for any unknown path.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    // ── Deploy frontend to S3 ─────────────────────────────────────────────────
    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../client/dist"))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],  // invalidate CloudFront cache on deploy
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Claude Usage Dashboard URL",
    });
    new cdk.CfnOutput(this, "LambdaFunctionUrl", {
      value: fnUrl.url,
    });
  }
}
```

---

## Step 5 — Update the client API base URL for production

The client currently calls relative `/api/...` URLs which works when the server also serves the frontend. In the S3+CloudFront deployment, CloudFront routes `/api/*` to Lambda, so relative URLs still work correctly — **no change needed**.

If you ever point the client at a different domain, set `VITE_API_BASE` in `client/.env.production` and update `client/src/api.ts` to use `import.meta.env.VITE_API_BASE`.

---

## Step 6 — Bootstrap and deploy

```bash
# One-time CDK bootstrap per account/region (run once ever)
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1 --app infra

# Deploy (from project root, so CDK can find the built assets)
cd infra
npx cdk deploy --require-approval never
```

CDK will output the CloudFront URL when done:

```
Outputs:
InfraStack.DashboardUrl = https://d1abc2defg.cloudfront.net
```

Open that URL — you're live.

---

## Step 7 — Subsequent deploys

After making code changes:

```bash
# 1. Build both packages
cd client && npm run build && cd ..
cd server && npm run build && cd ..

# 2. Deploy (CDK diffs and updates only what changed)
cd infra && npx cdk deploy
```

The `BucketDeployment` automatically invalidates the CloudFront cache, so users always get the latest frontend immediately.

---

## Optional: Persistent cache with DynamoDB

The default in-memory cache lives only within a single Lambda instance. For a small internal dashboard this is fine — warm instances reuse it, and cold starts just make a fresh Anthropic API call. If you want cache to survive across instances (or to keep all Lambda instances warm), use DynamoDB:

1. Add a DynamoDB table to the CDK stack:

```typescript
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

const cacheTable = new dynamodb.Table(this, "DashboardCache", {
  partitionKey: { name: "cacheKey", type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: "ttl",
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
cacheTable.grantReadWriteData(fn);
fn.addEnvironment("CACHE_TABLE", cacheTable.tableName);
```

2. Replace the `Map<string, CacheEntry>` in `dashboardService.ts` with DynamoDB `GetItem`/`PutItem` calls using the AWS SDK v3 (`@aws-sdk/client-dynamodb`).

---

## Optional: Custom domain

Add a Route 53 hosted zone and ACM certificate to the CDK stack and attach them to the CloudFront distribution:

```typescript
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";

const zone = route53.HostedZone.fromLookup(this, "Zone", {
  domainName: "yourdomain.com",
});

const cert = new acm.Certificate(this, "Cert", {
  domainName: "claude-dashboard.yourdomain.com",
  validation: acm.CertificateValidation.fromDns(zone),
});

// Add to Distribution props:
// domainNames: ["claude-dashboard.yourdomain.com"],
// certificate: cert,

new route53.ARecord(this, "AliasRecord", {
  zone,
  recordName: "claude-dashboard",
  target: route53.RecordTarget.fromAlias(
    new targets.CloudFrontTarget(distribution),
  ),
});
```

---

## Estimated AWS costs

| Service | Usage | Estimated monthly cost |
|---------|-------|------------------------|
| Lambda | ~1,000 invocations/month, 512MB, <5s avg | < $0.01 |
| CloudFront | ~10 GB transfer/month | ~$0.85 |
| S3 | ~5 MB static assets | < $0.01 |
| Secrets Manager | 1 secret | $0.40 |
| DynamoDB (optional) | On-demand, minimal writes | < $0.10 |
| **Total** | | **~$1.50/month** |

The dominant cost is CloudFront data transfer. For an internal team dashboard the actual cost is likely under $1/month.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/api/*` returns 403 | CloudFront can't reach Lambda Function URL | Check the `fnUrl` origin hostname is correctly extracted; verify Lambda function URL is public |
| `502 Bad Gateway` from CloudFront | Lambda threw an error or timed out | Check CloudWatch Logs for the Lambda function |
| Frontend shows "Loading…" forever | API calls going to wrong URL | Open browser DevTools → Network tab; verify `/api/dashboard` returns JSON |
| Lambda cold start > 10s on 90d range | 3 parallel 31-day Anthropic API chunks | Normal. Consider keeping Lambda warm with a CloudWatch scheduled ping every 5 minutes |
| `Cannot find module './lambda.js'` | Lambda handler path wrong | Ensure `handler: "lambda.handler"` and `server/dist/lambda.js` exists after build |
| ESM import errors in Lambda | Node 20 + `"type":"module"` | Lambda Node 20 runtime supports ESM. Ensure `tsconfig.json` targets `ES2022`/`ESNext` and `module: "NodeNext"` |

---

## Quick reference — all commands

```bash
# First-time setup
cd server && npm install @vendia/serverless-express && npm install -D @types/aws-lambda && cd ..
mkdir infra && cd infra && npx cdk init app --language typescript && npm install aws-cdk-lib constructs && cd ..
aws secretsmanager create-secret --name "claude-dashboard/api-keys" \
  --secret-string '{"ANTHROPIC_ANALYTICS_KEY":"...","ANTHROPIC_ADMIN_KEY":"..."}'
cdk bootstrap aws://ACCOUNT_ID/REGION --app infra

# Every deploy
cd client && npm run build && cd ..
cd server && npm run build && cd ..
cd infra && npx cdk deploy
```
