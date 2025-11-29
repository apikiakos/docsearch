export type TenantId = "gutenberg" | "govdocs" | "alex-local" | string;

export interface BaseDocumentMetadata {
  filename?: string;
  mime?: string;
  source?: string;
  originalUrl?: string;
}

export interface LogicalDocument {
  document_id: string;
  tenant_id: TenantId;
  title: string;
  source: string;
  doc_type: string;
  metadata: BaseDocumentMetadata;
  created_at: string; // ISO
  updated_at: string; // ISO
}

export interface ChunkDocument {
  id: string;              // document_id#chunk_N
  document_id: string;
  tenant_id: TenantId;
  chunk_index: number;
  chunk_offset: number;
  title: string;
  content: string;
  metadata: BaseDocumentMetadata;
  created_at: string;
  updated_at: string;
}
