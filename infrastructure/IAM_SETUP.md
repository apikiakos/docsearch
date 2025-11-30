# IAM User Setup Guide

This guide will help you create a dedicated IAM user for the **distributed-docsearch-prototype** project, separate from your other AWS projects.

## Step-by-Step Instructions

### Step 1: Create IAM User

1. **Go to AWS Console** → **IAM** → **Users**
2. Click **"Create user"**
3. **User name**: `docsearch-prototype-user` (or any name you prefer)
4. **Select**: "Provide user access to the AWS Management Console" - **UNCHECK THIS** (we only need programmatic access)
5. Click **"Next"**

### Step 2: Set Permissions

1. **Select**: "Attach policies directly"
2. Click **"Create policy"** (opens in new tab)
3. Click **"JSON"** tab
4. Copy and paste the contents of `infrastructure/iam-policy.json` from this project
5. Click **"Next"**
6. **Policy name**: `DocSearchPrototypePolicy`
7. **Description**: `Policy for distributed-docsearch-prototype project - S3 and CloudFormation access`
8. Click **"Create policy"**
9. Go back to the user creation tab
10. Click the refresh icon (🔄) next to "Create policy"
11. Search for `DocSearchPrototypePolicy`
12. **Check the box** next to it
13. Click **"Next"**

### Step 3: Review and Create

1. Review the user details
2. Click **"Create user"**

### Step 4: Create Access Keys

1. Click on the newly created user (`docsearch-prototype-user`)
2. Go to **"Security credentials"** tab
3. Scroll down to **"Access keys"**
4. Click **"Create access key"**
5. **Use case**: Select **"Command Line Interface (CLI)"**
6. Check the confirmation box
7. Click **"Next"**
8. (Optional) Add a description: `For distributed-docsearch-prototype project`
9. Click **"Create access key"**

### Step 5: Save Credentials

⚠️ **IMPORTANT**: This is the only time you'll see the secret key!

1. **Copy the Access Key ID** (starts with `AKIA...`)
2. **Copy the Secret Access Key** (long string)
3. **Save them securely** (password manager, etc.)

### Step 6: Update Your .env File

Update your root `.env` file with the new credentials:

```bash
# Edit the .env file
nano .env
# or
code .env
```

Replace the AWS credentials:

```env
# AWS S3 Configuration (for seed_s3_from_gutendex.py and CloudFormation)
AWS_ACCESS_KEY_ID="AKIA...your-new-access-key"
AWS_SECRET_ACCESS_KEY="your-new-secret-key"
AWS_DEFAULT_REGION="eu-west-1"
AWS_S3_BUCKET="document-search-tenants"
```

### Step 7: Test the Setup

Test that the credentials work:

```bash
# Test AWS CLI access
aws sts get-caller-identity

# You should see output like:
# {
#     "UserId": "AIDA...",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/docsearch-prototype-user"
# }
```

### Step 8: Deploy the Stack

Now you can deploy the CloudFormation stack:

```bash
./infrastructure/deploy-s3.sh
```

## What This IAM User Can Do

✅ **Allowed:**
- Create/update/delete CloudFormation stacks (only `docsearch-*` stacks)
- Create and manage S3 buckets (only specific buckets)
- Upload/download/delete objects in those buckets
- List buckets (to verify access)

❌ **Not Allowed:**
- Access other IAM users or roles
- Create resources in other AWS services
- Access buckets from other projects
- Modify other CloudFormation stacks

## Security Best Practices

1. **Never commit credentials** to Git (`.env` is already in `.gitignore`)
2. **Rotate keys periodically** (every 90 days recommended)
3. **Use different IAM users** for different projects
4. **Monitor usage** in CloudTrail if needed
5. **Delete unused access keys** from old projects

## Troubleshooting

### "Access Denied" Errors

- Verify the IAM policy is attached to the user
- Check that the bucket name in the policy matches your `.env` file
- Ensure the region is correct

### "Stack already exists" Error

If you see this, it means a stack with the same name exists from a previous deployment. You can either:
- Use a different stack name (edit `deploy-s3.sh`)
- Delete the existing stack first: `./infrastructure/destroy-s3.sh`

### "Bucket name already taken"

S3 bucket names are globally unique. If your bucket name is taken:
- Choose a different name in your `.env` file
- Update `AWS_S3_BUCKET` in `.env`

## Next Steps

After successful deployment:
1. Run the seeding script: `cd workers/python && python seed_s3_from_gutendex.py --bucket document-search-tenants`
2. Verify files are uploaded: `aws s3 ls s3://document-search-tenants/ --recursive`

