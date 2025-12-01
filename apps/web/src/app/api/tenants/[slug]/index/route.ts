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
function mappingsCompatible(standardMapping: Record<string, unknown>, actualMapping: Record<string, unknown>): boolean {
  if (!standardMapping || !actualMapping) return false;
  
  const standardProps = (standardMapping.properties as Record<string, unknown>) || {};
  const actualProps = (actualMapping.properties as Record<string, unknown>) || {};
  
  // Core required fields that must exist
  const coreFields = ["id", "document_id", "tenant_id", "chunk_index", "chunk_offset", "title", "content", "metadata"];
  
  for (const field of coreFields) {
    if (!actualProps[field]) {
      return false;
    }
    
    // Check type compatibility for core fields (only if both have a type)
    // For complex fields like "title" with subfields, just check that the base type matches
    const standardField = standardProps[field] as Record<string, unknown> | undefined;
    const actualField = actualProps[field] as Record<string, unknown> | undefined;
    if (standardField?.type && actualField?.type) {
      if (actualField.type !== standardField.type) {
        return false;
      }
    }
  }
  
  // Check metadata object structure
  const standardMetadataObj = standardProps.metadata as Record<string, unknown> | undefined;
  const actualMetadataObj = actualProps.metadata as Record<string, unknown> | undefined;
  const standardMetadata = (standardMetadataObj?.properties as Record<string, unknown>) || {};
  const actualMetadata = (actualMetadataObj?.properties as Record<string, unknown>) || {};
  
  if (!actualMetadata || Object.keys(actualMetadata).length === 0) {
    return false;
  }
  
  // Core metadata fields that must always exist
  const requiredCoreFields = ["filename", "mime", "source", "originalUrl"];
  for (const field of requiredCoreFields) {
    if (!actualMetadata[field]) {
      return false;
    }
    const standardField = standardMetadata[field] as Record<string, unknown> | undefined;
    const actualField = actualMetadata[field] as Record<string, unknown> | undefined;
    if (standardField?.type && actualField?.type !== standardField.type) {
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
    const sourceUrlField = actualMetadata.source_url as Record<string, unknown> | undefined;
    const typeField = actualMetadata.type as Record<string, unknown> | undefined;
    if (sourceUrlField?.type !== "keyword") {
      return false;
    }
    if (typeField?.type !== "keyword") {
      return false;
    }
    // Check if extras is an object (it should have type "object" or have properties/dynamic)
    // Elasticsearch may represent object types differently, so we check for either:
    // - type === "object" 
    // - has "properties" (indicating it's an object type)
    // - has "dynamic" (indicating it's an object type)
    const extras = actualMetadata.extras as Record<string, unknown> | undefined;
    if (!extras) {
      return false;
    }
    
    const extrasType = extras.type;
    const hasExtrasProperties = !!(extras.properties as Record<string, unknown> | undefined);
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
      user.memberships?.some((m: { tenantId: string; tenantSlug: string; role: string }) => m.role === "platform_admin") ?? false;
    
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
    const compatible = mappingsCompatible(
      standardMapping as Record<string, unknown>, 
      (indexInfo.mapping || {}) as Record<string, unknown>
    );
    
    // Debug: Log the compatibility check result
    if (!compatible) {
      console.log(`[DEBUG] Mapping incompatible for ${indexInfo.indexName}`);
      const actualProps = ((indexInfo.mapping as Record<string, unknown>)?.properties as Record<string, unknown>) || {};
      const actualMetadataObj = actualProps.metadata as Record<string, unknown> | undefined;
      const actualMetadata = (actualMetadataObj?.properties as Record<string, unknown>) || {};
      const sourceUrlField = actualMetadata.source_url as Record<string, unknown> | undefined;
      const typeField = actualMetadata.type as Record<string, unknown> | undefined;
      const extrasField = actualMetadata.extras as Record<string, unknown> | undefined;
      console.log(`[DEBUG] source_url exists: ${!!actualMetadata.source_url}, type: ${sourceUrlField?.type}`);
      console.log(`[DEBUG] type exists: ${!!actualMetadata.type}, type: ${typeField?.type}`);
      console.log(`[DEBUG] extras exists: ${!!actualMetadata.extras}`);
      console.log(`[DEBUG] extras type: ${extrasField?.type}`);
      console.log(`[DEBUG] extras has properties: ${!!extrasField?.properties}`);
      console.log(`[DEBUG] extras has dynamic: ${extrasField?.dynamic !== undefined}`);
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

