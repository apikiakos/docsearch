┌──────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT / UI LAYER                             │
└──────────────────────────────────────────────────────────────────────────────┘

                    ┌───────────────────────────────┐
                    │   Users / Tenants (Browsers)  │
                    │   - Tenant A                  │
                    │   - Tenant B                  │
                    │   - Tenant C                  │
                    └───────────────┬───────────────┘
                                    │  HTTPS (search queries)
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │          Next.js Frontend (UI)          │
                    │  - Tenant selector                      │
                    │  - Fields: title/content/filename       │
                    │  - Autocomplete                         │
                    │  - Pagination (search_after)            │
                    └──────────────────────┬──────────────────┘
                                           │  Calls /api/search
                                           │  Calls /api/autocomplete
                                           ▼

┌──────────────────────────────────────────────────────────────────────────────┐
│                       APPLICATION / API LAYER (STATELESS)                    │
└──────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────┐
                    │       Search API / Node.js (Next.js)     │
                    │------------------------------------------│
                    │ - Auth via API key → resolves tenant     │
                    │ - Builds ES queries                      │
                    │ - Routes to docs_<tenant> index          │
                    │ - Multi-tenancy enforcement              │
                    └───────────────┬──────────────────────────┘
                                    │
                     ┌──────────────┴───────────────┐
                     │                              │
                     ▼                              ▼
       (Search & autocomplete queries)     (Optional ingestion events)
              into ElasticSearch                      into RabbitMQ


                          ┌────────────────────────┐
                          │  PostgreSQL (Metadata)│
                          │ - Tenants              │
                          │ - API Keys             │
                          │ - Limits/Quotas        │
                          └────────────────────────┘

                          ┌────────────────────────┐
                          │   Redis (Caching)      │
                          │ - Hot query cache      │
                          │ - Rate limiting        │
                          └────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│                          INGESTION & QUEUE LAYER                              │
└──────────────────────────────────────────────────────────────────────────────┘


	                        ┌─────────────────────────────────────────┐
	                        │      Ingestion Pipelines (Python)       │
	                        └─────────────────────┬───────────────────┘
	                                              │
	   ┌──────────────────────────────────┐       │        ┌───────────────────────────┐
	   │   Producer Worker (S3 Scanner)   │───────┼──────► │       RabbitMQ            │
	   │----------------------------------│       │        │   Durable Queue           │
	   │ - Lists S3 objects (millions)    │       │        │   Message acks            │
	   │ - Sends messages per document    │       │        │   Redelivery on crash     │
	   │   {tenant_id, s3_key, metadata}  │       │        │   Backpressure            │
	   └──────────────────────────────────┘       │        └──────────┬────────────────┘
	                                              │                   │
	                                              │                   │  Work items
	                                              │                   ▼
	                                  ┌────────────────────┐   ┌────────────────────┐
	                                  │ Consumer Worker 1  │   │ Consumer Worker 2  │
	                                  │--------------------│   │--------------------│
	                                  │ - Download from S3 │   │ - Download from S3 │
	                                  │ - Extract text     │   │ - Extract text     │
	                                  │ - Normalize        │   │ - Normalize        │
	                                  │ - Bulk index → ES  │   │ - Bulk index → ES  │
	                                  └───────────┬────────┘   └──────────┬─────────┘
	                                              │                     │
	                                              ▼                     ▼


┌──────────────────────────────────────────────────────────────────────────────┐
│                                 STORAGE / SEARCH LAYER                       │
└──────────────────────────────────────────────────────────────────────────────┘
	
	      ┌───────────────────────────┐                         ┌────────────────────┐
	      │          S3 Bucket        │                         │  Elasticsearch     │
	      │---------------------------│                         │   Cluster          │
	      │ Raw tenant documents:     │                         │--------------------│
	      │  - PDFs                   │                         │ Nodes:             │
	      │  - DOCX                   │                         │  [Node A]          │
	      │  - HTML                   │                         │   - Primary shards │
	      │  - Images                 │                         │   - Replica shards │
	      └──────────┬────────────────┘                         │                    │
	                 │                                          │  [Node B]          │
	                 │ (download for processing)                │   - Primaries      │
	                 ▼                                          │   - Replicas       │
	   ┌────────────────────────┐                               │                    │
	   │ Consumer Workers       │                               │  [Node C]          │
	   │ Bulk indexing  bulk    │------------------------------▶│   - Primaries      │
	   └────────────────────────┘      (docs_<tenant_id>)       │   - Replicas       │
	                                                            │                    │
	                    Multi-tenancy: index per tenant         └────────────────────┘
	                    ─────────────────────────────────
	                    docs_tenantA
	                    docs_tenantB
	                    docs_tenantC


┌──────────────────────────────────────────────────────────────────────────────┐
│                   NON-FUNCTIONAL PROPERTIES / ANNOTATIONS                    │
└──────────────────────────────────────────────────────────────────────────────┘

MULTI-TENANCY:
 - One index per tenant: docs_tenantA, docs_tenantB, ...
 - API key resolves tenant → all queries scoped to that index
 - Isolation at both ingestion & search layers

FAULT TOLERANCE:
 - Elasticsearch: replica shards → node failures don’t break search
 - RabbitMQ durable queues → no lost messages
 - Workers stateless → safe restarts, auto retry
 - S3 durable → raw documents never lost

HORIZONTAL SCALABILITY:
 - Add more Consumer Workers → faster ingestion
 - Add more ES nodes → bigger cluster, more queries
 - Add API replicas → more request capacity
 - S3 automatically scales