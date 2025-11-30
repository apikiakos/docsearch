import { NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { getIndexInfo, getStandardMapping } from "../../../../../lib/elasticsearch";

type Context = {
  params: Promise<{ slug: string }>;
};

/**
 * Compare two mappings to check if they're compatible
 * Core fields must match, but descriptive metadata fields are flexible
 */
function mappingsCompatible(standardMapping: any, actualMapping: any): boolean {
  if (!standardMapping || !actualMapping) return false;
  
  const standardProps = standardMapping.properties || {};
  const actualProps = actualMapping.properties || {};
  
  // Core required fields that must exist
  const coreFields = ["id", "document_id", "tenant_id", "chunk_index", "chunk_offset", "title", "content", "metadata"];
  
  for (const field of coreFields) {
    if (!actualProps[field]) {
      return false;
    }
    
    // Check type compatibility for core fields (only if both have a type)
    // For complex fields like "title" with subfields, just check that the base type matches
    if (standardProps[field]?.type && actualProps[field]?.type) {
      if (actualProps[field].type !== standardProps[field].type) {
        return false;
      }
    }
  }
  
  // Check metadata object structure
  const standardMetadata = standardProps.metadata?.properties || {};
  const actualMetadata = actualProps.metadata?.properties || {};
  
  if (!actualMetadata || Object.keys(actualMetadata).length === 0) {
    return false;
  }
  
  // Core metadata fields that must always exist
  const requiredCoreFields = ["filename", "mime", "source", "originalUrl"];
  for (const field of requiredCoreFields) {
    if (!actualMetadata[field]) {
      return false;
    }
    if (standardMetadata[field]?.type && actualMetadata[field]?.type !== standardMetadata[field].type) {
      return false;
    }
  }
  
  // Check if this is the new structure (with source_url, type, and extras)
  const hasSourceUrl = !!actualMetadata.source_url;
  const hasType = !!actualMetadata.type;
  const hasExtras = !!actualMetadata.extras;
  const hasNewStructure = hasSourceUrl && hasType && hasExtras;
  
  if (hasNewStructure) {
    // New structure: verify source_url, type, and extras have correct types
    if (actualMetadata.source_url?.type !== "keyword") {
      return false;
    }
    if (actualMetadata.type?.type !== "keyword") {
      return false;
    }
    // Check if extras is an object (it should have type "object" or have properties/dynamic)
    // Elasticsearch may represent object types differently, so we check for either:
    // - type === "object" 
    // - has "properties" (indicating it's an object type)
    // - has "dynamic" (indicating it's an object type)
    const extras = actualMetadata.extras;
    if (!extras) {
      return false;
    }
    
    const extrasType = extras.type;
    const hasExtrasProperties = !!extras.properties;
    const hasExtrasDynamic = extras.dynamic !== undefined;
    
    // If extras has an explicit type, it must be "object"
    if (extrasType && extrasType !== "object") {
      return false;
    }
    // If extras doesn't have a type, it must have properties or dynamic to be a valid object
    if (!extrasType && !hasExtrasProperties && !hasExtrasDynamic) {
      return false;
    }
    // If we get here, extras is valid (either has type "object" or has properties/dynamic)
    // New structure is compatible
    // Note: We don't check if old fields (book_id, s3_bucket, etc.) are at the wrong level
    // because Elasticsearch doesn't allow moving fields. The important thing is that
    // the new structure (source_url, type, extras) exists and is correct.
    // Old fields at the top level of metadata.properties are acceptable for backward compatibility.
    return true;
  } else {
    // Old structure: compatible if it has the required core fields (already checked above)
    // This allows backward compatibility with indices created before the new structure
    return true;
  }
}

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireAuth();
    
    // Check if user is platform admin
    const isPlatformAdmin =
      user.memberships?.some((m) => m.role === "platform_admin") ?? false;
    
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { slug } = await context.params;
    const indexInfo = await getIndexInfo(slug);
    const standardMapping = getStandardMapping();

    if (!indexInfo) {
      return NextResponse.json({ 
        indexName: `docs_${slug}`,
        exists: false,
        shards: null,
        documentCount: 0,
        chunkCount: 0,
        size: 0,
        mapping: null,
        mappingCompatible: false,
        standardMapping,
      });
    }

    // Check if mapping is compatible with standard mapping
    const compatible = mappingsCompatible(standardMapping, indexInfo.mapping);
    
    // Debug: Log the compatibility check result
    if (!compatible) {
      console.log(`[DEBUG] Mapping incompatible for ${indexInfo.indexName}`);
      const actualProps = indexInfo.mapping?.properties || {};
      const actualMetadata = actualProps.metadata?.properties || {};
      console.log(`[DEBUG] source_url exists: ${!!actualMetadata.source_url}, type: ${actualMetadata.source_url?.type}`);
      console.log(`[DEBUG] type exists: ${!!actualMetadata.type}, type: ${actualMetadata.type?.type}`);
      console.log(`[DEBUG] extras exists: ${!!actualMetadata.extras}`);
      console.log(`[DEBUG] extras type: ${actualMetadata.extras?.type}`);
      console.log(`[DEBUG] extras has properties: ${!!actualMetadata.extras?.properties}`);
      console.log(`[DEBUG] extras has dynamic: ${actualMetadata.extras?.dynamic !== undefined}`);
    }

    return NextResponse.json({
      ...indexInfo,
      mappingCompatible: compatible,
      standardMapping,
    });
  } catch (error) {
    console.error("Error fetching index info:", error);
    return NextResponse.json(
      { error: "Failed to fetch index information" },
      { status: 500 }
    );
  }
}

