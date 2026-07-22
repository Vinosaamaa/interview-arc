---
type: solution
title: "Build a Marketplace Feature for Facebook"
date: 2026-07-22
status: published
---

# Build a Marketplace Feature for Facebook

## Problem Framing and Assumptions

Design a local peer-to-peer marketplace. Sellers manage listings; buyers discover nearby items, view details, and contact sellers. Reuse Facebook identity, messaging, and notifications. Payments, shipping, delivery, auctions, and ads are outside v1.

## Functional Requirements

1. Sellers create, edit, publish, mark sold, and deactivate listings.
2. Buyers browse or full-text search active nearby listings and filter results.
3. Buyers view authoritative details and contact sellers.
4. Users report unsafe content; automated and human moderation can hide it.
5. Favorites, recommendations, and notifications are secondary.

## Non-Functional Requirements

- Read-heavy discovery: p95 below 300 ms; cached detail below 200 ms.
- 99.9% browse availability and durable metadata/media.
- Strong consistency for ownership and lifecycle changes.
- Eventual consistency within seconds for search, caches, moderation, and recommendations.
- Protect exact location and keep every derived index rebuildable.

## Scale and Capacity Estimates

Assume 10M daily users and 100M active listings. Two hundred million reads/day is roughly 2.3K requests/second average and 23K at peak. One million new listings/day is about 12 writes/second average. Five 1.5 MB images per listing produces about 7.5 TB/day before compression and replication, so media dominates cost.

## API Contract

### Create a draft

```http
POST /v1/listings
Idempotency-Key: <client-key>
```

Returns `listing_id`, `version`, and short-lived signed upload URLs.

### Publish or edit

```http
POST  /v1/listings/{listing_id}/publish
PATCH /v1/listings/{listing_id}
If-Match: <expected-version>
```

Validate ownership, media readiness, and moderation status; use optimistic concurrency.

### Search nearby inventory

```http
GET /v1/listings/search?q=&lat=&lon=&radius=&category=&min_price=&max_price=&cursor=
```

Return an opaque search-after cursor and never expose precise seller coordinates.

### Contact and report

```http
POST /v1/listings/{listing_id}/contact
POST /v1/listings/{listing_id}/reports
```

Contact idempotently creates or reuses a buyer-listing conversation.

## Data Model and Access Patterns

```text
Listing(
  listing_id, seller_id, title, description, price_minor, currency,
  category_id, condition, coarse_geohash, precise_location_encrypted,
  status, moderation_status, version, created_at, updated_at
)
ListingMedia(media_id, listing_id, object_key, sort_order, processing_status)
Favorite(user_id, listing_id, created_at)
ConversationLink(buyer_id, listing_id, conversation_id)
Report(report_id, reporter_id, listing_id, reason, status)
TransactionalOutbox(event_id, aggregate_id, version, event_type, payload)
```

Use a sharded relational database for canonical lifecycle state and outbox writes, object storage for media, a full-text/geospatial search cluster for discovery, and distributed caches for hot detail and result hydration.

## High-Level Architecture

![Facebook Marketplace high-level architecture](/diagrams/facebook-marketplace-architecture.svg)

The listing service owns canonical state. Signed uploads go directly to object storage. A transactional outbox feeds an event stream whose idempotent consumers update search, moderation, recommendations, caches, analytics, and notifications.

## Critical Read and Write Flows

**Publish:** authenticate, create an idempotent draft, upload/scan/resize media, validate, atomically write listing plus outbox event, moderate, then index asynchronously.

**Search:** query by text and geospatial cells, rank by relevance/distance/freshness/quality, paginate with search-after, hydrate from cache, and revalidate status on detail reads.

**Contact:** verify the active listing, idempotently create or reuse a conversation, and notify the seller without exposing personal contact data.

## Scaling, Reliability, and Failure Handling

Partition listings by stable ID hash and replicate search geographically. Use cache-aside with event invalidation and TTLs. Consumers deduplicate by event ID and listing version; failures enter a dead-letter queue. If search fails, degrade to cached feeds while preserving listing writes. Rebuild search from the relational source.

## Security, Privacy, Observability, and Cost

Authorize against `seller_id`, use short-lived uploads, scan media/text, expose only coarse location, encrypt precise location, audit access, support deletion, and rate-limit abuse. Monitor latency, errors, database saturation, cache hit rate, search freshness, outbox age, consumer lag, moderation backlog, uploads, CDN hit rate, and stale-result clicks.

## Key Tradeoffs and Rejected Alternatives

A relational source plus search index adds operational complexity but cleanly separates lifecycle correctness from discovery. Search may lag by seconds while authoritative detail reads bound stale-result harm. Payments and shipping are rejected from v1 because they introduce ledgers, fraud, disputes, and compliance before validating discovery and contact.

## Interview-Ready Closing Summary

Keep listing lifecycle in a sharded relational database, media in object storage behind a CDN, and discovery in a full-text/geospatial index. A transactional outbox feeds indexing, moderation, recommendations, invalidation, and analytics. The key tradeoff is strong lifecycle consistency versus seconds of eventual consistency for discovery.

