/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AUDIO: R2Bucket;
    LIVE_UPDATES: DurableObjectNamespace;
    JOB_JOURNEY_BASE_URL?: string;
    JOB_JOURNEY_SITE_TOKEN?: string;
  }
}
