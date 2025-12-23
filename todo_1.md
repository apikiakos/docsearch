### **1) Repo & Project Skeleton**

-   [A] Create GitHub repo.

-   [A] Add README skeleton.

-   [A] Add basic Docker Compose (app + Elasticsearch + Redis).

-   [B] Add LocalStack or a simple file-based mock for documents.

-   [C] Add RabbitMQ or similar queue for future ingestion path (even if minimal).

* * * * *

### **2) Architecture Design Document (2--3 pages)**

-   [A] Write **high-level architecture** section and include diagram.

-   [A] Write **data flow** section (indexing + search).

-   [A] Describe **storage strategy**:

    -   Elasticsearch for search

    -   Optional DB/Redis/queue.

-   [A] Define **API endpoints & contracts** with sample JSON.

-   [A] Specify **consistency model** (eventual consistency) and trade-offs.

-   [A] Define **caching strategy** at:

    -   API layer

    -   Search results

-   [A] Explain **message queue usage** (even if mocked).

-   [A] Describe **multi-tenancy approach**:

    -   index-per-tenant or tenant field.

-   [B] Mention **advanced search features** design, even if not fully implemented.

-   [C] Add **diagram** of ingestion workers + queue + ES.

* * * * *

### **3) Prototype -- Backend (API)**

-   [A] Implement POST /documents:

    -   JSON body: { tenantId?, title, content, metadata? }

    -   Tenant taken from header/query/path.

    -   Index into ES.

-   [A] Implement GET /search?q=&tenant=:

    -   Multi-field full-text search.

    -   Enforce tenant isolation.

-   [A] Implement GET /documents/{id}:

    -   Fetch from ES by ID (and tenant).

-   [A] Implement DELETE /documents/{id}:

    -   Delete from ES.

-   [A] Implement **multi-tenancy**:

    -   X-Tenant-Id header or tenant query param.

    -   Index naming or filtering.

-   [A] Add **simple caching**:

    -   e.g. Redis or in-memory map for search results per (tenant, query).

-   [A] Add **basic per-tenant rate limiting**:

    -   In-memory or Redis.

    -   Simple fixed window (e.g. N requests per minute per tenant).

-   [A] Add **health check endpoint**:

    -   GET /healthz

    -   Check ES + Redis connectivity.

-   [B] Add **fuzzy search** option.

-   [B] Add **faceted search** (aggregations).

-   [B] Add **highlighting**.

-   [C] Implement **search_after** pagination.

-   [C] Add /autocomplete endpoint.

* * * * *

### **4) Prototype -- Frontend (if you do Next.js UI)**

(They didn't require UI, but you already want it --- that's [C].)

-   [C] Simple Next.js page with:

    -   Tenant selector.

    -   Fields selector.

    -   Search box.

    -   Results list with highlights.

    -   Pagination buttons.

    -   Autocomplete dropdown.

* * * * *

### **5) Production Readiness Analysis**

In a separate ARCHITECTURE.md or section of main doc:

-   [A] Scalability:

    -   Describe how to scale ES, workers, API, caches.

    -   Handle 100x growth.

-   [A] Resilience:

    -   Circuit breakers.

    -   Retries for ES & queues.

    -   Failover with ES replicas, multi-AZ.

-   [A] Security:

    -   Tenant isolation.

    -   Auth (API keys, JWT).

    -   TLS, encryption at rest.

    -   Rate limiting, WAF.

-   [A] Observability:

    -   Metrics

    -   Logging

    -   Tracing

-   [A] Performance:

    -   Schema design

    -   Query tuning

    -   Cache strategies

    -   Index lifecycle / rollover.

-   [A] Operations:

    -   Deployment strategy and zero-downtime.

    -   Backups, snapshots, restore.

-   [A] SLA 99.95%:

    -   Multi-AZ, redundancy, monitoring & alerting.

-   [B] Describe **blue--green deployment** clearly.

-   [B] Include a **small benchmark**: sample numbers from e.g. k6 or a simple script.

-   [C] Add cost optimization section with concrete cloud examples.

* * * * *

### **6) Enterprise Experience Showcase**

-   [A] Write 1--2 paragraphs on each:

    -   Similar distributed system.

    -   Performance optimization story.

    -   Critical production incident.

    -   Architectural decision with trade-offs.

This is writing-heavy but straightforward.

* * * * *

### **7) Documentation & Packaging**

-   [A] Ensure **README** includes:

    -   How to run with Docker.

    -   Basic description of architecture.

    -   Links to main doc.

-   [A] Include:

    -   Sample API calls:

        -   curl examples OR Postman collection.

    -   ASCII / markdown diagrams.

-   [A] Provide single PDF/Markdown:

    -   Architecture design.

    -   Production readiness.

    -   Experience showcase.

    -   Note on AI usage.

-   [B] Mention performance benchmarks.

-   [B] Mention cost optimization strategies explicitly.

-   [C] Link to any relevant OSS repos.