# Cloud Run one-time setup

One-time configuration of the Google Cloud project that runs the API. It is
written to be run by the project owner, step by step, in Cloud Shell or any
bash with `gcloud` signed in to the project. No step needs a credential to be
written into the repository, and no step prints a secret.

Status: draft. Nothing here has been run yet.

## 0. Values

Set these once per shell. None of them is a credential: they are identifiers
and can be committed to the repository (`service.yaml`, the deploy workflow).

```bash
export PROJECT_ID="<project id of 'Multitenant Bookings'>"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export REGION="southamerica-east1"

export SERVICE="bookings-api"
export AR_REPO="bookings-api"
export RUNTIME_SA="bookings-api-runtime"
export DEPLOY_SA="bookings-api-deployer"
export SECRET="supabase-service-role-key"

export WIF_POOL="github"
export WIF_PROVIDER="github-actions"

# Public GitHub identifiers (numeric ids survive a rename or re-creation of the
# repository; a name does not).
export GH_REPO="ArkonysDevJ/nestjs-rls-multitenant-bookings"
export GH_REPO_ID="1317467478"
export GH_OWNER_ID="73614503"
export GH_DEPLOY_WORKFLOW=".github/workflows/deploy.yml"

gcloud config set project "$PROJECT_ID"
```

Re-check the two numeric ids before relying on them:

```bash
curl -s "https://api.github.com/repos/$GH_REPO" | jq '.id, .owner.id'
# the first number is the repository id, the second is the owner id
```

## 1. Preconditions

1. Billing: the billing account linked to the project has a valid payment
   method or active credits.

   ```bash
   gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled,billingAccountName)'
   ```

   Expected: `True` and a billing account name.

2. Organization policy on public access. Step 8 grants `allUsers` the invoker
   role. If a policy blocks it (for example Domain Restricted Sharing,
   `iam.allowedPolicyMemberDomains`), stop there and report; do not work around
   it.

   ```bash
   gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains --project="$PROJECT_ID" --effective 2>&1 | head
   ```

   `--effective` shows the policy that applies to the project, including what it
   inherits from the organization or a folder. Without it the command shows only
   what is defined on the project itself, and an inherited restriction would look
   like "not set".

   Whether the project belongs to an organization:

   ```bash
   gcloud projects describe "$PROJECT_ID" --format='value(parent.type,parent.id)'
   ```

   If this prints nothing, the project has no organization and no organization
   policy can restrict it.

   Expected: "not set" or a policy that does not list the project as restricted.
   (The command may need `roles/orgpolicy.policyViewer`; if it is denied, note it
   and rely on the result of step 8.)

## 2. Enable the APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  sts.googleapis.com
```

`iam.googleapis.com` and `sts.googleapis.com` are needed for the service accounts
and for Workload Identity Federation (the token exchange).

Check: `gcloud services list --enabled --filter="name:(run OR artifactregistry OR secretmanager OR iamcredentials OR iam OR sts)" --format='value(name)'`
lists all six.

## 3. Artifact Registry

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Images of the bookings API"
```

Check: `gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --format='value(name)'`.

Images will live at `$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/<name>`.

## 4. Service accounts

Two accounts, neither of them the default Compute account.

```bash
gcloud iam service-accounts create "$RUNTIME_SA" \
  --display-name="Bookings API runtime"
gcloud iam service-accounts create "$DEPLOY_SA" \
  --display-name="Bookings API deployer (GitHub Actions)"

export RUNTIME_SA_EMAIL="$RUNTIME_SA@$PROJECT_ID.iam.gserviceaccount.com"
export DEPLOY_SA_EMAIL="$DEPLOY_SA@$PROJECT_ID.iam.gserviceaccount.com"
```

The runtime account has no project-level role. It gets exactly one binding, in
step 5.

## 5. The service key in Secret Manager

The Supabase service key for this deployment is a new key, created in Supabase
under the name `bookings-api-cloudrun`. It is loaded into Secret Manager
directly. It never goes through the repository, a chat, a ticket or another
deployment platform.

1. Create the secret (no value yet), kept in the same region as the service:

   ```bash
   gcloud secrets create "$SECRET" \
     --replication-policy=user-managed \
     --locations="$REGION"
   ```

