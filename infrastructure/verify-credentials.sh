#!/bin/bash
# Verify AWS credentials from .env file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables from root .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "Loading environment variables from $PROJECT_ROOT/.env"
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | grep -E '^AWS_' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Unset AWS profile to use credentials from .env
unset AWS_PROFILE
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-eu-west-1}"

echo ""
echo "Verifying AWS credentials..."
echo "================================"
echo ""

# Get caller identity
IDENTITY=$(aws sts get-caller-identity 2>&1)
if [ $? -eq 0 ]; then
    echo "✓ Credentials are valid!"
    echo ""
    echo "$IDENTITY" | python3 -m json.tool 2>/dev/null || echo "$IDENTITY"
    echo ""
    
    # Extract user name
    USER_ARN=$(echo "$IDENTITY" | grep -o '"Arn": "[^"]*"' | cut -d'"' -f4)
    if [[ "$USER_ARN" == *"user/"* ]]; then
        USER_NAME=$(echo "$USER_ARN" | sed 's/.*user\///')
        echo "IAM User: $USER_NAME"
        
        if [[ "$USER_NAME" == *"katikapou"* ]] || [[ "$USER_NAME" == *"upload"* ]]; then
            echo ""
            echo "⚠️  WARNING: You're using an old IAM user from another project!"
            echo "   Please create a new IAM user for this project and update .env"
            echo "   See: infrastructure/IAM_SETUP.md"
        elif [[ "$USER_NAME" == *"docsearch"* ]]; then
            echo ""
            echo "✓ Using the correct IAM user for this project!"
        else
            echo ""
            echo "ℹ️  Using IAM user: $USER_NAME"
        fi
    fi
else
    echo "✗ Error verifying credentials:"
    echo "$IDENTITY"
    exit 1
fi

echo ""
echo "================================"
