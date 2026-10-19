# Nutrition catalog source contract — 19.10.2026

## Decision

Fit owns a **canonical nutrition registry**, rather than an ordered list of
live retailer/API fallbacks.  A product selected for a diary entry is always a
snapshot; an update to a catalog record must never rewrite an existing diary
entry.

There is no verified, open, nationwide Russian catalogue of packaged foods
with a reusable KBJU feed.  In particular, retail web pages are not an import
contract.  The registry therefore keeps source facts separately from the
canonical product and only promotes a fact after deterministic validation.

## Source eligibility

| Source | Role | May bootstrap the registry? | Must not be used for |
| --- | --- | --- | --- |
| Open Food Facts CSV/JSONL export | Primary open packaged-product candidate, including EAN | Yes, after ODbL attribution/share-alike review | Live typeahead, uncontrolled merge, image import |
| USDA FoodData Central | Generic foods and US-branded fallback | Yes, CC0 data only | Claiming Russian barcode coverage |
| FoodRepo | Optional Swiss barcode fallback | Yes, if licence is retained in provenance | Russian coverage claim |
| Perek API | Read-time primary source for one explicitly allow-listed pilot account | No bulk import; display the required per-product attribution | Shared cohort search, client-side key use, or catalogue harvesting |
| VkusVill public MCP | Read-time candidate for the pilot | No bulk import until a redistribution/refresh contract exists | Source of truth or implicit licence to cache the retail catalogue |
| GS1 Verified by GS1 | GTIN identity/brand check where its access permits | No KBJU bootstrap | Nutrition source |
| Retail storefronts and YAZIO | QA comparison only | No | Scraping, copying, or training a global catalogue |

Evidence and operating constraints:

- Open Food Facts asks high-volume consumers to use its dumps rather than the
  search API and limits search to 10 requests/minute/IP.  Its data is
  community-contributed and ODbL-licensed:
  <https://openfoodfacts.github.io/openfoodfacts-server/api/>.
- USDA makes FoodData Central data available as CC0; Branded Foods exposes
  GTIN/UPC but is not a Russia-specific catalogue:
  <https://fdc.nal.usda.gov/api-guide/>.
- GS1's free Verified by GS1 lookup is identity/basic-product information and
  has a small interactive quota; nutrition is not its promised payload:
  <https://www.gs1.org/services/verified-by-gs1>.
- YAZIO documents country-specific consumer databases, but no public
  developer export/API licence was found:
  <https://help.yazio.com/hc/en-us/articles/208126989-How-can-I-change-the-app-language-or-food-database>.
- Perekrestok's public offer permits personal non-commercial use and prohibits
  copying, distribution and processing of site materials without permission:
  <https://www.perekrestok.ru/documents/oferta>.
- Perek's API has a free request budget, requires a visible product link
  labelled `Данные: perek.us`, keeps the key server-side, and prohibits
  catalogue harvesting. The production adapter is therefore enabled only after
  the same per-account server-side allow-list check as barcode scanning:
  <https://app.perek.us/developers>.

## Registry model

The next migration introduces these private, service-written records; the
existing `nutrition_food_catalog` remains a read-time pilot cache until an
imported registry serves search.

1. `catalog_product`: immutable product identity, canonical display name,
   brand, package amount, and optional GTIN-14.
2. `catalog_source_observation`: raw source identifier, fetch/import time,
   payload checksum, licence/version, and original values.  It is the audit
   trail and refresh input, not a user-facing record.
3. `catalog_nutrition_fact`: one validated per-100g KBJU fact derived from an
   observation, with `active`, confidence tier, and supersession link.
4. `catalog_alias`: normalized search expression attached to a product; aliases
   are never inferred from another product merely because they are similar.
5. `catalog_merge_candidate`: an auditable *candidate*, not an automatic merge,
   for no-GTIN product records.

`gtin14` is unique when present.  The source and its external identifier are
also unique.  Every fact must have calories in 0..1000 kcal and each macro in
0..100g; the sum of macros may not exceed 101g.  A fact whose calories differ
materially from the macro-energy estimate is held inactive for review rather
than silently preferred.

## Deterministic promotion and de-duplication

1. Valid GTIN match: one product; retain every source observation and version
   its facts.
2. No GTIN: normalize Unicode/case/punctuation/quantity; generate a merge
   candidate only when brand, normalized name, package and KBJU are all close.
   Do not auto-merge it.
3. Same GTIN but conflicting label facts: preserve both observations, make no
   active replacement until the newer label/provenance wins according to an
   explicit policy.
4. A private user food remains private.  It can be attached to an existing
   product only after an explicit future submission flow; it cannot become a
   global result just by being saved.

## Import and refresh

Imports land in a staging stream, validate the record, record its source
checksum, upsert identity by GTIN, then promote a fact atomically.  They are
idempotent on `(source, external_id, payload_checksum)`.  A failed batch
creates no active facts.  The first acceptance gate is a labelled Russian
sample of real EANs: report exact GTIN hit rate, KBJU completeness, conflict
rate and stale-record rate before exposing imported search to users.

LLM is deliberately absent from this first release.  It may later propose
aliases or a merge candidate, but cannot publish/overwrite a fact and must
retain the original observation as evidence.
