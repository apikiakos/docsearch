# Infrastructure as Code

CloudFormation templates and deployment scripts for the distributed docsearch prototype.

## S3 Bucket Setup

### Prerequisites

1. **AWS CLI installed:**
   ```bash
   # macOS
   brew install awscli
   
   # Or via pip
   pip install awscli
   ```

2. **AWS credentials in root `.env`:**
   ```env
   AWS_ACCESS_KEY_ID="your-access-key"
   AWS_SECRET_ACCESS_KEY="your-secret-key"
   AWS_DEFAULT_REGION="us-east-1"
   AWS_S3_BUCKET="your-bucket-name"
   ```

### Deploy S3 Bucket

The deployment script automatically:
- Loads AWS credentials from root `.env` file
- Creates or updates the CloudFormation stack
- Creates the S3 bucket with proper configuration
- Sets up folder structure for tenants

```bash
# From project root
./infrastructure/deploy-s3.sh
```

Or manually:

```bash
# Load environment variables
export $(grep -v '^#' .env | grep -E '^AWS_' | xargs)

# Deploy stack
aws cloudformation create-stack \
  --stack-name docsearch-s3-bucket \
  --template-body file://infrastructure/s3-bucket.yaml \
  --parameters \
    ParameterKey=BucketName,ParameterValue="$AWS_S3_BUCKET" \
    ParameterKey=Region,ParameterValue="$AWS_DEFAULT_REGION" \
  --region "$AWS_DEFAULT_REGION"
```

### What Gets Created

1. **S3 Bucket** with:
   - Versioning enabled
   - Encryption (AES256)
   - Public access blocked
   - Lifecycle rules (delete old versions after 30 days)

2. **Folder Structure:**
   ```
   s3://bucket-name/
     s3-tenant-1/
       invoices/
       reports/
       legal/
       books/
     s3-tenant-2/
       invoices/
       reports/
       legal/
       books/
   ```

3. **Bucket Policy:**
   - Allows authenticated access (IAM users/roles in your account)
   - Read/write permissions for bucket and objects

### Verify Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name docsearch-s3-bucket \
  --region us-east-1

# List bucket contents
aws s3 ls s3://your-bucket-name/ --recursive

# Check folder structure
aws s3 ls s3://your-bucket-name/s3-tenant-1/
```

### Destroy S3 Bucket

⚠️ **Warning**: This will delete the bucket and all its contents!

```bash
./infrastructure/destroy-s3.sh
```

Or manually:

```bash
aws cloudformation delete-stack \
  --stack-name docsearch-s3-bucket \
  --region us-east-1
```

## CloudFormation Template Details

### Parameters

- `BucketName`: Name of the S3 bucket (default: `docsearch-prototype-bucket`)
- `Region`: AWS region (default: `us-east-1`)
- `Tenant1Name`: First tenant name (default: `s3-tenant-1`)
- `Tenant2Name`: Second tenant name (default: `s3-tenant-2`)

### Resources

- **DocSearchBucket**: The main S3 bucket
- **DocSearchBucketPolicy**: Bucket policy for access control
- **Folder Objects**: Placeholder objects to establish folder structure

### Outputs

- `BucketName`: Name of the created bucket
- `BucketArn`: ARN of the bucket
- `BucketDomainName`: Regional domain name
- `Tenant1Path`: S3 path for tenant 1
- `Tenant2Path`: S3 path for tenant 2

## Customization

To customize the bucket name or tenant names, edit the parameters in `s3-bucket.yaml` or pass them via CLI:

```bash
aws cloudformation create-stack \
  --stack-name docsearch-s3-bucket \
  --template-body file://infrastructure/s3-bucket.yaml \
  --parameters \
    ParameterKey=BucketName,ParameterValue="my-custom-bucket" \
    ParameterKey=Tenant1Name,ParameterValue="tenant-a" \
    ParameterKey=Tenant2Name,ParameterValue="tenant-b" \
  --region us-east-1
```

## Next Steps

After deploying the bucket:

1. **Run the seeding script:**
   ```bash
   cd workers/python
   python seed_s3_from_gutendex.py --bucket your-bucket-name
   ```

2. **Verify files are uploaded:**
   ```bash
   aws s3 ls s3://your-bucket-name/ --recursive | head -20
   ```

3. **Use with HTTP Producer:**
   The bucket can be used as a source for the HTTP producer to index documents.

## Current Statistics

See [S3_STATISTICS.md](./S3_STATISTICS.md) for current document counts and bucket statistics.

**Quick Summary:**
- Total documents: 17,202
- s3-tenant-1: 14,182 documents
- s3-tenant-2: 3,020 documents

