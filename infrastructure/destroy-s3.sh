#!/bin/bash
# Destroy S3 bucket CloudFormation stack
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
    exit 1
fi

# Set defaults
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
STACK_NAME="docsearch-s3-bucket"

# Configure AWS credentials
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="$REGION"

echo "Destroying CloudFormation stack..."
echo "  Stack Name: $STACK_NAME"
echo "  Region: $REGION"
echo ""
echo "⚠️  WARNING: This will delete the S3 bucket and all its contents!"
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

# Check if stack exists
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
    echo "Deleting stack..."
    aws cloudformation delete-stack \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
    
    echo "Waiting for stack deletion to complete..."
    aws cloudformation wait stack-delete-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
    
    echo "✓ Stack deleted successfully!"
else
    echo "Stack does not exist."
fi

