# S3 CORS Configuration for Document Uploads

This document explains the S3 CORS (Cross-Origin Resource Sharing) configuration required for document uploads to work properly.

## Overview

When uploading documents directly to S3 using presigned POST URLs, the browser enforces CORS policies. The S3 bucket must be configured to allow requests from your frontend domain.

## Required CORS Configuration

The S3 bucket must allow:

- **Origins**: 
  - `http://localhost:3000` (for local development)
  - `https://docsearch.petesampler.com` (for production)
  
- **Methods**: 
  - `POST` (required for presigned POST uploads)
  - `GET` (for downloading documents)
  - `PUT` (for direct uploads)
  - `HEAD` (for checking object existence)

- **Headers**: 
  - `*` (all headers, required for presigned POST with custom fields)
  
- **Exposed Headers**:
  - `ETag` (returned by S3 after successful upload)
  - `x-amz-request-id`
  - `x-amz-id-2`

## CloudFormation Configuration

The CORS configuration is included in `infrastructure/s3-bucket.yaml`:

```yaml
CorsConfiguration:
  CorsRules:
    - AllowedOrigins:
        - "http://localhost:3000"
        - "https://docsearch.petesampler.com"
      AllowedMethods:
        - GET
        - POST
        - PUT
        - HEAD
      AllowedHeaders:
        - "*"
      ExposedHeaders:
        - ETag
        - x-amz-request-id
        - x-amz-id-2
      MaxAgeSeconds: 3000
```

## Manual Configuration (if not using CloudFormation)

If you need to configure CORS manually via AWS Console or CLI:

### AWS Console

1. Go to S3 → Your Bucket → Permissions → CORS
2. Add the following CORS configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://docsearch.petesampler.com"
    ],
    "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
    "MaxAgeSeconds": 3000
  }
]
```

### AWS CLI

```bash
aws s3api put-bucket-cors \
  --bucket document-search-tenants \
  --cors-configuration file://cors-config.json
```

Where `cors-config.json` contains:

```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "POST", "PUT", "HEAD"],
      "AllowedOrigins": [
        "http://localhost:3000",
        "https://docsearch.petesampler.com"
      ],
      "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

## Troubleshooting

### "Failed to fetch" Error

If you see a "Failed to fetch" error when uploading documents:

1. **Check CORS Configuration**: Verify that your frontend origin is listed in the S3 bucket's CORS configuration
2. **Check Browser Console**: Look for CORS-related error messages in the browser's developer console
3. **Verify Presigned URL**: Ensure the presigned POST URL is valid and hasn't expired
4. **Check Network Tab**: Inspect the failed request in the browser's Network tab to see the exact error

### Common Issues

- **Missing Origin**: If your frontend domain is not in the `AllowedOrigins` list, uploads will fail
- **Wrong Protocol**: Make sure you're using `http://` for localhost and `https://` for production
- **Expired Presigned URL**: Presigned URLs expire after a set time (default: 5 minutes for batch uploads). If the user takes too long, they'll need to retry

## Testing CORS Configuration

You can test if CORS is properly configured by checking the response headers when uploading:

1. Open browser DevTools → Network tab
2. Attempt to upload a document
3. Check the preflight OPTIONS request (if any) and the actual POST request
4. Look for CORS headers in the response:
   - `Access-Control-Allow-Origin`
   - `Access-Control-Allow-Methods`
   - `Access-Control-Allow-Headers`

## Additional Notes

- CORS configuration changes may take a few minutes to propagate
- The `MaxAgeSeconds` value (3000 = 50 minutes) controls how long browsers cache the CORS preflight response
- For production, consider restricting `AllowedHeaders` to only what's needed instead of `*` for better security

