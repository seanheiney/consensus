/**
 * Model catalog used by the profile selector and starter profiles.
 * Prices are USD per 1M tokens (input / output) from vendor pricing pages on
 * 2026-09-15; subscription-backed CLIs don't bill per token, prices are shown
 * for orientation. Any model id not listed here still works via `provider:model`.
 */
import type { Vendor } from "./providers/index.js";
import type { VendorStatus } from "./doctor.js";
export type Tier = "frontier" | "standard" | "budget";
export interface CatalogModel {
    id: string;
    label: string;
    tier: Tier;
    input?: number;
    output?: number;
    note?: string;
    /** The same model on OpenRouter (verified against openrouter.ai/api/v1/models on 2026-09-15). */
    openrouter?: string;
    /** Minimum Codex CLI version that can drive this model through `codex`. */
    minCodex?: string;
}
export type CatalogVendor = Exclude<Vendor, "other" | "openrouter">;
export declare const CATALOG: Record<CatalogVendor, CatalogModel[]>;
export declare function priceLabel(m: CatalogModel): string;
export interface Preset {
    name: string;
    description: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    rounds: number;
    /**
     * "per-vendor": one model of `tier` from every connected vendor.
     * "family": every catalog model of one vendor.
     * "personas": one model (best connected vendor, `tier`) seated once per persona.
     */
    shape: "per-vendor" | "family" | "personas";
    tier?: Tier;
    vendor?: CatalogVendor;
    personas?: string[];
}
/** Built-in presets. `consensus setup` materializes the ones your connections can satisfy. */
export declare const PRESETS: Preset[];
/** @deprecated use PRESETS */
export declare const STARTER_PROFILES: Preset[];
/** First catalog model of the tier, falling back to the next tier down then up. */
export declare function pickForTier(vendor: CatalogVendor, tier: Tier): CatalogModel | undefined;
export declare const CATALOG_VENDORS: CatalogVendor[];
/**
 * How to reach a vendor's model given the current connections: directly
 * (its CLI or API key) or, failing that, through OpenRouter.
 */
export declare function versionLt(a: string, b: string): boolean;
/** Why a direct route cannot seat this model, if it cannot. */
export declare function directRouteBlocker(vendor: CatalogVendor, model: CatalogModel, statuses: VendorStatus[]): string | undefined;
export declare function routeFor(vendor: CatalogVendor, model: CatalogModel, statuses: VendorStatus[]): {
    provider: string;
    model: string;
    viaOpenRouter: boolean;
} | undefined;
export declare function specFor(vendor: CatalogVendor, model: CatalogModel, statuses: VendorStatus[], effort?: "low" | "medium" | "high" | "xhigh" | "max"): string | undefined;
/** Best model of the tier that can actually be seated here (skips e.g. gpt-6-astra on an old Codex). */
export declare function pickSeatable(vendor: CatalogVendor, tier: Tier, statuses: VendorStatus[]): {
    model: CatalogModel;
    spec: (effort?: "low" | "medium" | "high" | "xhigh" | "max") => string;
    substituted?: string;
} | undefined;
/** Look a catalog model up by its vendor id or OpenRouter id. */
export declare function findCatalogModel(id: string): {
    vendor: CatalogVendor;
    model: CatalogModel;
} | undefined;
