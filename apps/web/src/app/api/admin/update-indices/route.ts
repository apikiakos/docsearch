import { NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/auth-helpers";
import { elasticsearch } from "../../../../lib/elasticsearch";
import { getStandardMapping } from "../../../../lib/elasticsearch";

/**
 * Update all tenant indices to use the standard mapping structure
 * This endpoint updates existing indices to match the desired mapping
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    
    // Check if user is platform admin
    const isPlatformAdmin =
      user.memberships?.some((m) => m.role === "platform_admin") ?? false;
    
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // Default to dry run for safety

    // Get all tenant indices (docs_*)
    const indicesResponse = await elasticsearch.cat.indices({
      index: "docs_*",
      format: "json",
    });

    const indices = (indicesResponse as Array<{ index: string }>).map((idx) => idx.index);
    
    if (indices.length === 0) {
      return NextResponse.json({
        message: "No tenant indices found",
        updated: [],
        errors: [],
      });
    }

    const standardMapping = getStandardMapping();
    const updated: string[] = [];
    const errors: Array<{ index: string; error: string }> = [];

    for (const indexName of indices) {
      try {
        if (dryRun) {
          // In dry run, just check if update is needed
          const currentMapping = await elasticsearch.indices.getMapping({ index: indexName });
          const currentSettings = await elasticsearch.indices.getSettings({ index: indexName });
          
          const settings = currentSettings[indexName]?.settings?.index || {};
          const mapping = currentMapping[indexName]?.mappings || {};
          const metadataProps = mapping.properties?.metadata?.properties || {};
          
          // Check if mapping or settings need updating
          const needsReplicaUpdate = settings.number_of_replicas !== "1";
          const needsMappingUpdate = 
            !metadataProps.source_url || 
            !metadataProps.type || 
            !metadataProps.extras;
          
          if (needsReplicaUpdate || needsMappingUpdate) {
            updated.push(indexName);
          }
        } else {
          // Note: Elasticsearch doesn't allow changing number_of_shards on existing indices
          // We can only update number_of_replicas and add new mapping fields
          
          // Update replicas (can be changed on existing indices)
          const currentSettings = await elasticsearch.indices.getSettings({ index: indexName });
          const currentReplicas = currentSettings[indexName]?.settings?.index?.number_of_replicas;
          if (currentReplicas !== "1") {
            await elasticsearch.indices.putSettings({
              index: indexName,
              settings: {
                number_of_replicas: 1,
              },
            });
          }

          // Update mapping (add missing fields)
          // Note: Elasticsearch doesn't allow removing fields, only adding
          // We'll add the new fields (source_url, type, extras) to the mapping
          await elasticsearch.indices.putMapping({
            index: indexName,
            properties: standardMapping.properties,
          });

          updated.push(indexName);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({ index: indexName, error: errorMessage });
        console.error(`Error updating index ${indexName}:`, error);
      }
    }

    return NextResponse.json({
      message: dryRun 
        ? `Dry run: ${updated.length} index(es) would be updated`
        : `Updated ${updated.length} index(es)`,
      updated,
      errors,
      dryRun,
    });
  } catch (error: unknown) {
    console.error("Error updating indices:", error);
    return NextResponse.json(
      { error: "Failed to update indices" },
      { status: 500 }
    );
  }
}

