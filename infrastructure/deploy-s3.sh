#!/bin/bash
# Deploy S3 bucket using CloudFormation
# Reads AWS credentials from root .env file

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables from root .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "Loading environment variables from $PROJECT_ROOT/.env"
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | grep -E '^AWS_' | xargs)
else
    echo "Warning: .env file not found at $PROJECT_ROOT/.env"
    echo "Make sure AWS credentials are set in environment"
fi

# Check required variables
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "Error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set"
    echo "Add them to $PROJECT_ROOT/.env or export them"
    exit 1
fi

# Set defaults
BUCKET_NAME="${AWS_S3_BUCKET:-docsearch-prototype-bucket}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
STACK_NAME="docsearch-s3-bucket"
TEMPLATE_FILE="$SCRIPT_DIR/s3-bucket.yaml"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    echo "Install it with: brew install awscli (macOS) or pip install awscli"
    exit 1
fi

# Configure AWS credentials
# Unset any AWS profile to ensure we use the credentials from .env
unset AWS_PROFILE
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="$REGION"

# Verify credentials are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "Error: AWS credentials not properly loaded from .env"
    exit 1
fi

echo "Deploying CloudFormation stack..."
echo "  Using IAM User: $(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null || echo 'Unable to verify')"
echo "  Stack Name: $STACK_NAME"
echo "  Bucket Name: $BUCKET_NAME"
echo "  Region: $REGION"
echo ""

# Check if stack exists
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
    echo "Stack exists, updating..."
    aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-body "file://$TEMPLATE_FILE" \
        --parameters \
            ParameterKey=BucketName,ParameterValue="$BUCKET_NAME" \
            ParameterKey=Region,ParameterValue="$REGION" \
            ParameterKey=Tenant1Name,ParameterValue="s3-tenant-1" \
            ParameterKey=Tenant2Name,ParameterValue="s3-tenant-2" \
        --region "$REGION" \
        --capabilities CAPABILITY_NAMED_IAM
    
    echo "Waiting for stack update to complete..."
    aws cloudformation wait stack-update-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
else
    echo "Stack does not exist, creating..."
    aws cloudformation create-stack \
        --stack-name "$STACK_NAME" \
        --template-body "file://$TEMPLATE_FILE" \
        --parameters \
            ParameterKey=BucketName,ParameterValue="$BUCKET_NAME" \
            ParameterKey=Region,ParameterValue="$REGION" \
            ParameterKey=Tenant1Name,ParameterValue="s3-tenant-1" \
            ParameterKey=Tenant2Name,ParameterValue="s3-tenant-2" \
        --region "$REGION" \
        --capabilities CAPABILITY_NAMED_IAM
    
    echo "Waiting for stack creation to complete..."
    aws cloudformation wait stack-create-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
fi

echo ""
echo "✓ Stack deployed successfully!"
echo ""

# Get outputs
echo "Stack outputs:"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs' \
    --output table

echo ""
echo "✓ Stack deployed successfully!"
echo ""
echo "Bucket is ready for use!"
echo "Note: Folder structure will be created automatically when you upload files."
echo "You can now run the seeding script:"
echo "  cd workers/python"
echo "  python seed_s3_from_gutendex.py --bucket $BUCKET_NAME"