2. In the Supabase dashboard, create the key `bookings-api-cloudrun` and copy
   it. Then, without echoing it and without leaving it in the shell history:

   ```bash
   read -rs SUPABASE_KEY      # paste, press Enter; nothing is shown
   printf %s "$SUPABASE_KEY" | gcloud secrets versions add "$SECRET" --data-file=-
   unset SUPABASE_KEY
   ```

3. Let the runtime account read this secret and nothing else:

   ```bash
   gcloud secrets add-iam-policy-binding "$SECRET" \
     --member="serviceAccount:$RUNTIME_SA_EMAIL" \
     --role="roles/secretmanager.secretAccessor"
   ```

4. Record the version number. `service.yaml` pins it (never `latest`), so
   rotating the key is an explicit, reversible deployment:

   ```bash
   gcloud secrets versions list "$SECRET" --format='table(name,state,createTime)'
   ```

   Report the version number (for example `1`). Do not report the value.

Check: `gcloud secrets get-iam-policy "$SECRET"` lists only the runtime account
(plus the project owners' inherited access, which is not a binding on the secret).

## 6. Create the service with the public sample image

This creates the resource that holds the URL and the IAM policy. The image is
Google's public sample, not the application. The deployment workflow replaces it.
The service uses the runtime account from the start.

```bash
gcloud run deploy "$SERVICE" \
  --image="us-docker.pkg.dev/cloudrun/container/hello" \
  --region="$REGION" \
  --service-account="$RUNTIME_SA_EMAIL" \
  --ingress=all \
  --min-instances=0 \
  --max-instances=2 \
  --no-allow-unauthenticated
```

Record the URL; the keep-alive workflow and the web app will point to it:

```bash
gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)'
```

Check that the service runs as the runtime account:

```bash
gcloud run services describe "$SERVICE" --region="$REGION" --format='value(spec.template.spec.serviceAccountName)'
```

Expected: `$RUNTIME_SA_EMAIL`, not `...-compute@developer.gserviceaccount.com`.

## 7. Deployer account permissions

Three bindings, each on a single resource, none at project level.

```bash
# Update this one service. This role cannot change the service's IAM policy,
# so the public-access binding from step 8 survives every deployment.
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:$DEPLOY_SA_EMAIL" \
  --role="roles/run.developer"

# Allow it to deploy revisions that run as the runtime account, and only that one.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA_EMAIL" \
  --member="serviceAccount:$DEPLOY_SA_EMAIL" \
  --role="roles/iam.serviceAccountUser"

# Push images to this repository only.
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
  --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA_EMAIL" \
  --role="roles/artifactregistry.writer"
```

Check each with `get-iam-policy` on the same resource. The deployer account must
not appear in `gcloud projects get-iam-policy "$PROJECT_ID"`.

## 8. Public invocation

The API is public; every route enforces its own authentication.

```bash
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --member="allUsers" \
  --role="roles/run.invoker"
```

If this is rejected by an organization policy, stop and report the exact error.

Check, with the sample image still running:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
```

Expected: `200`.

## 9. Workload Identity Federation

GitHub Actions exchanges its OIDC token for a short-lived Google token. No JSON
key exists anywhere.

```bash
gcloud iam workload-identity-pools create "$WIF_POOL" \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
  --location=global \
  --workload-identity-pool="$WIF_POOL" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.job_workflow_ref=assertion.job_workflow_ref" \
  --attribute-condition="assertion.repository_id=='$GH_REPO_ID' && assertion.repository_owner_id=='$GH_OWNER_ID' && assertion.ref=='refs/heads/main' && assertion.job_workflow_ref=='$GH_REPO/$GH_DEPLOY_WORKFLOW@refs/heads/main'"
```

The condition requires all three at once:

- the repository, by numeric `repository_id` and `repository_owner_id`, not by name
  alone;
- the reference `refs/heads/main`;
- the workflow file that is running, through the `job_workflow_ref` claim, whose
  value has the form `<owner>/<repo>/<path to the workflow file>@<ref>`.

A token that fails any of the three is refused by Google before it reaches the
service account.

The token also carries `event_name`, but for a workflow started with
`workflow_run` it is always `workflow_run`, so it cannot tell a push from a pull
request. The event filter therefore lives in the workflow itself (a job-level
condition that runs before authentication), not here.

Allow the federated identity to act as the deployer account, restricted to the
repository attribute, not to the whole pool:

```bash
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$WIF_POOL/attribute.repository_id/$GH_REPO_ID"
```

Check that the binding names a filtered `principalSet`, not the whole pool:

```bash
gcloud iam service-accounts get-iam-policy "$DEPLOY_SA_EMAIL"
```

Record the provider resource name; the deploy workflow needs it:

```bash
gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
  --location=global --workload-identity-pool="$WIF_POOL" --format='value(name)'
```

It has the form
`projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`.

## 10. What to report back

Identifiers only; none of these is a secret.

| Value | Where it is used |
| --- | --- |
| Project id and project number | `service.yaml`, deploy workflow |
| Service URL (step 6) | keep-alive workflow, web app API URL |
| Runtime account email | `service.yaml` |
| Deployer account email | deploy workflow |
| WIF provider resource name (step 9) | deploy workflow |
| Artifact Registry path (step 3) | deploy workflow |
| Secret name and the pinned version number (step 5) | `service.yaml` |
| Whether step 8 (public invocation) succeeded | go / no-go |

Never report the Supabase key or any token.

Once the values are known, they replace the placeholders in the repository:

| Placeholder | Files |
|---|---|
| `PROJECT_ID` | `apps/api/deploy/service.yaml` (runtime account), `.github/workflows/deploy.yml` (`env`) |
| `PROJECT_NUMBER` | `.github/workflows/deploy.yml` (`env`), the service URL in `.github/workflows/keep-alive.yml`, `README.md` and `README.es.md` |
| Secret version | `key:` of `SUPABASE_SERVICE_ROLE_KEY` in `apps/api/deploy/service.yaml` (it is `"1"` now) |

The service URL has the form `https://bookings-api-<PROJECT_NUMBER>.southamerica-east1.run.app`;
check it against the URL reported in step 6.

## 11. Verification summary

- [ ] Six APIs enabled.
- [ ] Docker repository in `southamerica-east1`.
- [ ] Runtime account has `secretAccessor` on the one secret and no project role.
- [ ] Deployer account has the three single-resource bindings and no project role.
- [ ] The service runs as the runtime account and answers `200` to the public sample.
- [ ] `allUsers` holds `roles/run.invoker` on the service only.
- [ ] The provider condition holds the repository ids, the branch and the workflow file.
- [ ] The `workloadIdentityUser` binding is on a `principalSet` filtered by `repository_id`.
- [ ] The secret has a version, and the version number is recorded.

## 12. Undo

Everything in this runbook is reversible without touching Supabase:

```bash
gcloud run services delete "$SERVICE" --region="$REGION"
gcloud artifacts repositories delete "$AR_REPO" --location="$REGION"
gcloud secrets delete "$SECRET"
gcloud iam workload-identity-pools delete "$WIF_POOL" --location=global
gcloud iam service-accounts delete "$DEPLOY_SA_EMAIL"
gcloud iam service-accounts delete "$RUNTIME_SA_EMAIL"
```

Revoke the Supabase key `bookings-api-cloudrun` separately, in Supabase.

Deleted workload identity pools and service accounts stay in soft-delete for
about 30 days, and during that time their ID cannot be reused. To run the setup
again after an undo, use different names or restore them with `undelete`.

## Points for the auditor

1. `iam.googleapis.com` and `sts.googleapis.com` are enabled in step 2 in
   addition to the four APIs the design lists; WIF needs the token exchange and
   the service accounts need IAM. Confirm they should be there.
2. The `workloadIdentityUser` principalSet is filtered by `repository_id`
   (step 9). The provider condition already pins the branch and the workflow
   file, so a token that gets as far as the binding has passed them. A binding
   filtered by `job_workflow_ref` would be stricter on its own but ties the
   binding to the repository name. Which one is preferred?
3. The deployer account has no Secret Manager role. Deploying a revision that
   references a secret needs only that the runtime account can read it. Checked on
   the first deployment (2 November 2026): it succeeded with no Secret Manager
   role on the deployer account.
4. `--no-allow-unauthenticated` at creation, then an explicit `allUsers` binding
   in step 8, so the public exposure is a separate, checked step.
5. The secret is kept in a single region (`user-managed`). Cloud Run reads the
   secret when each instance starts, not only when a revision is created, so with
   `minScale` 0 a regional outage of Secret Manager also stops new instances from
   starting, including a start from zero. Since the service runs in that same
   region, automatic replication would add little against a regional outage, so
   one region is kept.
6. `job_workflow_ref` for a workflow started by `workflow_run` names the deploy
   workflow file on the default branch. Checked on the first deployment: Google
   accepted the token under the condition of step 9, which includes that claim.
